import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { principalOf } from '../middleware/auth.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { todayNairobi } from '../util/time.js';
import { loadMatrixConfig, configList, configNumber } from '../matrix/config.js';
import type { Queryable } from '../db/pool.js';
import type { Request } from 'express';
export const adminOfficesRouter = Router();

/**
 * By-laws section 3.2: a member may serve two terms in an office, and no more.
 * A completed term is one that has been closed; the term being opened is the
 * next one. An officer may record an exception, which the audit log keeps.
 */
async function assertTermLimit(client: Queryable, params: {
    memberId: string;
    officeKey: string;
    scope: 'parish' | 'prayer_house';
    prayerHouseId: string | null;
    override?: string | null;
}): Promise<void> {
    if (params.override)
        return;
    const config = await loadMatrixConfig(client);
    const maxTerms = configNumber(config, 'office_max_terms', 2);
    const served = await queryOne<{
        n: string;
    }>(`SELECT count(*)::text AS n FROM office_holders
     WHERE member_id = $1 AND office_key = $2 AND scope = $3::office_scope
       AND prayer_house_id IS NOT DISTINCT FROM $4
       AND term_end IS NOT NULL`, [params.memberId, params.officeKey, params.scope, params.prayerHouseId], client);
    const completed = Number(served?.n ?? 0);
    if (completed >= maxTerms) {
        throw conflict(`That member has already served ${completed} terms in this office, and the by-laws allow ${maxTerms}. `
            + 'If the committee has agreed an exception, send it again with a reason in override_reason.');
    }
}

/**
 * Refuses to close the last sitting parish office that carries administrative
 * access, because doing so locks every officer out of the system.
 */
async function assertNotLastAdmin(client: Queryable, officeHolderId: string): Promise<void> {
    const config = await loadMatrixConfig(client);
    const adminOffices = configList(config, 'admin_offices', ['coordinator', 'treasurer']);
    const row = await queryOne<{
        office_key: string;
        scope: string;
    }>(`SELECT office_key, scope FROM office_holders WHERE id = $1`, [officeHolderId], client);
    if (!row || row.scope !== 'parish' || !adminOffices.includes(row.office_key))
        return;
    const remaining = await queryOne<{
        n: string;
    }>(`SELECT count(*)::text AS n FROM office_holders
     WHERE term_end IS NULL AND scope = 'parish'
       AND office_key = ANY($1::text[]) AND id <> $2`, [adminOffices, officeHolderId], client);
    if (Number(remaining?.n ?? 0) === 0) {
        throw conflict('That is the last sitting office carrying administrative access, and closing it would lock '
            + 'everyone out. Use the handover, which closes and opens in one step.');
    }
}
const OFFICE_KEY = z.string().trim().regex(/^[a-z][a-z0-9_]{1,48}$/, 'Use a lower-case office key');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const openSchema = z.object({
    member_id: z.string().uuid(),
    office_key: OFFICE_KEY,
    scope: z.enum(['parish', 'prayer_house']).default('parish'),
    prayer_house_id: z.string().uuid().nullish(),
    term_start: isoDate.optional(),
    override_reason: z.string().trim().min(4).max(300).nullish(),
});
function actorFor(req: Request, label: string): AuditActor {
    const principal = principalOf(req);
    return { userId: principal.userId, requestId: label, ip: req.ip ?? null };
}
/**
 * The offices themselves. One list, read from the database, so the form, the
 * labels and the recorded terms cannot drift apart.
 */
adminOfficesRouter.get('/office-types', async (_req, res, next) => {
    try {
        const rows = await query(`SELECT office_key, label, parish_scope, house_scope, active,
              (SELECT count(*) FROM office_holders oh
                WHERE oh.office_key = t.office_key AND oh.term_end IS NULL)::int AS sitting
       FROM office_types t
       ORDER BY active DESC, sort_order, office_key`);
        res.json({ office_types: rows.rows });
    }
    catch (err) {
        next(err);
    }
});

/** Refuses an office at a level the by-laws do not place it at. */
async function assertOfficeAllowed(client: Queryable, officeKey: string, scope: 'parish' | 'prayer_house'): Promise<void> {
    const type = await queryOne<{
        label: string;
        parish_scope: boolean;
        house_scope: boolean;
        active: boolean;
    }>(`SELECT label, parish_scope, house_scope, active FROM office_types WHERE office_key = $1`, [officeKey], client);
    if (!type) {
        throw badRequest(`"${officeKey}" is not one of the association offices. Check the list.`);
    }
    if (!type.active) {
        throw badRequest(`${type.label} is no longer an office of the association, so no new term can be opened in it.`);
    }
    const allowed = scope === 'parish' ? type.parish_scope : type.house_scope;
    if (!allowed) {
        throw badRequest(scope === 'parish'
            ? `${type.label} is a prayer-house office, not a parish one.`
            : `${type.label} sits at parish level only, so a prayer house cannot hold one.`);
    }
}

adminOfficesRouter.post('/offices', async (req, res, next) => {
    try {
        const body = openSchema.parse(req.body);
        if (body.scope === 'prayer_house' && !body.prayer_house_id) {
            throw badRequest('A prayer-house office must name its prayer house.');
        }
        const actor = actorFor(req, 'office-open');
        const termStart = body.term_start ?? todayNairobi();
        const openHouseId = body.scope === 'prayer_house' ? (body.prayer_house_id ?? null) : null;
        const created = await withTransaction(async (client) => {
            await assertOfficeAllowed(client, body.office_key, body.scope);
            await assertTermLimit(client, {
                memberId: body.member_id, officeKey: body.office_key,
                scope: body.scope, prayerHouseId: openHouseId,
                override: body.override_reason ?? null,
            });
            const office = await queryOne<{
                id: string;
            }>(`INSERT INTO office_holders (member_id, office_key, scope, prayer_house_id, term_start)
         VALUES ($1, $2, $3::office_scope, $4, $5::date) RETURNING id`,
                [body.member_id, body.office_key, body.scope, openHouseId, termStart], client);
            await writeAudit(client, {
                entityType: 'office', entityId: office!.id, action: 'create',
                newValue: {
                    office_key: body.office_key, member_id: body.member_id,
                    scope: body.scope, prayer_house_id: openHouseId, term_start: termStart,
                    ...(body.override_reason ? { term_limit_override: body.override_reason } : {}),
                },
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
            await assertNotLastAdmin(client, id);
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
    override_reason: z.string().trim().min(4).max(300).nullish(),
});
adminOfficesRouter.post('/offices/handoff', async (req, res, next) => {
    try {
        const body = handoffSchema.parse(req.body);
        if (body.scope === 'prayer_house' && !body.prayer_house_id) {
            throw badRequest('A prayer-house office must name its prayer house.');
        }
        const actor = actorFor(req, 'office-handoff');
        const effective = body.effective_date ?? todayNairobi();
        const houseId = body.scope === 'prayer_house' ? (body.prayer_house_id ?? null) : null;
        const result = await withTransaction(async (client) => {
            await assertOfficeAllowed(client, body.office_key, body.scope);
            await assertTermLimit(client, {
                memberId: body.incoming_member_id, officeKey: body.office_key,
                scope: body.scope, prayerHouseId: houseId,
                override: body.override_reason ?? null,
            });
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
                    scope: body.scope, prayer_house_id: houseId,
                    term_start: effective, replaced: outgoing.rows.map((r) => r.member_id),
                    ...(body.override_reason ? { term_limit_override: body.override_reason } : {}),
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
