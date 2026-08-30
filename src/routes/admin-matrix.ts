import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { evaluateMatrix, evaluateMatrixForMember } from '../matrix/engine.js';
import { writeSnapshots } from '../matrix/snapshot.js';
import { loadMatrixRules } from '../matrix/rules.js';
import { loadMatrixConfig } from '../matrix/config.js';
import { requeueFailed } from '../comms/batch.js';
import { currentPeriod, periodEnd, periodHasEnded, previousPeriod } from '../util/time.js';
import { badRequest, notFound } from '../util/errors.js';
export const adminMatrixRouter = Router();
const leaderboardQuery = z.object({
    prayer_house_id: z.string().uuid().optional(),
    standing: z.enum(['in_good_standing', 'below_threshold', 'insufficient_history', 'ineligible_gate']).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
});
adminMatrixRouter.get('/matrix/leaderboard', async (req, res, next) => {
    try {
        const filters = leaderboardQuery.parse(req.query);
        const members = await query<{
            id: string;
            full_name: string;
            prayer_house: string;
        }>(`SELECT m.id, m.full_name, ph.name AS prayer_house
       FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       WHERE m.membership_status = 'active'
         AND ($1::uuid IS NULL OR m.prayer_house_id = $1)
       ORDER BY m.full_name
       LIMIT $2`, [filters.prayer_house_id ?? null, filters.limit]);
        if (members.rows.length === 0) {
            res.json({ members: [], summary: {}, evaluated: 0 });
            return;
        }
        const results = await evaluateMatrix(members.rows.map((m) => m.id));
        const byId = new Map(results.map((r) => [r.member_id, r]));
        let rows = members.rows.map((m) => {
            const result = byId.get(m.id)!;
            return {
                member_id: m.id,
                full_name: m.full_name,
                prayer_house: m.prayer_house,
                spirituality_score: result.spirituality_score,
                financial_score: result.financial_score,
                total_score: result.total_score,
                attainable_total: result.attainable_total,
                standing: result.standing,
                gate_passed: result.gate.passed,
                gate_reasons: result.gate.reasons,
            };
        });
        if (filters.standing)
            rows = rows.filter((r) => r.standing === filters.standing);
        rows.sort((a, b) => b.total_score - a.total_score);
        const summary: Record<string, number> = {};
        for (const result of results)
            summary[result.standing] = (summary[result.standing] ?? 0) + 1;
        res.json({ members: rows, summary, evaluated: results.length });
    }
    catch (err) {
        next(err);
    }
});
adminMatrixRouter.get('/matrix/member/:id', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const result = await evaluateMatrixForMember(id);
        if (!result)
            throw notFound('That member could not be found.');
        const member = await queryOne(`SELECT m.full_name, ph.name AS prayer_house FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id WHERE m.id = $1`, [id]);
        res.json({ member, matrix: result });
    }
    catch (err) {
        next(err);
    }
});
adminMatrixRouter.get('/matrix/rules', async (_req, res, next) => {
    try {
        const [rules, config] = await Promise.all([loadMatrixRules(), loadMatrixConfig()]);
        res.json({
            rules,
            config: { ...config, raw: undefined },
            totals: {
                spirituality: rules.filter((r) => r.category === 'spirituality').reduce((s, r) => s + r.points, 0),
                financial: rules.filter((r) => r.category === 'financial').reduce((s, r) => s + r.points, 0),
            },
        });
    }
    catch (err) {
        next(err);
    }
});
const snapshotSchema = z.object({
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});
adminMatrixRouter.post('/matrix/snapshots', async (req, res, next) => {
    try {
        const { period } = snapshotSchema.parse(req.body ?? {});
        const target = period ?? previousPeriod();

        // A snapshot is immutable once written, so it has to be evaluated as of
        // the period it belongs to. Writing today's figures under an earlier
        // month would be permanent and wrong.
        if (!periodHasEnded(target)) {
            throw badRequest(
                `${target} has not finished yet, so its snapshot would be incomplete and could never be corrected. `
                + 'Use the leaderboard for live figures, and take the snapshot once the month has ended.',
            );
        }

        const summary = await writeSnapshots(target, periodEnd(target));
        res.status(201).json(summary);
    }
    catch (err) {
        next(err);
    }
});
adminMatrixRouter.post('/matrix/snapshots/requeue', async (req, res, next) => {
    try {
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
            .parse((req.body ?? {}).period ?? req.query.period);
        const requeued = await requeueFailed(period);
        res.json({ status: 'requeued', period, requeued });
    }
    catch (err) {
        next(err);
    }
});
adminMatrixRouter.get('/matrix/snapshots', async (req, res, next) => {
    try {
        // Snapshots are only ever written for a period that has ended, so the
        // last completed month is the one an officer means by default.
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
            .parse(req.query.period) ?? previousPeriod();
        const rows = await query(`SELECT s.id, s.member_id, m.full_name, s.spirituality_score, s.financial_score,
              s.total_score, s.attainable_total, s.standing, s.generated_at,
              s.email_status, s.sent_at
       FROM matrix_scores s
       JOIN members m ON m.id = s.member_id
       WHERE s.period = $1
       ORDER BY s.total_score DESC`, [period]);
        const summary = await query<{
            standing: string;
            n: string;
        }>(`SELECT standing, count(*)::text AS n FROM matrix_scores WHERE period = $1 GROUP BY standing`, [period]);
        // A report that failed to send is invisible unless it is counted here.
        const delivery = await query<{
            email_status: string;
            n: string;
        }>(`SELECT email_status, count(*)::text AS n FROM matrix_scores
       WHERE period = $1 GROUP BY email_status`, [period]);
        res.json({
            period,
            snapshots: rows.rows,
            by_standing: Object.fromEntries(summary.rows.map((r) => [r.standing, Number(r.n)])),
            by_email_status: Object.fromEntries(delivery.rows.map((r) => [r.email_status, Number(r.n)])),
            latest_complete_period: previousPeriod(),
        });
    }
    catch (err) {
        next(err);
    }
});
