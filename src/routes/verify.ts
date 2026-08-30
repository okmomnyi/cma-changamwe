import { Router } from 'express';
import { z } from 'zod';
import { findDocument } from '../documents/issue.js';
import { publicKeyPem, keyId, signingConfigured, verifyDigest } from '../documents/signing.js';
import { reportDownloadLimiter } from '../middleware/rateLimit.js';
import { notFound } from '../util/errors.js';

/**
 * Public. No account, no session.
 *
 * Someone holding a document scans its code and lands here. What is returned is
 * what the association issued under that number, so the details on screen can
 * be read against the paper in hand.
 *
 * Deliberately narrow: counts, dates and the subject, never the identity
 * numbers or next-of-kin the document itself carries. Anyone can reach this.
 */
export const verifyRouter = Router();

const DOCUMENT_ID = z.string().trim().toUpperCase()
    .regex(/^CMA-\d{4}-[A-Z]{3}-[0-9A-Z]{6}$/, 'That is not a CMA document number.');

verifyRouter.get('/public-key', (_req, res, next) => {
    try {
        if (!signingConfigured)
            throw notFound('No signing key is configured on this installation.');
        res.setHeader('content-type', 'application/x-pem-file');
        res.setHeader('content-disposition', 'attachment; filename="cma-changamwe-public-key.pem"');
        res.setHeader('cache-control', 'public, max-age=3600');
        res.send(
            `# CMA Changamwe document signing key\n`
            + `# Ed25519 public key, id ${keyId()}\n`
            + `# Signatures cover the SHA-256 digest of the PDF, as raw 32 bytes.\n`
            + publicKeyPem(),
        );
    }
    catch (err) {
        next(err);
    }
});

verifyRouter.get('/:documentId', reportDownloadLimiter, async (req, res, next) => {
    try {
        const documentId = DOCUMENT_ID.parse(req.params.documentId);
        const record = await findDocument(documentId);
        if (!record)
            throw notFound('No document with that number has been issued.');

        // Confirms the record itself has not been tampered with in the database.
        const sealIntact = verifyDigest(record.sha256, record.signature);

        res.json({
            document_id: record.document_id,
            title: record.title,
            kind: record.kind,
            concerning: record.subject_label,
            period: record.period,
            issued_at: record.issued_at,
            issued_by: record.issued_by_name,
            pages: record.page_count,
            size_bytes: record.byte_size,
            revoked: record.revoked_at !== null,
            revoked_at: record.revoked_at,
            revoked_reason: record.revoked_reason,
            seal_intact: sealIntact,
            key_id: record.key_id,
            details: record.metadata ?? {},
        });
    }
    catch (err) {
        next(err);
    }
});
