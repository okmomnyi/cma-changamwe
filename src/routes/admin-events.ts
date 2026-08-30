import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { principalOf } from '../middleware/auth.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { NAIROBI } from '../util/time.js';
import { EVENT_TYPES as EVENT_TYPE_VOCAB, valuesOf } from '../../shared/vocabulary.js';
import type { Request } from 'express';
export const adminEventsRouter = Router();
const EVENT_TYPES = valuesOf(EVENT_TYPE_VOCAB);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const eventSchema = z.object({
    type: z.enum(EVENT_TYPES),
    subtype: z.string().trim().max(40).nullish(),
    matrix_item_key: z.string().trim().max(50).nullish(),
    title: z.string().trim().min(3).max(160),
    date: isoDate,
    description: z.string().trim().max(500).nullish(),
    prayer_house_id: z.string().uuid().nullish(),
});
function actorFor(req: Request, label: string): AuditActor {
    const principal = principalOf(req);
    return { userId: principal.userId, requestId: label, ip: req.ip ?? null };
}
async function assertScorableKey(key: string | null | undefined): Promise<void> {
    if (!key)
        return;
    const rule = await queryOne<{
        source_kind: string;
    }>(`SELECT source_kind FROM matrix_rules WHERE item_key = $1`, [key]);
    if (!rule)
        throw badRequest(`"${key}" is not a Matrix item. Check the rules list.`);
    if (rule.source_kind !== 'attendance') {
        throw badRequest(`"${key}" is scored from contributions, so an event cannot carry it.`);
    }
}
adminEventsRouter.post('/events', async (req, res, next) => {
    try {
        const body = eventSchema.parse(req.body);
        await assertScorableKey(body.matrix_item_key);
        const actor = actorFor(req, 'event-create');
        const principal = principalOf(req);
        const created = await withTransaction(async (client) => {
            const event = await queryOne<{
                id: string;
            }>(`INSERT INTO events (type, subtype, matrix_item_key, title, date, description,
                             prayer_house_id, created_by)
         VALUES ($1::event_type, $2, $3, $4, $5::date, $6, $7, $8) RETURNING id`, [body.type, body.subtype ?? null, body.matrix_item_key ?? null, body.title,
                body.date, body.description ?? null, body.prayer_house_id ?? null, principal.userId], client);
            await writeAudit(client, {
                entityType: 'event', entityId: event!.id, action: 'create',
                newValue: { title: body.title, date: body.date, matrix_item_key: body.matrix_item_key ?? null },
            }, actor);
            return event!.id;
        });
        res.status(201).json({ status: 'created', event_id: created });
    }
    catch (err) {
        next(err);
    }
});
/**
 * The meeting calendar in the orientation document is not all weekly. Prayer
 * house meetings fall on the 2nd and 4th Monday, Dominica on the 1st Sunday,
 * and the AGM on the 3rd Sunday of January. `weekly` covers Friday mass;
 * `monthly` takes the ordinals those other patterns need.
 */
const recurringSchema = eventSchema.omit({ date: true }).extend({
    start_date: isoDate,
    end_date: isoDate,
    weekday: z.coerce.number().int().min(1).max(7),
    pattern: z.enum(['weekly', 'monthly']).default('weekly'),
    // Which occurrences of that weekday within each month, 1 to 5. 5 means the
    // last one, whether the month has four or five.
    ordinals: z.array(z.coerce.number().int().min(1).max(5)).min(1).max(5).optional(),
});

function weeklyDates(start: DateTime, end: DateTime, weekday: number): string[] {
    const dates: string[] = [];
    let cursor = start.plus({ days: (weekday - start.weekday + 7) % 7 });
    while (cursor <= end) {
        dates.push(cursor.toISODate()!);
        cursor = cursor.plus({ weeks: 1 });
    }
    return dates;
}

function monthlyOrdinalDates(start: DateTime, end: DateTime, weekday: number, ordinals: number[]): string[] {
    const dates: string[] = [];
    let month = start.startOf('month');
    while (month <= end) {
        const first = month.plus({ days: (weekday - month.weekday + 7) % 7 });
        const inMonth: DateTime[] = [];
        for (let cursor = first; cursor.month === month.month; cursor = cursor.plus({ weeks: 1 })) {
            inMonth.push(cursor);
        }
        for (const ordinal of ordinals) {
            // 5 means the last occurrence in the month, however many there are.
            const picked = ordinal === 5 ? inMonth[inMonth.length - 1] : inMonth[ordinal - 1];
            if (picked && picked >= start && picked <= end)
                dates.push(picked.toISODate()!);
        }
        month = month.plus({ months: 1 });
    }
    return [...new Set(dates)].sort();
}

adminEventsRouter.post('/events/recurring', async (req, res, next) => {
    try {
        const body = recurringSchema.parse(req.body);
        await assertScorableKey(body.matrix_item_key);
        const start = DateTime.fromISO(body.start_date, { zone: NAIROBI });
        const end = DateTime.fromISO(body.end_date, { zone: NAIROBI });
        if (end < start)
            throw badRequest('The end date is before the start date.');
        if (end.diff(start, 'days').days > 400) {
            throw badRequest('Generate at most about a year of events at a time.');
        }
        if (body.pattern === 'monthly' && (!body.ordinals || body.ordinals.length === 0)) {
            throw badRequest('Choose which occurrences in the month to generate, such as the 2nd and the 4th.');
        }
        const dates = body.pattern === 'monthly'
            ? monthlyOrdinalDates(start, end, body.weekday, body.ordinals!)
            : weeklyDates(start, end, body.weekday);
        if (dates.length === 0)
            throw badRequest('That range contains no matching days.');
        if (dates.length > 120)
            throw badRequest('That would create more than 120 events. Narrow the range.');
        const actor = actorFor(req, 'event-create-recurring');
        const principal = principalOf(req);
        const ids = await withTransaction(async (client) => {
            const created: string[] = [];
            for (const date of dates) {
                const event = await queryOne<{
                    id: string;
                }>(`INSERT INTO events (type, subtype, matrix_item_key, title, date, description,
                               prayer_house_id, created_by)
           VALUES ($1::event_type, $2, $3, $4, $5::date, $6, $7, $8) RETURNING id`, [body.type, body.subtype ?? null, body.matrix_item_key ?? null, body.title,
                    date, body.description ?? null, body.prayer_house_id ?? null, principal.userId], client);
                created.push(event!.id);
                await writeAudit(client, {
                    entityType: 'event', entityId: event!.id, action: 'create',
                    newValue: { title: body.title, date, matrix_item_key: body.matrix_item_key ?? null, series: body.pattern },
                }, actor);
            }
            return created;
        });
        res.status(201).json({ status: 'created', count: ids.length, event_ids: ids });
    }
    catch (err) {
        next(err);
    }
});
const novenaSchema = z.object({
    title: z.string().trim().min(3).max(160).default('Novena'),
    start_date: isoDate,
    days: z.coerce.number().int().min(1).max(30).default(9),
    prayer_house_id: z.string().uuid().nullish(),
});
adminEventsRouter.post('/events/novena', async (req, res, next) => {
    try {
        const body = novenaSchema.parse(req.body);
        const seriesId = randomUUID();
        const start = DateTime.fromISO(body.start_date, { zone: NAIROBI });
        const actor = actorFor(req, 'event-create-novena');
        const principal = principalOf(req);
        const ids = await withTransaction(async (client) => {
            const created: string[] = [];
            for (let day = 0; day < body.days; day += 1) {
                const date = start.plus({ days: day }).toISODate()!;
                const event = await queryOne<{
                    id: string;
                }>(`INSERT INTO events (type, matrix_item_key, novena_series_id, title, date,
                               prayer_house_id, created_by)
           VALUES ('novena', 'novena', $1, $2, $3::date, $4, $5) RETURNING id`, [seriesId, `${body.title} - day ${day + 1}`, date, body.prayer_house_id ?? null, principal.userId], client);
                created.push(event!.id);
                await writeAudit(client, {
                    entityType: 'event', entityId: event!.id, action: 'create',
                    newValue: { title: body.title, date, novena_series_id: seriesId, day: day + 1 },
                }, actor);
            }
            return created;
        });
        res.status(201).json({ status: 'created', novena_series_id: seriesId, count: ids.length });
    }
    catch (err) {
        next(err);
    }
});
adminEventsRouter.delete('/events/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const actor = actorFor(req, 'event-delete');
        await withTransaction(async (client) => {
            const counts = await queryOne<{
                attendance: string;
                contributions: string;
                title: string;
            }>(`SELECT (SELECT count(*) FROM attendance WHERE event_id = e.id)::text AS attendance,
                (SELECT count(*) FROM contributions WHERE event_id = e.id)::text AS contributions,
                e.title
         FROM events e WHERE e.id = $1 FOR UPDATE`, [id], client);
            if (!counts)
                throw notFound('That event could not be found.');
            if (Number(counts.attendance) > 0 || Number(counts.contributions) > 0) {
                throw conflict('That event already has attendance or contributions recorded, so it cannot be deleted.');
            }
            await query(`DELETE FROM events WHERE id = $1`, [id], client);
            await writeAudit(client, {
                entityType: 'event', entityId: id, action: 'delete', oldValue: { title: counts.title },
            }, actor);
        });
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
adminEventsRouter.get('/events/:id/register', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const event = await queryOne(`SELECT id, title, date, type, subtype, matrix_item_key FROM events WHERE id = $1`, [id]);
        if (!event)
            throw notFound('That event could not be found.');
        const rows = await query(`SELECT m.id AS member_id, m.full_name, ph.name AS prayer_house,
              a.id AS attendance_id, a.status, a.reason
       FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN attendance a ON a.member_id = m.id AND a.event_id = $1
       WHERE m.membership_status = 'active'
       ORDER BY ph.name, m.full_name`, [id]);
        res.json({ event, register: rows.rows });
    }
    catch (err) {
        next(err);
    }
});
const bulkSchema = z.object({
    entries: z.array(z.object({
        member_id: z.string().uuid(),
        status: z.enum(['present', 'absent', 'apology']),
        reason: z.string().trim().max(200).nullish(),
    })).min(1).max(1000),
});
adminEventsRouter.put('/events/:id/attendance', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const { entries } = bulkSchema.parse(req.body);
        const actor = actorFor(req, 'attendance-bulk');
        const principal = principalOf(req);
        const summary = await withTransaction(async (client) => {
            const event = await queryOne<{
                id: string;
                matrix_item_key: string | null;
            }>(`SELECT id, matrix_item_key FROM events WHERE id = $1`, [id], client);
            if (!event)
                throw notFound('That event could not be found.');
            const before = await query<{
                member_id: string;
                status: string;
                reason: string | null;
            }>(`SELECT member_id, status, reason FROM attendance WHERE event_id = $1`, [id], client);
            const previous = new Map(before.rows.map((r) => [r.member_id, r]));
            const memberIds = entries.map((e) => e.member_id);
            const statuses = entries.map((e) => e.status);
            const reasons = entries.map((e) => e.reason ?? null);
            await query(`INSERT INTO attendance (member_id, event_id, status, reason, recorded_by)
         SELECT m.member_id, $2, m.status::attendance_status, m.reason, $5
         FROM unnest($1::uuid[], $3::text[], $4::text[]) AS m(member_id, status, reason)
         ON CONFLICT (member_id, event_id) DO UPDATE
           SET status = EXCLUDED.status,
               reason = EXCLUDED.reason,
               recorded_by = EXCLUDED.recorded_by,
               updated_at = now()`, [memberIds, id, statuses, reasons, principal.userId], client);
            let created = 0;
            let updated = 0;
            for (const entry of entries) {
                const was = previous.get(entry.member_id);
                if (!was) {
                    created += 1;
                    await writeAudit(client, {
                        entityType: 'attendance', entityId: null, action: 'create',
                        newValue: { member_id: entry.member_id, event_id: id, status: entry.status, reason: entry.reason ?? null },
                    }, actor);
                }
                else if (was.status !== entry.status || (was.reason ?? null) !== (entry.reason ?? null)) {
                    updated += 1;
                    await writeAudit(client, {
                        entityType: 'attendance', entityId: null, action: 'update',
                        fieldChanged: 'status',
                        oldValue: { member_id: entry.member_id, event_id: id, status: was.status, reason: was.reason },
                        newValue: { member_id: entry.member_id, event_id: id, status: entry.status, reason: entry.reason ?? null },
                    }, actor);
                }
            }
            return { created, updated, unchanged: entries.length - created - updated, event };
        });
        // Live scores are recomputed on every read and never cached, so there
        // is nothing to recalculate here. The register is simply saved.
        res.json({
            status: 'saved',
            created: summary.created,
            updated: summary.updated,
            unchanged: summary.unchanged,
        });
    }
    catch (err) {
        next(err);
    }
});
const singleSchema = z.object({
    member_id: z.string().uuid(),
    status: z.enum(['present', 'absent', 'apology']),
    reason: z.string().trim().max(200).nullish(),
});
adminEventsRouter.put('/events/:id/attendance/one', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const body = singleSchema.parse(req.body);
        const actor = actorFor(req, 'attendance-single');
        const principal = principalOf(req);
        await withTransaction(async (client) => {
            const was = await queryOne<{
                id: string;
                status: string;
                reason: string | null;
            }>(`SELECT id, status, reason FROM attendance
         WHERE event_id = $1 AND member_id = $2 FOR UPDATE`, [id, body.member_id], client);
            const row = await queryOne<{
                id: string;
            }>(`INSERT INTO attendance (member_id, event_id, status, reason, recorded_by)
         VALUES ($1, $2, $3::attendance_status, $4, $5)
         ON CONFLICT (member_id, event_id) DO UPDATE
           SET status = EXCLUDED.status, reason = EXCLUDED.reason,
               recorded_by = EXCLUDED.recorded_by, updated_at = now()
         RETURNING id`, [body.member_id, id, body.status, body.reason ?? null, principal.userId], client);
            if (!was) {
                await writeAudit(client, {
                    entityType: 'attendance', entityId: row!.id, action: 'create',
                    newValue: { member_id: body.member_id, event_id: id, status: body.status },
                }, actor);
            }
            else if (was.status !== body.status || (was.reason ?? null) !== (body.reason ?? null)) {
                await writeAudit(client, {
                    entityType: 'attendance', entityId: row!.id, action: 'update', fieldChanged: 'status',
                    oldValue: { status: was.status, reason: was.reason },
                    newValue: { status: body.status, reason: body.reason ?? null },
                }, actor);
            }
        });
        const { recalculateForMember } = await import('../matrix/recalc.js');
        const score = await recalculateForMember(body.member_id);
        res.json({ status: 'saved', live_score: score });
    }
    catch (err) {
        next(err);
    }
});
