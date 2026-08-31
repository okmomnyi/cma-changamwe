"""Register a photographed attendance sheet, then read its Present column.

The hard part is not reading a tick. A tick is a binary question with one box
per row, which is about as forgiving as optical mark recognition gets. The hard
part is that the page arrives skewed, curled and lit by whatever the church
hall has, and every measurement below is meaningless until the photograph has
been mapped back onto the geometry the sheet was printed with.

So the work is: find the four corner squares, solve the homography they imply,
warp the page flat, confirm the pointer code in the header still reads and
still names this sheet, and only then measure. Anything that does not line up
is rejected outright and asked for again. A wrong reading here would put
attendance against the wrong member, and attendance decides welfare money.
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

# The same alphabet the sheet codes are minted from: no I, O, 0 or 1.
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
POINTER = re.compile(r"^CMA-([A-Z][0-9])-([2-9A-HJ-NP-Z]{10})-([2-9A-HJ-NP-Z]{4})$")

# Working size. Set by what the pointer QR needs, not by what the marks need.
#
# A phone photograph is downscaled to this before anything is measured, and the
# symbol in the header only survives the round trip through that and the warp
# if it keeps roughly six pixels to a module. At 2400 it keeps five, and codes
# start failing to decode one page in three; the marks themselves would be
# happy at half this.
MAX_WORKING_EDGE = 3000

# Whole-sheet gates. Each one is a reason to ask for the photograph again
# rather than to guess at what the page said.
MIN_SHARPNESS = 35.0
MIN_BRIGHTNESS = 40.0
# A sheet is mostly white paper, so a good photograph of one is already bright.
# This is only meant to catch a page blown out by flash or direct sun, where
# the ink has gone with the glare; the contrast gate below does the real work.
MAX_BRIGHTNESS = 248.0
MIN_CONTRAST = 18.0
# How far a corner mark may sit from where the template says it should be,
# once the page has been squared up, measured on the warped page at render_dpi.
# Six pixels is a little over two points, which still leaves the measured
# window well inside a box that is inset by three.
MAX_ALIGNMENT_PX = 6.0
# How much of the printed box outlines has to be found where the template says
# they are. Around 0.75 when the page is lined up, a third at one point of
# drift, and nothing at two. See _outline_ink.
MIN_OUTLINE_INK = 0.30


class Rejected(Exception):
    """The page cannot be read with confidence, and says why."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass
class Registration:
    quad: np.ndarray
    warped: np.ndarray
    alignment_error: float
    outline_ink: float
    rotation: int
    pointer: str


def _checksum(version: str, code: str) -> str:
    digest = hashlib.sha256(f"{version}:{code}".encode("utf-8")).digest()
    return "".join(ALPHABET[b % len(ALPHABET)] for b in digest[:4])


def parse_pointer(payload: str) -> tuple[str, str] | None:
    """The version and code a pointer carries, or None if it is not one.

    The checksum is not security. It only stops a misread symbol from
    resolving to some other sheet by accident.
    """
    match = POINTER.match(payload.strip().upper())
    if match is None:
        return None
    version, code, check = match.groups()
    if _checksum(version, code) != check:
        return None
    return version, code


def _decode(image_bytes: bytes) -> np.ndarray:
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise Rejected("That file could not be read as an image.")
    edge = max(image.shape[:2])
    if edge > MAX_WORKING_EDGE:
        factor = MAX_WORKING_EDGE / edge
        image = cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    return image


def _flatten_lighting(gray: np.ndarray) -> np.ndarray:
    """Divide out the lighting before anything is thresholded.

    A hall lit from one side leaves half the page darker than the other, which
    is enough to turn a global threshold into nonsense. Dividing by a heavily
    blurred copy of the page leaves the ink and takes the gradient away.
    """
    background = cv2.GaussianBlur(gray, (0, 0), sigmaX=max(gray.shape) / 40.0)
    flat = cv2.divide(gray, background, scale=255)
    return flat


def _quality(gray: np.ndarray) -> dict[str, float]:
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return {
        "blur": round(sharpness, 2),
        "brightness": round(float(gray.mean()), 2),
        "contrast": round(float(gray.std()), 2),
    }


def _assert_usable(quality: dict[str, float]) -> None:
    """Ordered so the most specific reason is the one the secretary is given.

    An under-lit photograph is also a low-variance one, so testing sharpness
    first would tell somebody standing in a dim hall to hold the phone
    steadier, which is not the problem.
    """
    if quality["brightness"] < MIN_BRIGHTNESS:
        raise Rejected("That photograph is too dark to read. Take it again in better light.")
    if quality["brightness"] > MAX_BRIGHTNESS:
        raise Rejected(
            "That photograph is washed out. Move out of the direct glare and take it again.")
    if quality["contrast"] < MIN_CONTRAST:
        raise Rejected(
            "There is too little difference between the ink and the paper in that photograph. "
            "Take it again in more even light.")
    if quality["blur"] < MIN_SHARPNESS:
        raise Rejected(
            "That photograph is too blurred to read. Hold the phone still and take it again.")


def _marker_candidates(flat: np.ndarray, expected_side: float) -> list[tuple[float, float]]:
    """Small, solid, roughly square blobs, at about the size a marker should be.

    Everything else on the page is either much larger (the crest, the two QR
    codes, the table rules) or much smaller (text), so size alone removes most
    of it, and squareness removes the rest.
    """
    binary = cv2.adaptiveThreshold(
        flat, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 12)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    low = (expected_side * 0.35) ** 2
    high = (expected_side * 3.0) ** 2

    found: list[tuple[float, float]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < low or area > high:
            continue
        peri = cv2.arcLength(contour, True)
        if peri <= 0:
            continue
        approx = cv2.approxPolyDP(contour, 0.08 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        x, y, w, h = cv2.boundingRect(approx)
        if h == 0 or w == 0:
            continue
        aspect = w / float(h)
        if aspect < 0.6 or aspect > 1.7:
            continue
        # A registration mark is solid. An outlined box of the same size is not.
        if area / float(w * h) < 0.72:
            continue
        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            continue
        found.append((moments["m10"] / moments["m00"], moments["m01"] / moments["m00"]))
    return found


def _outermost_quad(points: list[tuple[float, float]]) -> np.ndarray:
    """The four points furthest into each corner, in top-left clockwise order.

    Sorting by x+y and x-y picks the extremes of the set rather than the ones
    nearest the edges of the frame, so a sheet that does not fill the picture,
    or one held at an angle, still resolves.
    """
    array = np.array(points, dtype=np.float32)
    total = array[:, 0] + array[:, 1]
    diff = array[:, 0] - array[:, 1]
    quad = np.array([
        array[int(np.argmin(total))],   # top left
        array[int(np.argmax(diff))],    # top right
        array[int(np.argmax(total))],   # bottom right
        array[int(np.argmin(diff))],    # bottom left
    ], dtype=np.float32)
    if len({(round(x, 1), round(y, 1)) for x, y in quad}) != 4:
        raise Rejected(
            "The four corner marks could not be told apart. Photograph the whole sheet, "
            "square on, with all four corners in the frame.")
    return quad


def _read_pointer(warped: np.ndarray, template: dict[str, Any], scale: float) -> str | None:
    """The pointer code, read from where the template says it was printed.

    The footer verification QR is deliberately ignored: only a payload in the
    pointer form is accepted, so the two codes on the page can never be
    confused for one another.
    """
    detector = cv2.QRCodeDetector()
    badge = template["badge"]
    pad = badge["size"] * 0.35
    x0 = int(max(0, (badge["x"] - pad) * scale))
    y0 = int(max(0, (badge["y"] - pad) * scale))
    x1 = int(min(warped.shape[1], (badge["x"] + badge["size"] + pad) * scale))
    y1 = int(min(warped.shape[0], (badge["y"] + badge["size"] + pad) * scale))

    region = warped[y0:y1, x0:x1]
    for candidate in (region, cv2.resize(region, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)):
        try:
            payload, _, _ = detector.detectAndDecode(candidate)
        except cv2.error:
            payload = ""
        if payload and parse_pointer(payload) is not None:
            return payload.strip().upper()

    # The header may be creased, or a thumb may be over part of it. Sweep the
    # whole page before giving up, but keep only a symbol that ends up in the
    # header once the page is squared up.
    #
    # That last condition is what tells a page held the right way up from one
    # held upside down. A QR decodes whichever way round it is, so a sweep that
    # accepted a pointer found anywhere would happily register an inverted page
    # and then read every row from the wrong place.
    header_left = (badge["x"] - badge["size"]) * scale
    header_bottom = (badge["y"] + badge["size"] * 3) * scale

    try:
        ok, payloads, points, _ = detector.detectAndDecodeMulti(warped)
    except cv2.error:
        ok, payloads, points = False, [], None
    if ok and points is not None:
        for payload, corners in zip(payloads, points):
            if not payload or parse_pointer(payload) is None:
                continue
            centre = np.mean(np.asarray(corners, dtype=np.float32).reshape(-1, 2), axis=0)
            if centre[0] >= header_left and centre[1] <= header_bottom:
                return payload.strip().upper()
    return None


def _residual(warped: np.ndarray, template: dict[str, Any], scale: float) -> float:
    """How far the corner marks actually landed from where they belong.

    A homography solved from exactly four points reproduces those four points
    perfectly, so measuring it against them says nothing at all. This measures
    the finished page instead: find the marks again on the warped sheet and see
    how far each sits from the template position it was supposed to land on.

    It catches a gross failure, but not a subtle one, because the marks are
    still the points the transform was fitted to. `_outline_ink` is the check
    that actually decides whether a row will be read from the right place.
    """
    candidates = _marker_candidates(warped, template["markers"]["size"] * scale)
    if not candidates:
        return float("inf")
    worst = 0.0
    for cx, cy in template["markers"]["centres"]:
        target = (cx * scale, cy * scale)
        nearest = min(candidates, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2)
        worst = max(worst, math.hypot(nearest[0] - target[0], nearest[1] - target[1]))
    return worst


def _outline_ink(warped: np.ndarray, template: dict[str, Any], scale: float) -> float:
    """Whether the printed Present boxes landed where the template says.

    This is the check that matters, and it is deliberately not made from the
    corner marks. It looks for the ink of the box outlines themselves, in thin
    bands along the top and bottom edge of every box, and reports the fraction
    that is dark.

    Lined up, those bands sit on the stroke and come back around three quarters
    inked. Drifted by a single point they fall to a third, and by two points to
    nothing, which is well before the drift could reach the measured window
    three points inside the box. So a page that registered plausibly but landed
    a row out is caught here rather than quietly read from the wrong place.
    """
    rows = template["rows"]
    box = rows["box"]
    _, ink = cv2.threshold(warped, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    band = max(2, int(round(1.5 * scale)))
    left = int(round((box["cx"] - box["size"] / 2 + 2) * scale))
    right = int(round((box["cx"] + box["size"] / 2 - 2) * scale))
    if right - left < 4:
        return 0.0

    scores: list[float] = []
    for index in range(int(rows["count"])):
        top = (rows["top"] + index * rows["height"] + (rows["height"] - box["size"]) / 2) * scale
        for edge in (top, top + box["size"] * scale):
            strip = ink[int(round(edge - band / 2)):int(round(edge + band / 2)), left:right]
            if strip.size:
                scores.append(float(np.count_nonzero(strip)) / float(strip.size))
    return float(np.mean(scores)) if scores else 0.0


def _register(gray: np.ndarray, template: dict[str, Any], scale: float) -> Registration:
    page = template["page"]
    width = int(round(page["width"] * scale))
    height = int(round(page["height"] * scale))

    flat = _flatten_lighting(gray)
    expected_side = template["markers"]["size"] * max(gray.shape) / page["height"]
    candidates = _marker_candidates(flat, expected_side)
    if len(candidates) < 4:
        raise Rejected(
            "The corner marks on that page could not be found. Photograph the whole sheet, "
            "flat and square on, with all four corners in the frame.")

    quad = _outermost_quad(candidates)
    corners = np.array(
        [[x * scale, y * scale] for x, y in template["markers"]["centres"]], dtype=np.float32)

    # A page photographed upside down or sideways is still a page. Each
    # rotation is tried and the one whose pointer code reads is the right one.
    for rotation in (0, 2, 1, 3):
        destination = np.roll(corners, -rotation, axis=0).astype(np.float32)
        matrix = cv2.getPerspectiveTransform(quad, destination)

        # The pointer is decoded from the plain page, not the flattened one.
        # Dividing out the lighting is the right thing to do before measuring a
        # box, and the wrong thing to do before decoding a symbol: it rings
        # around the high-contrast module edges the decoder is looking for.
        squared = cv2.warpPerspective(
            gray, matrix, (width, height), flags=cv2.INTER_LINEAR, borderValue=255)
        pointer = _read_pointer(squared, template, scale)
        if pointer is None:
            continue

        warped = cv2.warpPerspective(
            flat, matrix, (width, height), flags=cv2.INTER_LINEAR, borderValue=255)
        error = _residual(warped, template, scale)
        outline = _outline_ink(warped, template, scale)
        if not math.isfinite(error) or error > MAX_ALIGNMENT_PX or outline < MIN_OUTLINE_INK:
            raise Rejected(
                "That page could not be squared up accurately enough to read. Photograph it "
                "flat, from directly above, with the whole sheet in the frame.")
        return Registration(quad, warped, round(error, 2), round(outline, 3), rotation, pointer)

    raise Rejected(
        "The code in the header of that page could not be read once the sheet was squared up. "
        "Photograph it again with the whole page in the frame and the header unobstructed.")


def _measure(warped: np.ndarray, template: dict[str, Any], scale: float) -> list[dict[str, Any]]:
    rows = template["rows"]
    box = rows["box"]
    inset = box["detect_inset"]
    side = int(round((box["size"] - 2 * inset) * scale))
    if side < 6:
        raise Rejected("The sheet geometry leaves nothing measurable inside the boxes.")

    # One threshold for the page, taken after the lighting was divided out.
    _, ink = cv2.threshold(warped, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    left = int(round((box["cx"] - box["size"] / 2 + inset) * scale))
    low = float(template["thresholds"]["low"])
    high = float(template["thresholds"]["high"])

    measured: list[dict[str, Any]] = []
    for index in range(int(rows["count"])):
        top = int(round(
            (rows["top"] + index * rows["height"] + (rows["height"] - box["size"]) / 2 + inset)
            * scale))
        cell = ink[top:top + side, left:left + side]
        if cell.size == 0:
            raise Rejected("A row on that page fell outside the sheet once it was squared up.")
        ratio = float(np.count_nonzero(cell)) / float(cell.size)

        if ratio >= high:
            state = "marked"
            confidence = 0.5 + 0.5 * min(1.0, (ratio - high) / 0.30)
        elif ratio <= low:
            state = "blank"
            confidence = 0.5 + 0.5 * min(1.0, (low - ratio) / max(low, 0.02))
        else:
            # Between the two, and honest about it. This is the minority a
            # person is asked to look at.
            state = "uncertain"
            middle = (low + high) / 2.0
            span = max((high - low) / 2.0, 1e-6)
            confidence = 0.5 * max(0.0, 1.0 - abs(ratio - middle) / span)

        measured.append({
            "index": index,
            "fill_ratio": round(ratio, 4),
            "state": state,
            "confidence": round(confidence, 3),
        })
    return measured


def detect(image_bytes: bytes, sheet_code: str, template: dict[str, Any]) -> dict[str, Any]:
    """Read one photographed page, or say why it cannot be read."""
    scale = float(template["render_dpi"]) / 72.0
    try:
        gray = _decode(image_bytes)
        quality = _quality(gray)
        _assert_usable(quality)

        registration = _register(gray, template, scale)
        parsed = parse_pointer(registration.pointer)
        assert parsed is not None
        version, code = parsed

        if version != template["version"]:
            raise Rejected(
                f"That page was printed from template {version}, and this server reads "
                f"{template['version']}.")

        # The caller says which sheet it believes this is. Saying so here as
        # well as on the caller's side means the code that was actually read is
        # on the record, not just the fact that it did not match.
        if sheet_code and code != sheet_code.strip().upper():
            return {
                "status": "rejected",
                "reject_reason": (
                    f"That page carries sheet code {code}, not {sheet_code.strip().upper()}. "
                    "It belongs to a different sheet."),
                "sheet_code": code,
                "template_version": version,
                "registration": {
                    "markers_found": 4,
                    "alignment_error_px": registration.alignment_error,
                    "outline_ink": registration.outline_ink,
                    "rotated": registration.rotation != 0,
                    "pointer_read": registration.pointer,
                },
                "quality": quality,
                "rows": [],
            }

        rows = _measure(registration.warped, template, scale)

        return {
            "status": "detected",
            "reject_reason": None,
            "sheet_code": code,
            "template_version": version,
            "registration": {
                "markers_found": 4,
                "alignment_error_px": registration.alignment_error,
                "outline_ink": registration.outline_ink,
                "rotated": registration.rotation != 0,
                "pointer_read": registration.pointer,
            },
            "quality": quality,
            "rows": rows,
        }
    except Rejected as rejection:
        return {
            "status": "rejected",
            "reject_reason": rejection.reason,
            "sheet_code": None,
            "template_version": None,
            "registration": None,
            "quality": None,
            "rows": [],
        }
