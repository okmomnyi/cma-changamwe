import { query, queryOne } from '../db/pool.js';
import { logger } from '../util/logger.js';
import { AppError } from '../util/errors.js';
import {
    keyId, newDocumentId, sha256, signDigest, signingConfigured, verificationUrl,
    type DocumentKind,
} from './signing.js';
import { drawFooters, finish, type Doc } from '../pdf/letterhead.js';

export interface IssueRequest {
    kind: DocumentKind;
    title: string;
    orgName: string;
    subjectMemberId?: string | null;
    subjectLabel?: string | null;
    period?: string | null;
    metadata?: Record<string, unknown>;
    issuedBy?: string | null;
}

export interface IssuedDocument {
    documentId: string;
    pdf: Buffer;
    sha256: string;
    pages: number;
}

/**
 * Renders, seals and records a document in one step.
 *
 * The order matters. The id is minted first so it can be printed on the page
 * and encoded in the QR code; only then is the finished PDF hashed and signed.
 * The hash therefore covers the verification block that refers to it, and any
 * later edit to the file breaks the check while leaving the id readable.
 *
 * `body` draws the content and returns the y it finished at.
 */
export async function issueDocument(
    request: IssueRequest,
    body: (doc: Doc, documentId: string) => Promise<number> | number,
): Promise<IssuedDocument> {
    if (!signingConfigured) {
        // A missing key is a deployment fault, not the officer's. Say so
        // plainly rather than answering with a generic server error.
        throw new AppError(503, 'signing_unavailable',
            'Documents cannot be issued because this installation has no signing key. '
            + 'Whoever looks after the system needs to set DOCUMENT_SIGNING_KEY.');
    }

    const documentId = newDocumentId(request.kind);
    const { createDocument } = await import('../pdf/letterhead.js');
    const doc = createDocument();

    await body(doc, documentId);

    // One code for the whole document, drawn into every footer.
    const QRCode = (await import('qrcode')).default;
    const qr = await QRCode.toBuffer(verificationUrl(documentId), {
        type: 'png', margin: 0, width: 240,
        color: { dark: '#12293F', light: '#FFFFFF' },
    });
    const pages = drawFooters(doc, documentId, request.orgName, qr);

    const pdf = await finish(doc);
    const digest = sha256(pdf);
    const signature = signDigest(digest);

    await query(
        `INSERT INTO documents
           (document_id, kind, title, subject_member_id, subject_label, period,
            sha256, signature, key_id, byte_size, page_count, metadata, issued_by)
         VALUES ($1, $2::document_kind, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
        [
            documentId, request.kind, request.title,
            request.subjectMemberId ?? null, request.subjectLabel ?? null, request.period ?? null,
            digest, signature, keyId(), pdf.length, pages,
            JSON.stringify(request.metadata ?? {}), request.issuedBy ?? null,
        ],
    );

    logger.info({ documentId, kind: request.kind, bytes: pdf.length, pages }, 'document issued');
    return { documentId, pdf, sha256: digest, pages };
}

export interface DocumentRecord {
    document_id: string;
    kind: string;
    title: string;
    subject_label: string | null;
    period: string | null;
    sha256: string;
    signature: string;
    key_id: string;
    byte_size: number | null;
    page_count: number | null;
    issued_at: string;
    revoked_at: string | null;
    revoked_reason: string | null;
    issued_by_name: string | null;
    metadata: Record<string, unknown> | null;
}

export async function findDocument(documentId: string): Promise<DocumentRecord | null> {
    return queryOne<DocumentRecord>(
        `SELECT d.document_id, d.kind, d.title, d.subject_label, d.period,
                d.sha256, d.signature, d.key_id, d.byte_size, d.page_count,
                d.metadata, d.issued_at::text, d.revoked_at::text, d.revoked_reason,
                m.full_name AS issued_by_name
           FROM documents d
           LEFT JOIN users u ON u.id = d.issued_by
           LEFT JOIN members m ON m.id = u.member_id
          WHERE d.document_id = $1`,
        [documentId],
    );
}
