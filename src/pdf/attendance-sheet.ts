import {
    CONTENT_BOTTOM, CONTENT_WIDTH, HAIRLINE, INK, MARGIN, MUTED, NAVY, RULE, SUBTLE,
    drawLetterhead, formatDate, type Doc,
} from './letterhead.js';
import {
    BADGE_SIZE, BOX_CX, BOX_SIZE, COLUMNS, MARKER_CENTRES, MARKER_SIZE,
    ROWS_TOP, ROW_HEIGHT, TABLE_HEADER_HEIGHT, TABLE_TOP, rowBoxY,
} from '../omr/template.js';

/**
 * The attendance sheet: the standard letterhead, plus the three things the
 * reader needs. A pointer QR in the header, four registration squares in the
 * corners, and one Present box per row.
 *
 * The footer is untouched, so the sheet is still a document of the association
 * and still carries its verification code on every page.
 *
 * Unlike every other document here, the geometry of the rows is fixed rather
 * than flowed. A photograph is mapped back onto these coordinates, so a row
 * that moved by a few points because a name was long would be read from the
 * wrong place. Everything below the letterhead is drawn at absolute positions
 * taken from the template, and a page that would not fit is refused rather
 * than allowed to reflow.
 */

export interface SheetRow {
    /** 1-based across the whole event, not just this page. */
    serial: number;
    fullName: string;
    prayerHouse: string;
}

export interface SheetPage {
    sheetCode: string;
    /** The pointer QR, already rendered as a PNG. */
    pointerQr: Buffer;
    pageNo: number;
    totalPages: number;
    rows: SheetRow[];
}

export interface SheetDocument {
    orgName: string;
    eventTitle: string;
    eventDate: string;
    /** "Malandi prayer house" or "All prayer houses". */
    houseLabel: string;
    pages: SheetPage[];
}

/** The four registration squares, in the margin band outside the content. */
function drawRegistrationMarks(doc: Doc): void {
    doc.save();
    for (const [cx, cy] of MARKER_CENTRES) {
        doc.rect(cx - MARKER_SIZE / 2, cy - MARKER_SIZE / 2, MARKER_SIZE, MARKER_SIZE)
            .fill('#000000');
    }
    doc.restore();
}

function drawTableHeader(doc: Doc): void {
    doc.rect(MARGIN, TABLE_TOP, CONTENT_WIDTH, TABLE_HEADER_HEIGHT).fill('#F8F6F3');
    doc.font('Helvetica-Bold').fontSize(7).fillColor(SUBTLE);
    const labels: Array<[keyof typeof COLUMNS, string, 'left' | 'center']> = [
        ['index', 'NO.', 'left'],
        ['name', 'MEMBER', 'left'],
        ['house', 'PRAYER HOUSE', 'left'],
        ['present', 'PRESENT', 'center'],
    ];
    for (const [key, label, align] of labels) {
        const col = COLUMNS[key];
        doc.text(label, col.x + 5, TABLE_TOP + 6, {
            width: col.width - 10, align, characterSpacing: 0.5, lineBreak: false,
        });
    }
    doc.moveTo(MARGIN, TABLE_TOP + TABLE_HEADER_HEIGHT)
        .lineTo(MARGIN + CONTENT_WIDTH, TABLE_TOP + TABLE_HEADER_HEIGHT)
        .lineWidth(0.5).strokeColor(RULE).stroke();
}

function drawRow(doc: Doc, index: number, row: SheetRow): void {
    const top = ROWS_TOP + index * ROW_HEIGHT;
    const textY = top + (ROW_HEIGHT - 9) / 2;

    doc.font('Helvetica').fontSize(8).fillColor(SUBTLE)
        .text(String(row.serial), COLUMNS.index.x + 5, textY + 0.5, {
            width: COLUMNS.index.width - 10, lineBreak: false,
        });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
        .text(row.fullName, COLUMNS.name.x + 5, textY, {
            width: COLUMNS.name.width - 10, lineBreak: false, ellipsis: true,
        });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(row.prayerHouse, COLUMNS.house.x + 5, textY + 0.5, {
            width: COLUMNS.house.width - 10, lineBreak: false, ellipsis: true,
        });

    // The box the reader ticks. Square, open, and heavy enough that a phone
    // camera keeps its outline; the detector measures well inside it.
    doc.roundedRect(BOX_CX - BOX_SIZE / 2, rowBoxY(index), BOX_SIZE, BOX_SIZE, 2)
        .lineWidth(1).strokeColor(NAVY).stroke();

    const foot = top + ROW_HEIGHT;
    doc.moveTo(MARGIN, foot).lineTo(MARGIN + CONTENT_WIDTH, foot)
        .lineWidth(0.4).strokeColor(HAIRLINE).stroke();
}

export function drawAttendanceSheet(doc: Doc, sheet: SheetDocument): number {
    sheet.pages.forEach((page, pageIndex) => {
        if (pageIndex > 0)
            doc.addPage();

        const headerBottom = drawLetterhead(doc, {
            documentId: '',
            orgName: sheet.orgName,
            title: 'Attendance Sheet',
            subject: sheet.eventTitle,
            subtitle: `${sheet.houseLabel}. Page ${page.pageNo} of ${page.totalPages}. `
                + 'Tick the box beside every member present.',
            period: formatDate(sheet.eventDate),
            headerBadge: page.pointerQr,
            headerBadgeSize: BADGE_SIZE,
        });

        // Fixed geometry is the whole point. If the heading ever grew into the
        // table, rows would sit where the reader does not expect them, so the
        // sheet is refused rather than printed wrong.
        if (headerBottom > TABLE_TOP) {
            throw new Error(
                `The attendance sheet heading runs to ${headerBottom.toFixed(1)}pt, past the `
                + `table at ${TABLE_TOP}pt. Shorten the event title.`);
        }

        drawRegistrationMarks(doc);
        drawTableHeader(doc);
        page.rows.forEach((row, index) => drawRow(doc, index, row));

        // The code in plain characters as well as in the symbol, so a sheet
        // can still be traced when the QR is torn, smudged or cut off.
        const noteY = Math.min(ROWS_TOP + page.rows.length * ROW_HEIGHT + 5, CONTENT_BOTTOM - 9);
        doc.font('Helvetica').fontSize(6.5).fillColor(SUBTLE)
            .text(
                'Any mark counts as present. A blank box is absent. Apologies are recorded when '
                + 'the sheet is reviewed.',
                MARGIN, noteY, { width: CONTENT_WIDTH - 120, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(SUBTLE)
            .text(`SHEET ${page.sheetCode}`, MARGIN, noteY, {
                width: CONTENT_WIDTH, align: 'right', characterSpacing: 0.6, lineBreak: false,
            });
    });

    return CONTENT_BOTTOM;
}
