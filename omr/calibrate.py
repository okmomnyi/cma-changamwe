"""Pick the two fill-ratio thresholds from real photographed sheets.

The shipped defaults are a starting point, not a measurement. Print a batch of
sheets, tick them the way the roll-callers actually tick them, photograph them
the way the secretary actually photographs them, and run this over the folder.

It prints where the two clusters fall. An empty box carries only paper grain
and camera noise; a ticked one carries a stroke. If the gap between them is
wide, put LOW and HIGH inside it with room on both sides. If it is narrow,
that is the signal to switch the sheet to "shade the box" rather than to
squeeze the thresholds together.

    python calibrate.py --template template.json photos/

Write the chosen values into the database, not into this file:

    INSERT INTO matrix_config (key, value) VALUES ('omr_fill_low', '0.05')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value;
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

from detect import Rejected, _measure, _quality, _register

SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=pathlib.Path, help="folder of photographed sheets")
    parser.add_argument("--template", type=pathlib.Path, required=True,
                        help="template JSON, from: npm run omr:template")
    args = parser.parse_args()

    template = json.loads(args.template.read_text(encoding="utf-8"))
    scale = float(template["render_dpi"]) / 72.0

    # Measure every cell, then look at the shape of the answer rather than at
    # any one page.
    ratios: list[float] = []
    read = 0
    refused = 0

    photos = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in SUFFIXES)
    if not photos:
        print(f"No images in {args.folder}", file=sys.stderr)
        return 1

    for photo in photos:
        try:
            from detect import _decode
            gray = _decode(photo.read_bytes())
            registration = _register(gray, template, scale)
            cells = _measure(registration.warped, template, scale)
        except Rejected as rejection:
            refused += 1
            print(f"  refused  {photo.name}: {rejection.reason}")
            continue
        read += 1
        quality = _quality(gray)
        ratios.extend(cell["fill_ratio"] for cell in cells)
        print(f"  read     {photo.name}: {len(cells)} rows, "
              f"blur {quality['blur']:.0f}, brightness {quality['brightness']:.0f}, "
              f"rotated {registration.rotation != 0}")

    if not ratios:
        print("\nNothing could be measured. Fix the photographs before choosing thresholds.")
        return 1

    ratios.sort()
    print(f"\n{read} pages read, {refused} refused, {len(ratios)} boxes measured.\n")

    # A histogram, because the point is to see two clusters and the gap
    # between them, not to trust a single summary number.
    buckets = 25
    counts = [0] * buckets
    for ratio in ratios:
        counts[min(buckets - 1, int(ratio * buckets))] += 1
    widest = max(counts) or 1
    for index, count in enumerate(counts):
        lower = index / buckets
        bar = "#" * int(48 * count / widest)
        print(f"  {lower:0.2f}-{(lower + 1 / buckets):0.2f}  {count:6d}  {bar}")

    # Where the two clusters actually part, found the same way a threshold is
    # chosen anywhere else: the split that leaves the least variance inside the
    # two halves. Guessing at a fixed midpoint would assume what we are trying
    # to measure.
    split = _otsu(ratios)
    empty_side = [r for r in ratios if r < split]
    marked_side = [r for r in ratios if r >= split]
    print(f"\n  The two clusters part at {split:0.3f} "
          f"({len(empty_side)} blank, {len(marked_side)} marked).")
    if empty_side and marked_side:
        top = empty_side[int((len(empty_side) - 1) * 0.995)]
        bottom = marked_side[int((len(marked_side) - 1) * 0.005)]
        print(f"  99.5% of the blank boxes sit below {top:0.3f}")
        print(f"  99.5% of the marked boxes sit above {bottom:0.3f}")
        if bottom <= top:
            print("\n  The clusters overlap. Do not squeeze the thresholds together: change the")
            print("  sheet to say shade the box, reprint, and measure again.")
        else:
            print(f"\n  Suggested: omr_fill_low {top + (bottom - top) * 0.25:0.3f}, "
                  f"omr_fill_high {top + (bottom - top) * 0.75:0.3f}")
            print("  Everything between them is flagged for a person, which is the point.")
    else:
        print("\n  Only one cluster is present. Photograph sheets that carry both ticks and blanks.")
    return 0


def _otsu(sorted_values: list[float]) -> float:
    """The between-class variance maximum, over the measured ratios."""
    total = len(sorted_values)
    grand = sum(sorted_values)
    running = 0.0
    best_split = sorted_values[total // 2]
    best_score = -1.0
    for index in range(1, total):
        running += sorted_values[index - 1]
        weight = index / total
        gap = ((grand - running) / (total - index)) - (running / index)
        score = weight * (1 - weight) * gap * gap
        if score > best_score:
            best_score = score
            best_split = (sorted_values[index - 1] + sorted_values[index]) / 2
    return best_split


if __name__ == "__main__":
    raise SystemExit(main())
