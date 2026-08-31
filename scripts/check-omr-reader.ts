import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { detectSheet } from '../src/omr/detect.js';
import { templateDescriptor } from '../src/omr/template.js';

/**
 * Sends one photograph to the sheet reader over HTTP and prints what comes
 * back, using the same client the API uses.
 *
 * The Python service has its own self-test; this checks the wire between the
 * two, which that one cannot see.
 *
 *   OMR_SERVICE_URL=http://127.0.0.1:3002 \
 *     npm run omr:check -- --image page.jpg --sheet-code ABCDEFGHJK --rows 23
 */

function arg(name: string, fallback?: string): string {
    const index = process.argv.indexOf(`--${name}`);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (value === undefined) {
        if (fallback !== undefined)
            return fallback;
        throw new Error(`--${name} is required`);
    }
    return value;
}

const photo = readFileSync(arg('image'));
const sheetCode = arg('sheet-code');
const rows = Number(arg('rows'));

const result = await detectSheet(photo, sheetCode, templateDescriptor(rows));

process.stdout.write(`${JSON.stringify({
    status: result.status,
    reject_reason: result.reject_reason,
    sheet_code: result.sheet_code,
    template_version: result.template_version,
    registration: result.registration,
    quality: result.quality,
    marked: result.rows.filter((row) => row.state === 'marked').map((row) => row.index),
    uncertain: result.rows.filter((row) => row.state === 'uncertain').map((row) => row.index),
    rows_read: result.rows.length,
}, null, 2)}\n`);
