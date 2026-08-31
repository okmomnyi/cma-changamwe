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
import { adminWelfareRouter } from './admin-welfare.js';
import { adminOmrRouter } from './admin-omr.js';
import { backupStatus } from '../backup/run.js';
export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
adminRouter.use(adminMembersRouter);
adminRouter.use(adminOfficesRouter);
adminRouter.use(adminEventsRouter);
adminRouter.use(adminContributionsRouter);
adminRouter.use(adminMatrixRouter);
adminRouter.use(adminWelfareRouter);
adminRouter.use(adminOmrRouter);
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
        const rows = await query(`WITH term_years AS (
         SELECT COALESCE((SELECT (value #>> '{}')::int FROM matrix_config WHERE key = 'office_term_years'), 3) AS n
       )
       SELECT oh.id, oh.office_key, ot.label AS office_label,
              oh.scope, oh.term_start, oh.term_end,
              oh.prayer_house_id,
              m.id AS member_id, m.full_name, ph.name AS prayer_house,
              -- Only a sitting parish term carries administrative access. A
              -- prayer-house officer leads that house, not the parish.
              (oh.scope = 'parish'
               AND oh.office_key IN (SELECT jsonb_array_elements_text(value)
                                       FROM matrix_config WHERE key = 'admin_offices')) AS confers_admin,
              (oh.term_start + ((SELECT n FROM term_years) || ' years')::interval)::date AS term_due_on,
              (oh.term_end IS NULL
               AND oh.term_start + ((SELECT n FROM term_years) || ' years')::interval < now()) AS term_overdue,
              (SELECT count(*) FROM office_holders prior
                WHERE prior.member_id = oh.member_id
                  AND prior.office_key = oh.office_key
                  AND prior.scope = oh.scope
                  AND prior.prayer_house_id IS NOT DISTINCT FROM oh.prayer_house_id
                  AND prior.term_end IS NOT NULL)::int AS terms_completed
       FROM office_holders oh
       JOIN members m ON m.id = oh.member_id
       LEFT JOIN office_types ot ON ot.office_key = oh.office_key
       LEFT JOIN prayer_houses ph ON ph.id = oh.prayer_house_id
       ORDER BY (oh.term_end IS NOT NULL), oh.scope, ph.name NULLS FIRST,
                ot.sort_order NULLS LAST, oh.office_key, oh.term_start DESC`);
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
    entity_type: z.enum(['member', 'attendance', 'contribution', 'office', 'user', 'event',
        'welfare_claim', 'attendance_sheet', 'attendance_scan']).optional(),
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
/**
 * Whether the association is provably recoverable, rather than whether a job
 * last appeared to run. `stale` is what an alert would key on.
 */
adminRouter.get('/backups', async (_req, res, next) => {
    try {
        const status = await backupStatus();
        const recent = await query(`SELECT object_key, status, started_at, finished_at, verified_at,
              byte_size, row_count, schema_version, duration_ms, error
       FROM backup_runs
       ORDER BY started_at DESC
       LIMIT 20`);
        res.json({ ...status, recent: recent.rows });
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
         (SELECT count(*) FROM audit_log)::int                                      AS audit_entries,
         (SELECT count(*) FROM welfare_claims WHERE status = 'pending')::int        AS welfare_pending,
         (SELECT count(*) FROM welfare_claims WHERE status = 'approved')::int       AS welfare_approved_unpaid,
         (SELECT COALESCE(sum(amount), 0)::text FROM welfare_claims WHERE status = 'paid')
                                                                                    AS welfare_paid_total`);
        res.json({ summary: row });
    }
    catch (err) {
        next(err);
    }
});
