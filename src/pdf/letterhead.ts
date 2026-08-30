import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { DateTime } from 'luxon';
import { NAIROBI } from '../util/time.js';
import { verificationUrl } from '../documents/signing.js';

/**
 * One letterhead for every document the association issues, so a bio-data form
 * and a welfare statement are recognisably the same office.
 */

export const NAVY = '#17324F';
export const NAVY_DARK = '#12293F';
export const BRASS = '#8C5E12';
export const BRASS_LIGHT = '#F5E9D2';
export const INK = '#1A1815';
export const MUTED = '#6B645B';
export const SUBTLE = '#8A8279';
export const RULE = '#C4BEB5';
export const HAIRLINE = '#E0DBD3';

export const MARGIN = 54;
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Nothing is drawn below this line.
 *
 * Two thresholds have to clear. A printer will not put ink in the last few
 * millimetres of the sheet, and some consumer machines give up as much as 14mm
 * at the trailing edge. Worse, US Letter is 50pt shorter than A4, so A4 artwork
 * printed on Letter without scaling simply loses the bottom 17.6mm.
 *
 * 756pt leaves 30mm to the foot of an A4 sheet and still sits 36pt clear of
 * where a Letter page would end.
 */
export const SAFE_BOTTOM = 756;
/** The footer rule, with its text between it and SAFE_BOTTOM. */
export const FOOTER_Y = SAFE_BOTTOM - 15;
/** No body content below this, or it collides with the footer. */
export const CONTENT_BOTTOM = FOOTER_Y - 14;

export type Doc = InstanceType<typeof PDFDocument>;

export interface LetterheadOptions {
    documentId: string;
    title: string;
    subtitle?: string;
    orgName: string;
    /** Shown under the title, e.g. "Peter Otieno" or "All prayer houses". */
    subject?: string;
    /** Shown at the top right, e.g. "August 2026". */
    period?: string;
}

export function today(): string {
    return DateTime.now().setZone(NAIROBI).toFormat('d LLLL yyyy');
}

export function nowStamp(): string {
    return DateTime.now().setZone(NAIROBI).toFormat('d LLLL yyyy, HH:mm');
}

export function formatDate(value: string | Date | null | undefined): string {
    if (!value) return '-';
    const date = value instanceof Date
        ? DateTime.fromJSDate(value).setZone(NAIROBI)
        : DateTime.fromISO(String(value).length <= 10 ? `${value}T12:00:00` : String(value), { zone: NAIROBI });
    return date.isValid ? date.toFormat('d LLL yyyy') : '-';
}

export function formatMonth(period: string | null | undefined): string {
    if (!period) return '-';
    const date = DateTime.fromISO(`${period}-01`, { zone: NAIROBI });
    return date.isValid ? date.toFormat('LLLL yyyy') : period;
}

export function kes(amount: string | number | null | undefined): string {
    if (amount === null || amount === undefined) return '-';
    const n = typeof amount === 'string' ? Number(amount) : amount;
    if (!Number.isFinite(n)) return '-';
    return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function createDocument(): Doc {
    return new PDFDocument({
        size: 'A4',
        margins: { top: MARGIN, bottom: PAGE_HEIGHT - CONTENT_BOTTOM, left: MARGIN, right: MARGIN },
        bufferPages: true,
        info: { Producer: 'CMA Changamwe', Creator: 'CMA Changamwe' },
    });
}

/** The cross mark, drawn rather than loaded, so no asset has to ship. */
function drawMark(doc: Doc, x: number, y: number, size: number) {
    doc.save();
    doc.roundedRect(x, y, size, size, 5).fill(NAVY);
    const bar = Math.max(1.6, size * 0.075);
    doc.fill(BRASS_LIGHT);
    doc.rect(x + size / 2 - bar / 2, y + size * 0.17, bar, size * 0.66).fill();
    doc.rect(x + size * 0.25, y + size * 0.36, size * 0.5, bar).fill();
    doc.restore();
}

/**
 * The masthead, drawn once at the top of the first page.
 * Returns the y to begin the body at.
 */
export function drawLetterhead(doc: Doc, opts: LetterheadOptions): number {
    const top = MARGIN;
    drawMark(doc, MARGIN, top, 34);

    doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY_DARK)
        .text(opts.orgName.toUpperCase(), MARGIN + 46, top + 2, { characterSpacing: 0.6 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text('CATHOLIC MEN ASSOCIATION  ·  CHANGAMWE PARISH', MARGIN + 46, top + 20, { characterSpacing: 0.9 });

    if (opts.period) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED)
            .text(opts.period, MARGIN, top + 4, { width: CONTENT_WIDTH, align: 'right' });
    }

    // Two rules, the thin brass one under the heavier navy, as on the crest.
    doc.moveTo(MARGIN, top + 42).lineTo(MARGIN + CONTENT_WIDTH, top + 42)
        .lineWidth(1.6).strokeColor(NAVY).stroke();
    doc.moveTo(MARGIN, top + 45.4).lineTo(MARGIN + CONTENT_WIDTH, top + 45.4)
        .lineWidth(0.7).strokeColor(BRASS).stroke();

    let y = top + 62;
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(opts.title, MARGIN, y);
    y = doc.y + 2;

    if (opts.subject) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(opts.subject, MARGIN, y);
        y = doc.y + 1;
    }
    if (opts.subtitle) {
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
            .text(opts.subtitle, MARGIN, y, { width: CONTENT_WIDTH });
        y = doc.y;
    }

    return y + 16;
}

/**
 * Moves to a new page if a block of the given height will not fit above the
 * footer. Anything drawn as a unit, such as a signature line and its caption,
 * has to ask first or pdfkit will split it across two pages.
 */
export function ensureSpace(doc: Doc, y: number, needed: number): number {
    if (y + needed <= CONTENT_BOTTOM) return y;
    doc.addPage();
    return MARGIN;
}

/** A section heading with a hairline beneath it. */
export function sectionHeading(doc: Doc, text: string, y?: number): number {
    const top = y ?? doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BRASS)
        .text(text.toUpperCase(), MARGIN, top, { characterSpacing: 0.8 });
    const ruleY = doc.y + 3;
    doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + CONTENT_WIDTH, ruleY)
        .lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    return ruleY + 9;
}

/** A label above its value, two to a row. `lead` is the space after each row. */
export function fieldGrid(doc: Doc, pairs: Array<[string, string]>, startY: number, columns = 2, lead = 9): number {
    const gap = 14;
    const colWidth = (CONTENT_WIDTH - gap * (columns - 1)) / columns;
    let y = startY;

    for (let i = 0; i < pairs.length; i += columns) {
        const row = pairs.slice(i, i + columns);
        let rowHeight = 0;
        row.forEach(([label, value], c) => {
            const x = MARGIN + c * (colWidth + gap);
            doc.font('Helvetica').fontSize(7).fillColor(SUBTLE)
                .text(label.toUpperCase(), x, y, { width: colWidth, characterSpacing: 0.5 });
            const valueY = doc.y + 1;
            doc.font('Helvetica').fontSize(10).fillColor(INK)
                .text(value || '-', x, valueY, { width: colWidth });
            rowHeight = Math.max(rowHeight, doc.y - y);
        });
        y += rowHeight + lead;
    }
    return y;
}

export interface Column {
    header: string;
    width: number;
    align?: 'left' | 'right';
    /** Rendered bold, for a total or a name. */
    strong?: boolean;
}

/** A table that repeats its header whenever it crosses a page. */
export function table(
    doc: Doc,
    columns: Column[],
    rows: string[][],
    startY: number,
    onNewPage?: () => void,
): number {
    const bottomLimit = CONTENT_BOTTOM;
    let y = startY;

    const header = () => {
        doc.rect(MARGIN, y - 3, CONTENT_WIDTH, 17).fill('#F8F6F3');
        let x = MARGIN + 5;
        doc.font('Helvetica-Bold').fontSize(7).fillColor(SUBTLE);
        for (const col of columns) {
            doc.text(col.header.toUpperCase(), x, y + 2, {
                width: col.width - 10, align: col.align ?? 'left', characterSpacing: 0.5,
            });
            x += col.width;
        }
        y += 17;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y)
            .lineWidth(0.5).strokeColor(RULE).stroke();
        y += 6;
    };

    header();

    for (const row of rows) {
        // Measure the tallest cell before committing to the row.
        let height = 0;
        columns.forEach((col, i) => {
            const h = doc.font('Helvetica').fontSize(8.5)
                .heightOfString(row[i] ?? '', { width: col.width - 10 });
            height = Math.max(height, h);
        });

        if (y + height + 6 > bottomLimit) {
            doc.addPage();
            onNewPage?.();
            y = MARGIN;
            header();
        }

        let x = MARGIN + 5;
        columns.forEach((col, i) => {
            doc.font(col.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(INK)
                .text(row[i] ?? '', x, y, { width: col.width - 10, align: col.align ?? 'left' });
            x += col.width;
        });

        y += height + 5;
        doc.moveTo(MARGIN, y - 2).lineTo(MARGIN + CONTENT_WIDTH, y - 2)
            .lineWidth(0.4).strokeColor(HAIRLINE).stroke();
        y += 3;
    }

    return y;
}

/**
 * The verification panel: how a stranger checks this document is genuine.
 * Placed at the end of the body, before the footers are stamped.
 */
export async function drawVerification(doc: Doc, documentId: string, y: number): Promise<void> {
    const url = verificationUrl(documentId);
    const boxHeight = 96;

    let top = y + 10;
    if (top + boxHeight > CONTENT_BOTTOM) {
        doc.addPage();
        top = MARGIN;
    }

    doc.roundedRect(MARGIN, top, CONTENT_WIDTH, boxHeight, 4)
        .lineWidth(0.7).strokeColor(RULE).stroke();

    const qr = await QRCode.toBuffer(url, {
        type: 'png', margin: 0, width: 240,
        color: { dark: NAVY_DARK, light: '#FFFFFF' },
    });
    doc.image(qr, MARGIN + 12, top + 12, { width: 72, height: 72 });

    const textX = MARGIN + 98;
    const textWidth = CONTENT_WIDTH - 110;

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BRASS)
        .text('VERIFY THIS DOCUMENT', textX, top + 13, { characterSpacing: 0.8 });

    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text('Scan the code, or visit the address below, to confirm this document was issued by '
            + 'the association and has not been altered since.', textX, top + 26, { width: textWidth });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
        .text(url, textX, top + 54, { width: textWidth, link: url, underline: false });

    doc.font('Helvetica').fontSize(7.5).fillColor(SUBTLE)
        .text(`Document ${documentId}  ·  sealed with an Ed25519 signature`, textX, top + 70, { width: textWidth });
}

/**
 * Stamped on every page once the body is finished, so the page count is known.
 */
export function drawFooters(doc: Doc, documentId: string, orgName: string): number {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);

        // The footer sits below the text area on purpose. Without lifting the
        // bottom margin first, pdfkit treats that as an overflow and starts a
        // new page for every footer it draws.
        const bottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        const y = FOOTER_Y;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y)
            .lineWidth(0.5).strokeColor(HAIRLINE).stroke();

        doc.font('Helvetica').fontSize(7).fillColor(SUBTLE);
        doc.text(`${orgName}  ·  Issued ${nowStamp()}`, MARGIN, y + 6, {
            width: CONTENT_WIDTH * 0.6, lineBreak: false,
        });
        doc.text(`${documentId}  ·  Page ${i + 1} of ${range.count}`, MARGIN + CONTENT_WIDTH * 0.4, y + 6, {
            width: CONTENT_WIDTH * 0.6, align: 'right', lineBreak: false,
        });

        doc.page.margins.bottom = bottomMargin;
    }
    return range.count;
}

/** Collects the finished PDF into one buffer. */
export function finish(doc: Doc): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}
