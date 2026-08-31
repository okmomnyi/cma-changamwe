"""End-to-end check that the renderer and the reader agree about the geometry.

The two sides of Phase 9 are written in different languages against one shared
description of the page. Nothing catches a disagreement between them except
putting a sheet through both, so this does that: it takes a real PDF from the
Node renderer, rasterises it, ticks a known set of boxes, roughs the page up
the way a phone in a church hall would, and asks the reader what it sees.

    npm run omr:template > omr/template.json
    npm run omr:sample -- --pages 1 --out omr/sample.pdf
    python selftest.py --pdf sample.pdf --template template.json --sheet-code ABCDEFGHJK

A pass means the codes resolve, the corners register, and every row comes back
with the state it was given. It is not a substitute for calibrating on real
photographs, and it does not pretend to be: a synthetic tick is cleaner than a
real one. What it does prove is that a row is read from the place it was drawn.

Needs pypdfium2 in addition to the service's own requirements.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import cv2
import numpy as np

from detect import detect

RASTER_DPI = 300


def rasterise(pdf: pathlib.Path, page_index: int) -> np.ndarray:
    import pypdfium2

    document = pypdfium2.PdfDocument(str(pdf))
    try:
        page = document[page_index]
        bitmap = page.render(scale=RASTER_DPI / 72.0, grayscale=True)
        # to_numpy rather than to_pil, so Pillow is not dragged in for one call.
        image = np.array(bitmap.to_numpy(), copy=True)
    finally:
        document.close()
    if image.ndim == 3:
        image = image[:, :, 0] if image.shape[2] == 1 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return np.ascontiguousarray(image, dtype=np.uint8)


def tick(page: np.ndarray, template: dict, row: int) -> None:
    """A ballpoint check mark, drawn where a person would put one."""
    scale = RASTER_DPI / 72.0
    rows = template["rows"]
    box = rows["box"]
    cx = box["cx"] * scale
    top = (rows["top"] + row * rows["height"] + (rows["height"] - box["size"]) / 2) * scale
    size = box["size"] * scale
    thickness = max(2, int(round(1.2 * scale)))

    left = (int(cx - size * 0.30), int(top + size * 0.52))
    knee = (int(cx - size * 0.06), int(top + size * 0.78))
    right = (int(cx + size * 0.34), int(top + size * 0.16))
    cv2.line(page, left, knee, 0, thickness, lineType=cv2.LINE_AA)
    cv2.line(page, knee, right, 0, thickness, lineType=cv2.LINE_AA)


def photograph(page: np.ndarray, skew: float = 0.03, dim: bool = False) -> bytes:
    """What a phone gives you: a bit of perspective, uneven light, JPEG."""
    height, width = page.shape[:2]

    # Sit the page on a background, so the corner marks are not at the very
    # edge of the frame, as they never are in a real photograph.
    pad = int(min(height, width) * 0.06)
    canvas = np.full((height + 2 * pad, width + 2 * pad), 236, dtype=np.uint8)
    canvas[pad:pad + height, pad:pad + width] = page

    h, w = canvas.shape[:2]
    source = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dx, dy = w * skew, h * skew
    target = np.float32([
        [dx * 0.8, dy * 0.4],
        [w - dx * 0.3, dy * 1.1],
        [w - dx * 0.9, h - dy * 0.5],
        [dx * 0.2, h - dy * 1.0],
    ])
    warped = cv2.warpPerspective(
        canvas, cv2.getPerspectiveTransform(source, target), (w, h), borderValue=225)

    # One side lit more than the other, which is what a hall window does.
    gradient = np.linspace(0.72 if dim else 0.88, 1.06, w, dtype=np.float32)
    lit = np.clip(warped.astype(np.float32) * gradient[None, :], 0, 255)
    if dim:
        lit *= 0.35

    lit = cv2.GaussianBlur(lit.astype(np.uint8), (3, 3), 0)
    ok, encoded = cv2.imencode(".jpg", lit, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    if not ok:
        raise RuntimeError("could not encode the synthetic photograph")
    return encoded.tobytes()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=pathlib.Path, required=True)
    parser.add_argument("--template", type=pathlib.Path, required=True)
    parser.add_argument("--sheet-code", required=True)
    parser.add_argument("--page", type=int, default=1, help="1-based page of the PDF")
    parser.add_argument("--rows", type=int, default=None, help="rows printed on that page")
    parser.add_argument("--write", type=pathlib.Path, default=None,
                        help="also write the synthetic photograph here, to look at")
    args = parser.parse_args()

    template = json.loads(args.template.read_text(encoding="utf-8"))
    if args.rows is not None:
        template["rows"]["count"] = args.rows
    count = int(template["rows"]["count"])

    page = rasterise(args.pdf, args.page - 1)

    # Every third row, so runs of blanks and runs of marks are both covered.
    marked = {row for row in range(count) if row % 3 == 0}
    for row in sorted(marked):
        tick(page, template, row)

    image = photograph(page)
    if args.write:
        args.write.write_bytes(image)

    result = detect(image, args.sheet_code, template)
    failures: list[str] = []

    if result["status"] != "detected":
        print(f"FAIL  the page was rejected: {result['reject_reason']}")
        return 1
    if result["sheet_code"] != args.sheet_code:
        failures.append(f"pointer read {result['sheet_code']}, expected {args.sheet_code}")
    if len(result["rows"]) != count:
        failures.append(f"{len(result['rows'])} rows read, expected {count}")

    for cell in result["rows"]:
        expected = "marked" if cell["index"] in marked else "blank"
        if cell["state"] != expected:
            failures.append(
                f"row {cell['index']}: read {cell['state']} "
                f"(fill {cell['fill_ratio']:.3f}), expected {expected}")

    registration = result["registration"]
    print(f"registered: corners {registration['alignment_error_px']}px out, "
          f"rotated {registration['rotated']}, pointer {registration['pointer_read']}")
    print(f"quality: {result['quality']}")
    ticked = [c["fill_ratio"] for c in result["rows"] if c["index"] in marked]
    empty = [c["fill_ratio"] for c in result["rows"] if c["index"] not in marked]
    if ticked:
        print(f"ticked boxes:  {min(ticked):.3f} to {max(ticked):.3f}")
    if empty:
        print(f"blank boxes:   {min(empty):.3f} to {max(empty):.3f}")

    # A page held the other way round is still that page.
    turned = cv2.imencode(".jpg", cv2.rotate(
        cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE),
        cv2.ROTATE_180), [int(cv2.IMWRITE_JPEG_QUALITY), 82])[1].tobytes()
    upside_down = detect(turned, args.sheet_code, template)
    if upside_down["status"] != "detected":
        failures.append(
            f"the same page photographed upside down was rejected: {upside_down['reject_reason']}")
    else:
        wrong = [cell["index"] for cell in upside_down["rows"]
                 if cell["state"] != ("marked" if cell["index"] in marked else "blank")]
        if wrong:
            failures.append(f"upside down, rows {wrong} read differently")
        else:
            print(f"upside down read the same way "
                  f"(turned back: {upside_down['registration']['rotated']})")

    # The failure that matters is not a refusal, it is a page read from the
    # wrong place and recorded as if it were right. A sheet photographed at a
    # steep angle registers plausibly and then lands a row out, so it has to
    # come back refused rather than confidently wrong.
    steep = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    height, width = steep.shape
    turn = cv2.getRotationMatrix2D((width / 2, height / 2), 12, 1.0)
    steep = cv2.warpAffine(steep, turn, (width, height), borderValue=235)
    slanted = detect(
        cv2.imencode(".jpg", steep, [int(cv2.IMWRITE_JPEG_QUALITY), 82])[1].tobytes(),
        args.sheet_code, template)
    if slanted["status"] == "rejected":
        print(f"steeply angled page correctly refused: {slanted['reject_reason']}")
    else:
        wrong = [cell["index"] for cell in slanted["rows"]
                 if cell["state"] != ("marked" if cell["index"] in marked else "blank")]
        if wrong:
            failures.append(
                f"a steeply angled page was read wrongly rather than refused: rows {wrong}")
        else:
            print("steeply angled page still read correctly")

    # A page too dim or too flat to read has to be refused, not guessed at.
    dark = detect(photograph(page, dim=True), args.sheet_code, template)
    if dark["status"] != "rejected":
        failures.append("a photograph too poorly lit to read was accepted instead of refused")
    else:
        print(f"under-lit page correctly refused: {dark['reject_reason']}")

    # So does a page photographed against the wrong sheet.
    wrong = detect(image, "22222222ZZ", template)
    if wrong["status"] != "rejected":
        failures.append("a page read against the wrong sheet code was accepted")
    else:
        print(f"wrong sheet correctly refused: {wrong['reject_reason']}")

    if failures:
        print()
        for failure in failures:
            print(f"FAIL  {failure}")
        return 1

    print(f"\nPASS  {count} rows, {len(marked)} marked, all read as drawn.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
