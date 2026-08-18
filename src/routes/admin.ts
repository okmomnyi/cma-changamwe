import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { notFound } from '../util/errors.js';
import { adminMembersRouter } from './admin-members.js';
import { adminOfficesRouter } from './admin-offices.js';
import { adminEventsRouter } from './admin-events.js';
import { adminContributionsRouter } from './admin-contributions.js';
import { adminMatrixRouter } from './admin-matrix.js';
export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
adminRouter.use(adminMembersRouter);
adminRouter.use(adminOfficesRouter);
adminRouter.use(adminEventsRouter);
adminRouter.use(adminContributionsRouter);
adminRouter.use(adminMatrixRouter);
const listQuery = z.object({
    q: z.string().trim().max(120).optional(),
    prayer_house_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
adminRouter.get('/members', async (req, res, next) => {
    try {
        const { q, prayer_house_id, limit, offset } = listQuery.parse(req.query);
        const rows = await query(`SELECT m.id, m.full_name, m.mobile_no, m.year_of_birth, m.marital_status,
              m.membership_status, m.profile_locked,
              ph.name AS prayer_house, ph.id AS prayer_house_id,
              '****' || right(m.id_or_passport_no, 4) AS id_no_masked,
              u.username, u.email,
              (SELECT array_agg(oh.office_key ORDER BY oh.office_key)
                 FROM office_holders oh
                WHERE oh.member_id = m.id AND oh.term_end IS NULL) AS offices
       FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN users u ON u.member_id = m.id
       WHERE ($1::text IS NULL OR m.full_name ILIKE '%' || $1 || '%'
                               OR m.mobile_no ILIKE '%' || $1 || '%')
         AND ($2::uuid IS NULL OR m.prayer_house_id = $2)
       ORDER BY m.full_name
       LIMIT $3 OFFSET $4`, [q ?? null, prayer_house_id ?? null, limit, offset]);
        const total = await queryOne<{
            n: string;
        }>(`SELECT count(*)::text AS n FROM members m
       WHERE ($1::text IS NULL OR m.full_name ILIKE '%' || $1 || '%'
                               OR m.mobile_no ILIKE '%' || $1 || '%')
         AND ($2::uuid IS NULL OR m.prayer_house_id = $2)`, [q ?? null, prayer_house_id ?? null]);
        res.json({ members: rows.rows, total: Number(total?.n ?? 0), limit, offset });
    }
    catch (err) {
        next(err);
    }
});
adminRouter.get('/members/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const member = await queryOne(`SELECT m.*, ph.name AS prayer_house, u.username, u.email, u.email_verified
       FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN users u ON u.member_id = m.id
       WHERE m.id = $1`, [id]);
        if (!member)
            throw notFound('That member could not be found.');
        const [children, offices, attendance, contributions] = await Promise.all([
            query(`SELECT id, name, date_of_birth FROM children WHERE member_id = $1
             ORDER BY date_of_birth NULLS LAST`, [id]),
            query(`SELECT office_key, scope, term_start, term_end FROM office_holders
             WHERE member_id = $1 ORDER BY term_start DESC`, [id]),
            query(`SELECT a.status, a.reason, e.title, e.date, e.matrix_item_key
             FROM attendance a JOIN events e ON e.id = a.event_id
             WHERE a.member_id = $1 ORDER BY e.date DESC LIMIT 25`, [id]),
            query(`SELECT category, amount, date, contribution_month, affiliation_year
             FROM contributions WHERE member_id = $1
             ORDER BY date DESC LIMIT 25`, [id]),
        ]);
        res.json({
            member,
            children: children.rows,
            offices: offices.rows,
            recent_attendance: attendance.rows,
            recent_contributions: contributions.rows,
        });
    }
    catch (err) {
        next(err);
    }
});
adminRouter.get('/prayer-houses', async (_req, res, next) => {
    try {
        const rows = await query(`SELECT ph.id, ph.name, count(m.id)::int AS member_count
       FROM prayer_houses ph
       LEFT JOIN members m ON m.prayer_house_id = ph.id
       GROUP BY ph.id, ph.name ORDER BY ph.name`);
        res.json({ prayer_houses: rows.rows });
    }
    catch (err) {
        next(err);
    }
});
adminRouter.get('/offices', async (_req, res, next) => {
    try {
        const rows = await query(`SELECT oh.id, oh.office_key, oh.scope, oh.term_start, oh.term_end,
              m.id AS member_id, m.full_name, ph.name AS prayer_house,
              (oh.office_key IN (SELECT jsonb_array_elements_text(value)
                                   FROM matrix_config WHERE key = 'admin_offices')) AS confers_admin
       FROM office_holders oh
       JOIN members m ON m.id = oh.member_id
       LEFT JOIN prayer_houses ph ON ph.id = oh.prayer_house_id
       ORDER BY (oh.term_end IS NOT NULL), oh.office_key, oh.term_start DESC`);
        res.json({ offices: rows.rows });
    }
    catch (err) {
        next(err);
    }
});
adminRouter.get('/events', async (req, res, next) => {
    try {
        const { limit, offset } = listQuery.parse(req.query);
        const rows = await query(`SELECT e.id, e.type, e.subtype, e.matrix_item_key, e.novena_series_id,
              e.title, e.date, e.description,
              (SELECT count(*) FROM attendance a WHERE a.event_id = e.id)::int AS attendance_recorded,
              (SELECT count(*) FROM attendance a
                WHERE a.event_id = e.id AND a.status IN ('present','apology'))::int AS present_or_apology
       FROM events e
       ORDER BY e.date DESC, e.title
       LIMIT $1 OFFSET $2`, [limit, offset]);
        const total = await queryOne<{
            n: string;
        }>(`SELECT count(*)::text AS n FROM events`);
        res.json({ events: rows.rows, total: Number(total?.n ?? 0), limit, offset });
    }
    catch (err) {
        next(err);
    }
});
const auditQuery = listQuery.extend({
    entity_type: z.enum(['member', 'attendance', 'contribution', 'office', 'user', 'event']).optional(),
});
adminRouter.get('/audit-log', async (req, res, next) => {
    try {
        const { entity_type, limit, offset } = auditQuery.parse(req.query);
        const rows = await query(`SELECT al.id::text, al.entity_type, al.entity_id, al.action, al.field_changed,
              al.old_value, al.new_value, al.changed_at, al.request_id,
              al.changed_by, u.username AS changed_by_username,
              m.full_name AS changed_by_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.changed_by
       LEFT JOIN members m ON m.id = u.member_id
       WHERE ($1::audit_entity_type IS NULL OR al.entity_type = $1)
       ORDER BY al.changed_at DESC, al.id DESC
       LIMIT $2 OFFSET $3`, [entity_type ?? null, limit, offset]);
        const total = await queryOne<{
            n: string;
        }>(`SELECT count(*)::text AS n FROM audit_log
       WHERE ($1::audit_entity_type IS NULL OR entity_type = $1)`, [entity_type ?? null]);
        res.json({ entries: rows.rows, total: Number(total?.n ?? 0), limit, offset });
    }
    catch (err) {
        next(err);
    }
});
adminRouter.get('/summary', async (_req, res, next) => {
    try {
        const row = await queryOne(`SELECT
         (SELECT count(*) FROM members)::int                                        AS members,
         (SELECT count(*) FROM members WHERE membership_status = 'active')::int     AS active_members,
         (SELECT count(*) FROM prayer_houses)::int                                  AS prayer_houses,
         (SELECT count(*) FROM office_holders WHERE term_end IS NULL)::int          AS sitting_officers,
         (SELECT count(*) FROM events)::int                                         AS events,
         (SELECT count(*) FROM events WHERE matrix_item_key IS NOT NULL)::int       AS scored_events,
         (SELECT count(*) FROM attendance)::int                                     AS attendance_records,
         (SELECT count(*) FROM contributions)::int                                  AS contributions,
         (SELECT COALESCE(sum(amount), 0)::text FROM contributions)                 AS contributions_total,
         (SELECT count(*) FROM audit_log)::int                                      AS audit_entries`);
        res.json({ summary: row });
    }
    catch (err) {
        next(err);
    }
});
