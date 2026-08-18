import { Router, type Request } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { hashToken } from '../auth/tokens.js';
import { requireAuth, requireAdmin, principalOf } from '../middleware/auth.js';
import { writeAudit } from '../audit/audit.js';
import { badRequest, notFound, unauthorized } from '../util/errors.js';
import { deleteObject, isValidPhotoKey, newPhotoKey, photosConfigured, photosUnconfiguredReason, presignUpload, presignView, verifyUploaded, MAX_PHOTO_BYTES, } from '../media/r2.js';
export const photosRouter = Router();
const keySchema = z.object({
    object_key: z.string().min(8).max(200).refine(isValidPhotoKey, 'That is not an upload key issued by this server.'),
});
function assertConfigured(): void {
    if (!photosConfigured)
        throw badRequest(photosUnconfiguredReason());
}
async function draftIdFrom(req: Request): Promise<string> {
    const token = req.get('x-draft-token');
    if (!token?.trim())
        throw unauthorized('No registration in progress.');
    const draft = await queryOne<{
        id: string;
    }>(`SELECT id FROM signup_drafts
     WHERE draft_token_hash = $1 AND promoted_at IS NULL AND expires_at > now()`, [hashToken(token.trim())]);
    if (!draft)
        throw notFound('That registration has expired. Start again.');
    return draft.id;
}
photosRouter.post('/signup/photo/upload-url', async (req, res, next) => {
    try {
        assertConfigured();
        const draftId = await draftIdFrom(req);
        const key = newPhotoKey('drafts', draftId);
        const signed = await presignUpload(key);
        res.json({ ...signed, object_key: key, content_type: 'image/jpeg', max_bytes: MAX_PHOTO_BYTES });
    }
    catch (err) {
        next(err);
    }
});
photosRouter.post('/signup/photo/confirm', async (req, res, next) => {
    try {
        assertConfigured();
        const draftId = await draftIdFrom(req);
        const { object_key } = keySchema.parse(req.body);
        const uploaded = await verifyUploaded(object_key);
        const previous = await queryOne<{
            object_key: string;
        }>(`SELECT object_key FROM signup_draft_photos WHERE draft_id = $1`, [draftId]);
        await query(`INSERT INTO signup_draft_photos (draft_id, object_key, content_type, byte_size, width, height)
       VALUES ($1, $2, $3, $4, 600, 600)
       ON CONFLICT (draft_id) DO UPDATE
         SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type,
             byte_size = EXCLUDED.byte_size, uploaded_at = now()`, [draftId, object_key, uploaded.contentType, uploaded.byteSize]);
        if (previous && previous.object_key !== object_key)
            await deleteObject(previous.object_key);
        res.status(201).json({ status: 'saved', byte_size: uploaded.byteSize });
    }
    catch (err) {
        next(err);
    }
});
photosRouter.get('/signup/photo/url', async (req, res, next) => {
    try {
        const draftId = await draftIdFrom(req);
        const row = await queryOne<{
            object_key: string;
        }>(`SELECT object_key FROM signup_draft_photos WHERE draft_id = $1`, [draftId]);
        if (!row)
            throw notFound('No photo has been uploaded yet.');
        assertConfigured();
        res.json(await presignView(row.object_key));
    }
    catch (err) {
        next(err);
    }
});
photosRouter.delete('/signup/photo', async (req, res, next) => {
    try {
        const draftId = await draftIdFrom(req);
        const row = await queryOne<{
            object_key: string;
        }>(`DELETE FROM signup_draft_photos WHERE draft_id = $1 RETURNING object_key`, [draftId]);
        if (row)
            await deleteObject(row.object_key);
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
photosRouter.get('/me/photo/url', requireAuth, async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const row = await queryOne<{
            object_key: string;
        }>(`SELECT object_key FROM member_photos WHERE member_id = $1`, [memberId]);
        if (!row)
            throw notFound('No photo on file.');
        assertConfigured();
        res.json(await presignView(row.object_key));
    }
    catch (err) {
        next(err);
    }
});
photosRouter.get('/admin/members/:id/photo/url', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const row = await queryOne<{
            object_key: string;
        }>(`SELECT object_key FROM member_photos WHERE member_id = $1`, [id]);
        if (!row)
            throw notFound('No photo on file.');
        assertConfigured();
        res.json(await presignView(row.object_key));
    }
    catch (err) {
        next(err);
    }
});
photosRouter.post('/admin/members/:id/photo/upload-url', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        assertConfigured();
        const id = z.string().uuid().parse(req.params.id);
        const member = await queryOne<{
            id: string;
        }>(`SELECT id FROM members WHERE id = $1`, [id]);
        if (!member)
            throw notFound('That member could not be found.');
        const key = newPhotoKey('members', id);
        const signed = await presignUpload(key);
        res.json({ ...signed, object_key: key, content_type: 'image/jpeg', max_bytes: MAX_PHOTO_BYTES });
    }
    catch (err) {
        next(err);
    }
});
photosRouter.post('/admin/members/:id/photo/confirm', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        assertConfigured();
        const id = z.string().uuid().parse(req.params.id);
        const { object_key } = keySchema.parse(req.body);
        const principal = principalOf(req);
        const uploaded = await verifyUploaded(object_key);
        const previous = await withTransaction(async (client) => {
            const member = await queryOne<{
                id: string;
            }>(`SELECT id FROM members WHERE id = $1`, [id], client);
            if (!member)
                throw notFound('That member could not be found.');
            const existing = await queryOne<{
                object_key: string;
            }>(`SELECT object_key FROM member_photos WHERE member_id = $1 FOR UPDATE`, [id], client);
            await query(`INSERT INTO member_photos
             (member_id, object_key, content_type, byte_size, width, height, uploaded_by)
           VALUES ($1, $2, $3, $4, 600, 600, $5)
           ON CONFLICT (member_id) DO UPDATE
             SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type,
                 byte_size = EXCLUDED.byte_size, uploaded_at = now(),
                 uploaded_by = EXCLUDED.uploaded_by`, [id, object_key, uploaded.contentType, uploaded.byteSize, principal.userId], client);
            await writeAudit(client, {
                entityType: 'member', entityId: id, action: 'update', fieldChanged: 'photo',
                oldValue: existing?.object_key ?? null, newValue: object_key,
            }, { userId: principal.userId, requestId: 'photo-upload', ip: req.ip ?? null });
            return existing?.object_key ?? null;
        });
        if (previous && previous !== object_key)
            await deleteObject(previous);
        res.status(201).json({ status: 'saved', byte_size: uploaded.byteSize });
    }
    catch (err) {
        next(err);
    }
});
photosRouter.delete('/admin/members/:id/photo', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const principal = principalOf(req);
        const removed = await withTransaction(async (client) => {
            const row = await queryOne<{
                object_key: string;
            }>(`DELETE FROM member_photos WHERE member_id = $1 RETURNING object_key`, [id], client);
            if (!row)
                throw notFound('No photo on file.');
            await writeAudit(client, {
                entityType: 'member', entityId: id, action: 'update', fieldChanged: 'photo',
                oldValue: row.object_key, newValue: null,
            }, { userId: principal.userId, requestId: 'photo-delete', ip: req.ip ?? null });
            return row.object_key;
        });
        await deleteObject(removed);
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
