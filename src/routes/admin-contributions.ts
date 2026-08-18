import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { principalOf } from '../middleware/auth.js';
import { auditFieldChanges, writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, notFound } from '../util/errors.js';
import { monthStart, todayNairobi } from '../util/time.js';
import type { Request } from 'express';
export const adminContributionsRouter = Router();
const CATEGORIES = [
    'diocese_affiliation', 'deanery_affiliation', 'monthly_subscription', 'seminar_fee',
    'wedding', 'benevolent_member_spouse', 'benevolent_child', 'benevolent_parent',
    'sick_admission', 'sick_visitation', 'archbishop_support', 'other',
] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const contributionSchema = z.object({
    member_id: z.string().uuid(),
    category: z.enum(CATEGORIES),
    amount: z.coerce.number().min(0).max(10000000),
    date: isoDate.optional(),
    event_id: z.string().uuid().nullish(),
    contribution_month: isoDate.nullish(),
    affiliation_year: z.coerce.number().int().min(1900).max(2100).nullish(),
    note: z.string().trim().max(300).nullish(),
});
function actorFor(req: Request, label: string): AuditActor {
    const principal = principalOf(req);
    return { userId: principal.userId, requestId: label, ip: req.ip ?? null };
}
function normalise(body: z.infer<typeof contributionSchema>) {
    const date = body.date ?? todayNairobi();
    let month = body.contribution_month ? monthStart(body.contribution_month) : null;
    let year = body.affiliation_year ?? null;
    if (body.category === 'monthly_subscription' && !month)
        month = monthStart(date);
    if (body.category === 'diocese_affiliation' && !year)
        year = Number(date.slice(0, 4));
    if (body.category === 'deanery_affiliation' && !year)
        year = Number(date.slice(0, 4));
    return { date, month, year };
}
adminContributionsRouter.post('/contributions', async (req, res, next) => {
    try {
        const body = contributionSchema.parse(req.body);
        const actor = actorFor(req, 'contribution-create');
        const principal = principalOf(req);
        const { date, month, year } = normalise(body);
        const created = await withTransaction(async (client) => {
            const member = await queryOne<{
                id: string;
            }>(`SELECT id FROM members WHERE id = $1`, [body.member_id], client);
            if (!member)
                throw notFound('That member could not be found.');
            const row = await queryOne<{
                id: string;
            }>(`INSERT INTO contributions
           (member_id, event_id, category, amount, contribution_month, affiliation_year,
            date, note, recorded_by)
         VALUES ($1, $2, $3::contribution_category, $4, $5::date, $6, $7::date, $8, $9)
         RETURNING id`, [body.member_id, body.event_id ?? null, body.category, body.amount,
                month, year, date, body.note ?? null, principal.userId], client);
            await writeAudit(client, {
                entityType: 'contribution', entityId: row!.id, action: 'create',
                newValue: {
                    member_id: body.member_id, category: body.category, amount: body.amount,
                    date, contribution_month: month, affiliation_year: year,
                },
            }, actor);
            return row!.id;
        });
        const { recalculateForMember } = await import('../matrix/recalc.js');
        const score = await recalculateForMember(body.member_id);
        res.status(201).json({ status: 'created', contribution_id: created, live_score: score });
    }
    catch (err) {
        next(err);
    }
});
const bulkSchema = z.object({
    event_id: z.string().uuid().nullish(),
    category: z.enum(CATEGORIES),
    date: isoDate.optional(),
    contribution_month: isoDate.nullish(),
    affiliation_year: z.coerce.number().int().min(1900).max(2100).nullish(),
    entries: z.array(z.object({
        member_id: z.string().uuid(),
        amount: z.coerce.number().min(0).max(10000000),
        note: z.string().trim().max(300).nullish(),
    })).min(1).max(1000),
});
adminContributionsRouter.post('/contributions/bulk', async (req, res, next) => {
    try {
        const body = bulkSchema.parse(req.body);
        const actor = actorFor(req, 'contribution-bulk');
        const principal = principalOf(req);
        const { date, month, year } = normalise({ ...body, member_id: body.entries[0]!.member_id, amount: 0 });
        const memberIds = body.entries.map((e) => e.member_id);
        await withTransaction(async (client) => {
            const inserted = await query<{
                id: string;
                member_id: string;
                amount: string;
            }>(`INSERT INTO contributions
           (member_id, event_id, category, amount, contribution_month, affiliation_year,
            date, note, recorded_by)
         SELECT e.member_id, $2, $3::contribution_category, e.amount, $4::date, $5, $6::date,
                e.note, $7
         FROM unnest($1::uuid[], $8::numeric[], $9::text[]) AS e(member_id, amount, note)
         RETURNING id, member_id, amount::text`, [memberIds, body.event_id ?? null, body.category, month, year, date, principal.userId,
                body.entries.map((e) => e.amount), body.entries.map((e) => e.note ?? null)], client);
            for (const row of inserted.rows) {
                await writeAudit(client, {
                    entityType: 'contribution', entityId: row.id, action: 'create',
                    newValue: { member_id: row.member_id, category: body.category, amount: row.amount, date },
                }, actor);
            }
        });
        const { recalculateForMembers } = await import('../matrix/recalc.js');
        const rescored = await recalculateForMembers(memberIds);
        res.status(201).json({ status: 'created', count: body.entries.length, members_rescored: rescored });
    }
    catch (err) {
        next(err);
    }
});
const patchSchema = z.object({
    category: z.enum(CATEGORIES).optional(),
    amount: z.coerce.number().min(0).max(10000000).optional(),
    date: isoDate.optional(),
    event_id: z.string().uuid().nullish(),
    contribution_month: isoDate.nullish(),
    affiliation_year: z.coerce.number().int().min(1900).max(2100).nullish(),
    note: z.string().trim().max(300).nullish(),
});
adminContributionsRouter.patch('/contributions/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const body = patchSchema.parse(req.body);
        if (Object.keys(body).length === 0)
            throw badRequest('No changes were supplied.');
        const actor = actorFor(req, 'contribution-update');
        const COLUMNS = ['category', 'amount', 'date', 'event_id', 'contribution_month',
            'affiliation_year', 'note'] as const;
        const casts: Record<string, string> = {
            category: '::contribution_category', date: '::date',
            contribution_month: '::date', event_id: '::uuid',
        };
        const result = await withTransaction(async (client) => {
            const before = await queryOne<Record<string, unknown> & {
                member_id: string;
            }>(`SELECT member_id, ${COLUMNS.join(', ')} FROM contributions WHERE id = $1 FOR UPDATE`, [id], client);
            if (!before)
                throw notFound('That contribution could not be found.');
            const columns = Object.keys(body).filter((k): k is (typeof COLUMNS)[number] => (COLUMNS as readonly string[]).includes(k));
            const assignments = columns.map((c, i) => `${c} = $${i + 2}${casts[c] ?? ''}`);
            const values = columns.map((c) => {
                const value = (body as Record<string, unknown>)[c];
                if (c === 'contribution_month' && typeof value === 'string')
                    return monthStart(value);
                return value ?? null;
            });
            const after = await queryOne<Record<string, unknown>>(`UPDATE contributions SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $1 RETURNING ${COLUMNS.join(', ')}`, [id, ...values], client);
            const changed = await auditFieldChanges(client, {
                entityType: 'contribution', entityId: id, before, after: after!, fields: columns,
            }, actor);
            return { changed, memberId: before.member_id };
        });
        const { recalculateForMember } = await import('../matrix/recalc.js');
        const score = await recalculateForMember(result.memberId);
        res.json({ status: 'updated', fields_changed: result.changed, live_score: score });
    }
    catch (err) {
        next(err);
    }
});
adminContributionsRouter.delete('/contributions/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const actor = actorFor(req, 'contribution-delete');
        const memberId = await withTransaction(async (client) => {
            const row = await queryOne<Record<string, unknown> & {
                member_id: string;
            }>(`SELECT id, member_id, category, amount::text, date::text, contribution_month::text,
                affiliation_year, note
         FROM contributions WHERE id = $1 FOR UPDATE`, [id], client);
            if (!row)
                throw notFound('That contribution could not be found.');
            await query(`DELETE FROM contributions WHERE id = $1`, [id], client);
            await writeAudit(client, {
                entityType: 'contribution', entityId: id, action: 'delete', oldValue: row,
            }, actor);
            return row.member_id;
        });
        const { recalculateForMember } = await import('../matrix/recalc.js');
        await recalculateForMember(memberId);
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
adminContributionsRouter.get('/contributions', async (req, res, next) => {
    try {
        const filters = z.object({
            member_id: z.string().uuid().optional(),
            category: z.enum(CATEGORIES).optional(),
            from: isoDate.optional(),
            to: isoDate.optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
        }).parse(req.query);
        const params = [
            filters.member_id ?? null, filters.category ?? null,
            filters.from ?? null, filters.to ?? null, filters.limit, filters.offset,
        ];
        const rows = await query(`SELECT c.id, c.category, c.amount, c.date, c.contribution_month, c.affiliation_year,
              c.note, c.recorded_at, m.id AS member_id, m.full_name,
              e.title AS event_title
       FROM contributions c
       JOIN members m ON m.id = c.member_id
       LEFT JOIN events e ON e.id = c.event_id
       WHERE ($1::uuid IS NULL OR c.member_id = $1)
         AND ($2::contribution_category IS NULL OR c.category = $2)
         AND ($3::date IS NULL OR c.date >= $3)
         AND ($4::date IS NULL OR c.date <= $4)
       ORDER BY c.date DESC, c.recorded_at DESC
       LIMIT $5 OFFSET $6`, params);
        const total = await queryOne<{
            n: string;
            sum: string;
        }>(`SELECT count(*)::text AS n, COALESCE(sum(amount), 0)::text AS sum
       FROM contributions c
       WHERE ($1::uuid IS NULL OR c.member_id = $1)
         AND ($2::contribution_category IS NULL OR c.category = $2)
         AND ($3::date IS NULL OR c.date >= $3)
         AND ($4::date IS NULL OR c.date <= $4)`, params.slice(0, 4));
        res.json({
            contributions: rows.rows,
            total: Number(total?.n ?? 0),
            total_amount: total?.sum ?? '0',
            limit: filters.limit,
            offset: filters.offset,
        });
    }
    catch (err) {
        next(err);
    }
});
