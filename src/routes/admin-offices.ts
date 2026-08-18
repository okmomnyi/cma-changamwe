import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { principalOf } from '../middleware/auth.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { todayNairobi } from '../util/time.js';
import type { Request } from 'express';
export const adminOfficesRouter = Router();
const OFFICE_KEY = z.string().trim().regex(/^[a-z][a-z0-9_]{1,48}$/, 'Use a lower-case office key');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const openSchema = z.object({
    member_id: z.string().uuid(),
    office_key: OFFICE_KEY,
    scope: z.enum(['parish', 'prayer_house']).default('parish'),
    prayer_house_id: z.string().uuid().nullish(),
    term_start: isoDate.optional(),
});
function actorFor(req: Request, label: string): AuditActor {
    const principal = principalOf(req);
    return { userId: principal.userId, requestId: label, ip: req.ip ?? null };
}
adminOfficesRouter.post('/offices', async (req, res, next) => {
    try {
        const body = openSchema.parse(req.body);
        if (body.scope === 'prayer_house' && !body.prayer_house_id) {
            throw badRequest('A prayer-house office must name its prayer house.');
        }
        const actor = actorFor(req, 'office-open');
        const termStart = body.term_start ?? todayNairobi();
        const created = await withTransaction(async (client) => {
            const office = await queryOne<{
                id: string;
            }>(`INSERT INTO office_holders (member_id, office_key, scope, prayer_house_id, term_start)
         VALUES ($1, $2, $3::office_scope, $4, $5::date) RETURNING id`, [body.member_id, body.office_key, body.scope,
                body.scope === 'prayer_house' ? body.prayer_house_id : null, termStart], client);
            await writeAudit(client, {
                entityType: 'office', entityId: office!.id, action: 'create',
                newValue: { office_key: body.office_key, member_id: body.member_id, term_start: termStart },
            }, actor);
            return office!.id;
        });
        res.status(201).json({ status: 'opened', office_id: created });
    }
    catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
            next(conflict('Someone already holds that office. Close their term before opening a new one.'));
            return;
        }
        next(err);
    }
});
const closeSchema = z.object({ term_end: isoDate.optional() });
adminOfficesRouter.post('/offices/:id/close', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const { term_end } = closeSchema.parse(req.body ?? {});
        const actor = actorFor(req, 'office-close');
        const termEnd = term_end ?? todayNairobi();
        await withTransaction(async (client) => {
            const before = await queryOne<{
                id: string;
                term_end: string | null;
            }>(`SELECT id, term_end::text FROM office_holders WHERE id = $1 FOR UPDATE`, [id], client);
            if (!before)
                throw notFound('That office term could not be found.');
            if (before.term_end)
                throw conflict('That term is already closed.');
            await query(`UPDATE office_holders SET term_end = $2::date WHERE id = $1`, [id, termEnd], client);
            await writeAudit(client, {
                entityType: 'office', entityId: id, action: 'update',
                fieldChanged: 'term_end', oldValue: null, newValue: termEnd,
            }, actor);
        });
        res.json({ status: 'closed', term_end: termEnd });
    }
    catch (err) {
        next(err);
    }
});
const handoffSchema = z.object({
    office_key: OFFICE_KEY,
    scope: z.enum(['parish', 'prayer_house']).default('parish'),
    prayer_house_id: z.string().uuid().nullish(),
    incoming_member_id: z.string().uuid(),
    effective_date: isoDate.optional(),
});
adminOfficesRouter.post('/offices/handoff', async (req, res, next) => {
    try {
        const body = handoffSchema.parse(req.body);
        if (body.scope === 'prayer_house' && !body.prayer_house_id) {
            throw badRequest('A prayer-house office must name its prayer house.');
        }
        const actor = actorFor(req, 'office-handoff');
        const effective = body.effective_date ?? todayNairobi();
        const houseId = body.scope === 'prayer_house' ? body.prayer_house_id : null;
        const result = await withTransaction(async (client) => {
            const outgoing = await query<{
                id: string;
                member_id: string;
            }>(`UPDATE office_holders SET term_end = $3::date
         WHERE office_key = $1 AND scope = $2::office_scope
           AND prayer_house_id IS NOT DISTINCT FROM $4
           AND term_end IS NULL
         RETURNING id, member_id`, [body.office_key, body.scope, effective, houseId], client);
            for (const row of outgoing.rows) {
                await writeAudit(client, {
                    entityType: 'office', entityId: row.id, action: 'update',
                    fieldChanged: 'term_end', oldValue: null, newValue: effective,
                }, actor);
            }
            const incoming = await queryOne<{
                id: string;
            }>(`INSERT INTO office_holders (member_id, office_key, scope, prayer_house_id, term_start)
         VALUES ($1, $2, $3::office_scope, $4, $5::date) RETURNING id`, [body.incoming_member_id, body.office_key, body.scope, houseId, effective], client);
            await writeAudit(client, {
                entityType: 'office', entityId: incoming!.id, action: 'create',
                newValue: {
                    office_key: body.office_key, member_id: body.incoming_member_id,
                    term_start: effective, replaced: outgoing.rows.map((r) => r.member_id),
                },
            }, actor);
            return { closed: outgoing.rows.length, incoming_office_id: incoming!.id };
        });
        res.status(201).json({ status: 'handed_over', ...result, effective_date: effective });
    }
    catch (err) {
        next(err);
    }
});
const houseSchema = z.object({ name: z.string().trim().min(2).max(120) });
adminOfficesRouter.post('/prayer-houses', async (req, res, next) => {
    try {
        const { name } = houseSchema.parse(req.body);
        const row = await queryOne<{
            id: string;
            name: string;
        }>(`INSERT INTO prayer_houses (name) VALUES ($1) RETURNING id, name`, [name]);
        res.status(201).json({ status: 'created', prayer_house: row });
    }
    catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
            next(conflict('A prayer house with that name already exists.'));
            return;
        }
        next(err);
    }
});
adminOfficesRouter.patch('/prayer-houses/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const { name } = houseSchema.parse(req.body);
        const row = await queryOne<{
            id: string;
            name: string;
        }>(`UPDATE prayer_houses SET name = $2 WHERE id = $1 RETURNING id, name`, [id, name]);
        if (!row)
            throw notFound('That prayer house could not be found.');
        res.json({ status: 'updated', prayer_house: row });
    }
    catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
            next(conflict('A prayer house with that name already exists.'));
            return;
        }
        next(err);
    }
});
adminOfficesRouter.delete('/prayer-houses/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const inUse = await queryOne<{
            n: string;
        }>(`SELECT count(*)::text AS n FROM members WHERE prayer_house_id = $1`, [id]);
        if (Number(inUse?.n ?? 0) > 0) {
            throw conflict(`That prayer house still has ${inUse!.n} members. Reassign them first.`);
        }
        const deleted = await queryOne<{
            id: string;
        }>(`DELETE FROM prayer_houses WHERE id = $1 RETURNING id`, [id]);
        if (!deleted)
            throw notFound('That prayer house could not be found.');
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
