import { Router } from 'express';
import { z } from 'zod';
import { findDocument } from '../documents/issue.js';
import { publicKeyPem, keyId, signingConfigured, verifyDigest } from '../documents/signing.js';
import { reportDownloadLimiter } from '../middleware/rateLimit.js';
import { badRequest, notFound } from '../util/errors.js';

/**
 * Public. No account, no session.
 *
 * A university, employer or government office holds a PDF and needs to know
 * whether the association issued it and whether it has been altered. Nothing
 * here reveals anything the document does not already show on its face.
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
            signature: record.signature,
            sha256: record.sha256,
        });
    }
    catch (err) {
        next(err);
    }
});

const checkSchema = z.object({
    sha256: z.string().trim().toLowerCase()
        .regex(/^[0-9a-f]{64}$/, 'That is not a SHA-256 digest.'),
});

/**
 * The file itself is never uploaded. The browser hashes it locally and sends
 * only the digest, so a member's bio-data does not travel across the network
 * to be checked, and no upload limit applies.
 */
verifyRouter.post('/:documentId/check', reportDownloadLimiter, async (req, res, next) => {
    try {
        const documentId = DOCUMENT_ID.parse(req.params.documentId);
        const { sha256 } = checkSchema.parse(req.body);

        const record = await findDocument(documentId);
        if (!record)
            throw notFound('No document with that number has been issued.');

        const matches = record.sha256 === sha256;
        res.json({
            document_id: record.document_id,
            matches,
            revoked: record.revoked_at !== null,
            seal_intact: verifyDigest(record.sha256, record.signature),
            verdict: record.revoked_at !== null
                ? 'This document was issued by the association, but has since been withdrawn.'
                : matches
                    ? 'This is the file the association issued. Not one byte has changed.'
                    : 'This file does not match the document that was issued under that number. It has been altered, or it is a different file.',
        });
    }
    catch (err) {
        if (err && typeof err === 'object' && 'issues' in err) {
            next(badRequest('Send the SHA-256 digest of the file as a 64-character hex string.'));
            return;
        }
        next(err);
    }
});
