import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { createDocument, drawFooters, finish } from '../src/pdf/letterhead.js';
import { drawAttendanceSheet, type SheetPage } from '../src/pdf/attendance-sheet.js';
import { BADGE_QUIET_MODULES, ROWS_PER_PAGE } from '../src/omr/template.js';
import { newSheetCode, pointerFor } from '../src/omr/sheetCode.js';

/**
 * Renders a sample attendance sheet without touching the database, for
 * checking how it prints and for the Python self-test to read back.
 *
 *   npm run omr:sample -- --pages 2 --out omr/sample.pdf
 *
 * It writes the sheet codes it minted to stdout as JSON, because the self-test
 * has to know which code each page carries to check the pointer resolves.
 */

function arg(name: string, fallback: string): string {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const pageCount = Math.max(1, Number(arg('pages', '1')));
const out = arg('out', 'omr-sample.pdf');
const rowsOnLastPage = Math.max(1, Number(arg('last-page-rows', String(ROWS_PER_PAGE))));

const NAMES = [
    'Peter Otieno', 'Joseph Mwangi', 'Charles Odhiambo', 'Francis Kimani', 'Anthony Wafula',
    'Michael Njoroge', 'Patrick Omondi', 'Stephen Mutiso', 'Bernard Kiplagat', 'Dominic Achieng',
    'Vincent Mutua', 'Julius Wekesa', 'Samuel Kariuki', 'Martin Onyango', 'George Mbugua',
    'Andrew Kilonzo', 'Thomas Barasa', 'Simon Njuguna', 'Lawrence Owino', 'Paul Chege',
    'Emmanuel Karisa', 'Benedict Waweru', 'Justus Ochieng',
];

const pages: SheetPage[] = [];
const codes: string[] = [];

for (let page = 0; page < pageCount; page += 1) {
    const code = newSheetCode();
    codes.push(code);
    const rows = page === pageCount - 1 ? rowsOnLastPage : ROWS_PER_PAGE;
    pages.push({
        sheetCode: code,
        pointerQr: await QRCode.toBuffer(pointerFor(code), {
            type: 'png', margin: BADGE_QUIET_MODULES, width: 480,
            errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' },
        }),
        pageNo: page + 1,
        totalPages: pageCount,
        rows: Array.from({ length: rows }, (_, index) => ({
            serial: page * ROWS_PER_PAGE + index + 1,
            fullName: NAMES[index % NAMES.length]!,
            prayerHouse: 'Malandi',
        })),
    });
}

const doc = createDocument();
drawAttendanceSheet(doc, {
    orgName: 'CMA Changamwe',
    eventTitle: 'Friday mass',
    eventDate: '2026-08-28',
    houseLabel: 'Malandi prayer house',
    pages,
});
const documentId = 'CMA-2026-ATT-SAMPLE';
const qr = await QRCode.toBuffer(`https://example.invalid/verify/${documentId}`, {
    type: 'png', margin: 0, width: 240, color: { dark: '#12293F', light: '#FFFFFF' },
});
drawFooters(doc, documentId, 'CMA Changamwe', qr);

writeFileSync(out, await finish(doc));
process.stdout.write(`${JSON.stringify({
    file: out,
    pages: pages.map((page) => ({
        page_no: page.pageNo, sheet_code: page.sheetCode, rows: page.rows.length,
    })),
}, null, 2)}\n`);
