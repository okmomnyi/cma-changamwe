import { CONTENT_WIDTH, MARGIN, PAGE_HEIGHT, PAGE_WIDTH } from '../pdf/letterhead.js';

/**
 * The geometry of an attendance sheet, in PDF points from the top-left of the
 * page, and the one place it is written down.
 *
 * The renderer draws from these numbers and the detector is handed the same
 * numbers with every photograph, so the two cannot drift. A change here is a
 * new template version: sheets already printed keep their own, and are still
 * read correctly, because the version travels in the pointer QR.
 */

export const TEMPLATE_VERSION = 'A1';

/**
 * Four small solid squares, in the margin band outside the printable content.
 * They can be small because the pointer QR in the header and the verification
 * QR in the footer already anchor opposite diagonals; these only pin the other
 * two corners. `inset` is the distance of each centre from its page edges,
 * 8.5mm, which clears the few millimetres a printer cannot reach.
 */
export const MARKER_SIZE = 8;
export const MARKER_INSET = 24;

export const MARKER_CENTRES: ReadonlyArray<readonly [number, number]> = [
    [MARKER_INSET, MARKER_INSET],
    [PAGE_WIDTH - MARKER_INSET, MARKER_INSET],
    [PAGE_WIDTH - MARKER_INSET, PAGE_HEIGHT - MARKER_INSET],
    [MARKER_INSET, PAGE_HEIGHT - MARKER_INSET],
];

/**
 * The pointer QR, top-right of the header. It carries a sheet code and nothing
 * else, so it stays a small, sparse symbol: everything about the meeting is
 * looked up from that code on the server.
 */
export const BADGE_SIZE = 56;
export const BADGE_X = MARGIN + CONTENT_WIDTH - BADGE_SIZE;
export const BADGE_Y = MARGIN;
/** Quiet-zone modules the encoder leaves around the symbol. */
export const BADGE_QUIET_MODULES = 2;

/** The column header band, then the rows beneath it. */
export const TABLE_TOP = 214;
export const TABLE_HEADER_HEIGHT = 18;
export const ROWS_TOP = TABLE_TOP + TABLE_HEADER_HEIGHT + 4;
export const ROW_HEIGHT = 20;
/**
 * Chosen so the last box finishes clear of the note beneath the table, which
 * carries the sheet code in plain characters. One more row would put ink where
 * the footer band starts.
 */
export const ROWS_PER_PAGE = 23;

/**
 * There is no member number on a member record, so the numbering here is the
 * roll itself: row 1 upward, continuing across the pages of one event. That is
 * what a roll-caller reads down, and it is what the review screen shows beside
 * each name.
 */
export const COLUMNS = {
    index: { x: MARGIN, width: 34 },
    name: { x: MARGIN + 34, width: 268 },
    house: { x: MARGIN + 302, width: 116 },
    present: { x: MARGIN + 418, width: CONTENT_WIDTH - 418 },
} as const;

/** One Present box per row, centred in its column. */
export const BOX_SIZE = 15;
export const BOX_CX = COLUMNS.present.x + COLUMNS.present.width / 2;

/**
 * How far inside the printed box the detector measures. The outline is ink
 * itself; measuring over it would read every empty box as part filled.
 */
export const BOX_DETECT_INSET = 3;

/**
 * An empty box, measured inside its outline, carries only paper grain and
 * camera noise, which is a few per cent at most. A ballpoint tick across a box
 * this size covers something like a sixth of it, and a shaded box far more.
 * Between the two is where the pipeline says it does not know and a person
 * looks.
 *
 * These are the shipped defaults, deliberately set below where a thin tick
 * lands rather than at it. Calibrate them on a batch of real photographed
 * sheets before go-live with `omr/calibrate.py`, and store the result in
 * `matrix_config` as `omr_fill_low` and `omr_fill_high`: it is a database
 * change, not a deployment.
 */
export const DEFAULT_FILL_LOW = 0.04;
export const DEFAULT_FILL_HIGH = 0.12;

/** The page is warped to this resolution before anything is measured. */
export const RENDER_DPI = 200;

export function rowBoxY(index: number): number {
    return ROWS_TOP + index * ROW_HEIGHT + (ROW_HEIGHT - BOX_SIZE) / 2;
}

export interface TemplateDescriptor {
    version: string;
    page: { width: number; height: number };
    markers: { size: number; centres: Array<[number, number]> };
    badge: { x: number; y: number; size: number };
    rows: {
        top: number;
        height: number;
        count: number;
        box: { cx: number; size: number; detect_inset: number };
    };
    thresholds: { low: number; high: number };
    render_dpi: number;
}

/**
 * What travels with a photograph to the detection service. It is stateless
 * about layout: everything it needs to find a cell is in here.
 */
export function templateDescriptor(rowCount: number, thresholds?: { low: number; high: number }): TemplateDescriptor {
    return {
        version: TEMPLATE_VERSION,
        page: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
        markers: {
            size: MARKER_SIZE,
            centres: MARKER_CENTRES.map(([x, y]) => [x, y] as [number, number]),
        },
        badge: { x: BADGE_X, y: BADGE_Y, size: BADGE_SIZE },
        rows: {
            top: ROWS_TOP,
            height: ROW_HEIGHT,
            count: rowCount,
            box: { cx: BOX_CX, size: BOX_SIZE, detect_inset: BOX_DETECT_INSET },
        },
        thresholds: thresholds ?? { low: DEFAULT_FILL_LOW, high: DEFAULT_FILL_HIGH },
        render_dpi: RENDER_DPI,
    };
}
