import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { principalOf } from '../middleware/auth.js';
import { auditFieldChanges, writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
export const adminMembersRouter = Router();
const EDITABLE = [
    'full_name', 'year_of_birth', 'id_or_passport_no', 'mobile_no',
    'home_parish_diocese', 'jumuiya', 'prayer_house_id', 'marital_status',
    'spouse_name', 'spouse_status', 'father_status', 'mother_status',
    'next_of_kin_name', 'next_of_kin_id_no', 'next_of_kin_mobile',
    'membership_status', 'profile_locked',
] as const;
const nullableText = z.string().trim().max(200).nullish().transform((v) => (v ? v : null));
const updateSchema = z.object({
    full_name: z.string().trim().min(3).max(160).optional(),
    year_of_birth: z.coerce.number().int().min(1900).max(2100).optional(),
    id_or_passport_no: z.string().trim().min(4).max(40).optional(),
    mobile_no: z.string().trim().min(7).max(20).optional(),
    home_parish_diocese: nullableText.optional(),
    jumuiya: nullableText.optional(),
    prayer_house_id: z.string().uuid().optional(),
    marital_status: z.enum(['married', 'widowed', 'single']).optional(),
    spouse_name: nullableText.optional(),
    spouse_status: z.enum(['alive', 'deceased']).nullish(),
    father_status: z.enum(['alive', 'deceased']).nullish(),
    mother_status: z.enum(['alive', 'deceased']).nullish(),
    next_of_kin_name: z.string().trim().min(3).max(160).optional(),
    next_of_kin_id_no: nullableText.optional(),
    next_of_kin_mobile: z.string().trim().min(7).max(20).optional(),
    membership_status: z.enum(['active', 'inactive', 'transferred', 'deceased']).optional(),
    profile_locked: z.boolean().optional(),
    reason: z.string().trim().max(300).optional(),
}).strict();
adminMembersRouter.patch('/members/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const body = updateSchema.parse(req.body);
        const { reason, ...changes } = body;
        if (Object.keys(changes).length === 0)
            throw badRequest('No changes were supplied.');
        const principal = principalOf(req);
        const actor: AuditActor = {
            userId: principal.userId,
            requestId: reason ? `admin-edit: ${reason}` : 'admin-edit',
            ip: req.ip ?? null,
        };
        const result = await withTransaction(async (client) => {
            const before = await queryOne<Record<string, unknown>>(`SELECT ${EDITABLE.join(', ')} FROM members WHERE id = $1 FOR UPDATE`, [id], client);
            if (!before)
                throw notFound('That member could not be found.');
            const columns = Object.keys(changes).filter((key): key is (typeof EDITABLE)[number] => (EDITABLE as readonly string[]).includes(key));
            if (columns.length === 0)
                throw badRequest('No editable fields were supplied.');
            const casts: Record<string, string> = {
                marital_status: '::marital_status',
                spouse_status: '::life_status',
                father_status: '::life_status',
                mother_status: '::life_status',
                membership_status: '::membership_status',
                prayer_house_id: '::uuid',
            };
            const assignments = columns.map((col, i) => `${col} = $${i + 2}${casts[col] ?? ''}`);
            const values = columns.map((col) => (changes as Record<string, unknown>)[col] ?? null);
            const after = await queryOne<Record<string, unknown>>(`UPDATE members SET ${assignments.join(', ')} WHERE id = $1
         RETURNING ${EDITABLE.join(', ')}`, [id, ...values], client);
            const changed = await auditFieldChanges(client, {
                entityType: 'member', entityId: id, before, after: after!, fields: columns,
            }, actor);
            return { changed, after };
        });
        res.json({ status: 'updated', fields_changed: result.changed, member: result.after });
    }
    catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
            next(conflict('Another member already has that ID or passport number.'));
            return;
        }
        next(err);
    }
});
const childrenSchema = z.object({
    children: z.array(z.object({
        name: z.string().trim().min(2).max(160),
        date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    })).max(20),
});
adminMembersRouter.put('/members/:id/children', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const { children } = childrenSchema.parse(req.body);
        const principal = principalOf(req);
        const saved = await withTransaction(async (client) => {
            const member = await queryOne<{
                id: string;
            }>(`SELECT id FROM members WHERE id = $1 FOR UPDATE`, [id], client);
            if (!member)
                throw notFound('That member could not be found.');
            const before = await query<{
                name: string;
                date_of_birth: string | null;
            }>(`SELECT name, date_of_birth FROM children WHERE member_id = $1 ORDER BY name`, [id], client);
            await query(`DELETE FROM children WHERE member_id = $1`, [id], client);
            for (const child of children) {
                await query(`INSERT INTO children (member_id, name, date_of_birth) VALUES ($1, $2, $3::date)`, [id, child.name, child.date_of_birth ?? null], client);
            }
            await writeAudit(client, {
                entityType: 'member', entityId: id, action: 'update', fieldChanged: 'children',
                oldValue: before.rows, newValue: children,
            }, { userId: principal.userId, requestId: 'admin-edit-children', ip: req.ip ?? null });
            return children;
        });
        res.json({ status: 'updated', children: saved });
    }
    catch (err) {
        next(err);
    }
});
