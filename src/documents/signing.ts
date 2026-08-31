import { createHash, createPrivateKey, createPublicKey, randomInt, sign, verify, type KeyObject } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Ed25519 over the SHA-256 of the finished PDF.
 *
 * The private key never leaves the server. The public key is published at
 * /api/verify/public-key so a university or employer can check a signature
 * without trusting this system to tell them the truth about itself.
 */

export const DOCUMENT_PREFIX = 'CMA';

/** Three letters in the document id, so the kind is readable at a glance. */
export const KIND_CODES = {
    member_biodata: 'BIO',
    matrix_report: 'MTX',
    member_roster: 'ROS',
    contributions_statement: 'CON',
    matrix_summary: 'SUM',
    welfare_statement: 'WEL',
    attendance_sheet: 'ATT',
} as const;

export type DocumentKind = keyof typeof KIND_CODES;

// No I, O, 0 or 1: these are read aloud and typed in by hand.
const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newDocumentId(kind: DocumentKind, year = new Date().getFullYear()): string {
    const suffix = Array.from({ length: 6 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');
    return `${DOCUMENT_PREFIX}-${year}-${KIND_CODES[kind]}-${suffix}`;
}

let cachedPrivate: KeyObject | null = null;
let cachedPublic: KeyObject | null = null;

export const signingConfigured = Boolean(env.DOCUMENT_SIGNING_KEY);

function loadKeys(): { privateKey: KeyObject; publicKey: KeyObject } {
    if (cachedPrivate && cachedPublic) {
        return { privateKey: cachedPrivate, publicKey: cachedPublic };
    }
    if (!env.DOCUMENT_SIGNING_KEY) {
        throw new Error(
            'DOCUMENT_SIGNING_KEY is not set, so documents cannot be signed. '
            + 'Generate one with: npm run documents:keygen',
        );
    }
    // Held base64 so the PEM fits on one line of an environment file.
    const pem = Buffer.from(env.DOCUMENT_SIGNING_KEY, 'base64').toString('utf8');
    cachedPrivate = createPrivateKey(pem);
    cachedPublic = createPublicKey(cachedPrivate);
    return { privateKey: cachedPrivate, publicKey: cachedPublic };
}

export function sha256(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Signs the hash, not the file, so a verifier needs only the digest. */
export function signDigest(hex: string): string {
    const { privateKey } = loadKeys();
    return sign(null, Buffer.from(hex, 'hex'), privateKey).toString('base64');
}

export function verifyDigest(hex: string, signature: string): boolean {
    try {
        const { publicKey } = loadKeys();
        return verify(null, Buffer.from(hex, 'hex'), publicKey, Buffer.from(signature, 'base64'));
    }
    catch {
        return false;
    }
}

export function publicKeyPem(): string {
    return loadKeys().publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

/** Short fingerprint, so a document records which key signed it. */
export function keyId(): string {
    const der = loadKeys().publicKey.export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

/** The address printed on the document and encoded in its QR code. */
export function verificationUrl(documentId: string): string {
    return `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/verify/${documentId}`;
}
