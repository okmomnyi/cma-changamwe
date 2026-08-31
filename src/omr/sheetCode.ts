import { createHash, randomInt } from 'node:crypto';
import { TEMPLATE_VERSION } from './template.js';

/**
 * The sheet code, and the pointer the QR carries.
 *
 * A pointer, not a payload. The QR encodes a ten-character code, the template
 * version and a checksum, and nothing else: the meeting, the prayer house, the
 * page and the member list are all looked up from the code on the server. That
 * is what keeps the symbol small and sparse enough to sit unobtrusively in the
 * header and still decode from a phone photograph.
 *
 * The checksum is not security. It only stops a misread code from resolving to
 * some other parish's sheet by accident; the code has to exist in the database
 * before anything is read off the page.
 */

// The same alphabet the document ids use: no I, O, 0 or 1, because these are
// read aloud and typed by hand when a scan has to be traced back.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const SHEET_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{10}$/;
const POINTER_PATTERN = /^CMA-([A-Z][0-9])-([2-9A-HJ-NP-Z]{10})-([2-9A-HJ-NP-Z]{4})$/;

export function newSheetCode(): string {
    return Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

function checksum(version: string, code: string): string {
    const digest = createHash('sha256').update(`${version}:${code}`).digest();
    return Array.from(digest.subarray(0, 4), (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/** What is encoded in the header QR. Uppercase and hyphens only, which keeps
 *  the symbol in alphanumeric mode and therefore at version 2. */
export function pointerFor(code: string, version: string = TEMPLATE_VERSION): string {
    return `CMA-${version}-${code}-${checksum(version, code)}`;
}

export interface Pointer {
    version: string;
    code: string;
}

export function parsePointer(payload: string): Pointer | null {
    const match = POINTER_PATTERN.exec(payload.trim().toUpperCase());
    if (!match)
        return null;
    const version = match[1] as string;
    const code = match[2] as string;
    if (checksum(version, code) !== match[3])
        return null;
    return { version, code };
}
