import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { principalOf } from '../middleware/auth.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { loadMatrixConfig, configNumber } from '../matrix/config.js';
import { evaluateMatrixForMember } from '../matrix/engine.js';
import { NAIROBI, previousPeriod, todayNairobi } from '../util/time.js';
import { WELFARE_SUPPORT_TYPES, valuesOf } from '../../shared/vocabulary.js';
import type { Request } from 'express';

/**
 * Welfare support under by-laws section 5.3. The Matrix says who is eligible;
 * this says what was decided, by whom, and on which month's standing. Bound to
 * the immutable snapshot, not the live score, which moves constantly.
 */
export const adminWelfareRouter = Router();

const SUPPORT_TYPES = valuesOf(WELFARE_SUPPORT_TYPES);
type SupportType = (typeof WELFARE_SUPPORT_TYPES)[number]['value'];

const BEREAVEMENT: SupportType[] = [
    'benevolent_member_spouse', 'benevolent_child', 'benevolent_parent',
];
const WEDDING: SupportType[] = ['pre_wedding', 'wedding_gift'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

function actorFor(req: Request, label: string): AuditActor {
    const principal = principalOf(req);
    return { userId: principal.userId, requestId: label, ip: req.ip ?? null };
}

async function defaultAmount(type: SupportType): Promise<number> {
    const config = await loadMatrixConfig();
    const raw = config.raw['welfare_amounts'];
    const amounts = (raw && typeof raw === 'object' && !Array.isArray(raw))
        ? raw as Record<string, unknown>
        : {};
    const value = Number(amounts[type]);
    return Number.isFinite(value) ? value : 0;
}

/** What the by-laws offer for each kind of support, for the claim form. */
adminWelfareRouter.get('/welfare/support-types', async (_req, res, next) => {
    try {
        const config = await loadMatrixConfig();
        const raw = config.raw['welfare_amounts'];
        const amounts = (raw && typeof raw === 'object' && !Array.isArray(raw))
            ? raw as Record<string, unknown>
            : {};
        res.json({
            support_types: WELFARE_SUPPORT_TYPES.map((t) => ({
                key: t.value,
                label: t.label,
                default_amount: Number(amounts[t.value]) || 0,
            })),
            child_max_age: configNumber(config, 'welfare_child_max_age', 18),
            sickness_min_days: configNumber(config, 'welfare_sickness_min_days', 7),
            standing_required: 'in_good_standing',
        });
    }
    catch (err) {
        next(err);
    }
});

const claimSchema = z.object({
    member_id: z.string().uuid(),
    support_type: z.enum(SUPPORT_TYPES),
    amount: z.coerce.number().min(0).max(10000000).optional(),
    subject_name: z.string().trim().max(160).nullish(),
    event_id: z.string().uuid().nullish(),
    child_id: z.string().uuid().nullish(),
    admitted_on: isoDate.nullish(),
    discharged_on: isoDate.nullish(),
    note: z.string().trim().max(500).nullish(),
});

adminWelfareRouter.post('/welfare/claims', async (req, res, next) => {
    try {
        const body = claimSchema.parse(req.body);
        const config = await loadMatrixConfig();
        const actor = actorFor(req, 'welfare-claim-open');
        const principal = principalOf(req);

        if (WEDDING.includes(body.support_type) && !body.event_id) {
            throw badRequest('Name the wedding this payment is for.');
        }
        if (BEREAVEMENT.includes(body.support_type) && !body.subject_name) {
            throw badRequest('Name the person who has died.');
        }
        if (body.support_type === 'sickness_advance') {
            const minDays = configNumber(config, 'welfare_sickness_min_days', 7);
            if (!body.admitted_on || !body.discharged_on) {
                throw badRequest('Enter the admission and discharge dates.');
            }
            const days = DateTime.fromISO(body.discharged_on, { zone: NAIROBI })
                .diff(DateTime.fromISO(body.admitted_on, { zone: NAIROBI }), 'days').days;
            if (days <= minDays) {
                throw badRequest(`The by-laws apply this advance to an admission of more than ${minDays} days. This one is ${days} days.`);
            }
        }

        const amount = body.amount ?? await defaultAmount(body.support_type);

        const created = await withTransaction(async (client) => {
            const member = await queryOne<{
                id: string;
                full_name: string;
            }>(`SELECT id, full_name FROM members WHERE id = $1`, [body.member_id], client);
            if (!member)
                throw notFound('That member could not be found.');

            if (body.support_type === 'benevolent_child') {
                const maxAge = configNumber(config, 'welfare_child_max_age', 18);
                const child = await queryOne<{
                    name: string;
                    date_of_birth: string | null;
                    age: number | null;
                }>(`SELECT name, date_of_birth::text,
                    CASE WHEN date_of_birth IS NULL THEN NULL
                         ELSE extract(year from age(date_of_birth))::int END AS age
             FROM children WHERE id = $1 AND member_id = $2`, [body.child_id ?? null, body.member_id], client);
                if (!child)
                    throw badRequest('Choose a child from this member record.');
                if (child.age === null) {
                    throw badRequest(`${child.name} has no date of birth on file, so the under-${maxAge} condition cannot be checked. Record it first.`);
                }
                if (child.age >= maxAge) {
                    throw badRequest(`The by-laws apply this payment to a child below ${maxAge}. ${child.name} is ${child.age}.`);
                }
            }

            const row = await queryOne<{
                id: string;
            }>(`INSERT INTO welfare_claims
           (member_id, support_type, amount, subject_name, event_id, child_id,
            admitted_on, discharged_on, note, requested_by)
         VALUES ($1, $2::welfare_support_type, $3, $4, $5, $6, $7::date, $8::date, $9, $10)
         RETURNING id`, [
                body.member_id, body.support_type, amount, body.subject_name ?? null,
                body.event_id ?? null, body.child_id ?? null,
                body.admitted_on ?? null, body.discharged_on ?? null,
                body.note ?? null, principal.userId,
            ], client);

            await writeAudit(client, {
                entityType: 'welfare_claim', entityId: row!.id, action: 'create',
                newValue: {
                    member_id: body.member_id, member: member.full_name,
                    support_type: body.support_type, amount,
                    subject_name: body.subject_name ?? null,
                },
            }, actor);
            return row!.id;
        });

        res.status(201).json({ status: 'opened', claim_id: created, amount });
    }
    catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
            next(conflict('A claim of that kind is already open for this member and this event.'));
            return;
        }
        next(err);
    }
});

/**
 * The standing a decision would rest on. Read before approving, so the officer
 * sees the same figures the record will keep.
 */
adminWelfareRouter.get('/welfare/claims/:id/standing', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
            .parse(req.query.period) ?? previousPeriod();

        const claim = await queryOne<{
            member_id: string;
            full_name: string;
        }>(`SELECT c.member_id, m.full_name FROM welfare_claims c
       JOIN members m ON m.id = c.member_id WHERE c.id = $1`, [id]);
        if (!claim)
            throw notFound('That claim could not be found.');

        const snapshot = await queryOne(`SELECT id, period, spirituality_score, financial_score, total_score,
              attainable_total, standing, generated_at
       FROM matrix_scores WHERE member_id = $1 AND period = $2`, [claim.member_id, period]);
        const live = await evaluateMatrixForMember(claim.member_id);

        res.json({
            member: { id: claim.member_id, full_name: claim.full_name },
            period,
            snapshot,
            live: live && {
                as_of: live.as_of,
                total_score: live.total_score,
                attainable_total: live.attainable_total,
                standing: live.standing,
                gate: live.gate,
            },
            note: snapshot
                ? 'A decision records the snapshot, not the live score, because a snapshot cannot change afterwards.'
                : `There is no snapshot for ${period}. Take one for a completed month before deciding, or record the decision with a reason.`,
        });
    }
    catch (err) {
        next(err);
    }
});

const decisionSchema = z.object({
    decision: z.enum(['approved', 'rejected']),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    decision_note: z.string().trim().max(500).nullish(),
    // An approval without a qualifying snapshot needs a reason on the record.
    override_reason: z.string().trim().min(4).max(300).nullish(),
});

adminWelfareRouter.post('/welfare/claims/:id/decide', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const body = decisionSchema.parse(req.body);
        const period = body.period ?? previousPeriod();
        const actor = actorFor(req, `welfare-claim-${body.decision}`);
        const principal = principalOf(req);

        const result = await withTransaction(async (client) => {
            const claim = await queryOne<{
                id: string;
                member_id: string;
                status: string;
                support_type: string;
                amount: string;
            }>(`SELECT id, member_id, status, support_type, amount::text
           FROM welfare_claims WHERE id = $1 FOR UPDATE`, [id], client);
            if (!claim)
                throw notFound('That claim could not be found.');
            if (claim.status !== 'pending') {
                throw conflict(`That claim is already ${claim.status}, so it cannot be decided again.`);
            }

            const snapshot = await queryOne<{
                id: string;
                standing: string;
                total_score: string;
            }>(`SELECT id, standing, total_score::text FROM matrix_scores
           WHERE member_id = $1 AND period = $2`, [claim.member_id, period], client);

            if (body.decision === 'approved') {
                if (!snapshot && !body.override_reason) {
                    throw badRequest(
                        `There is no ${period} snapshot for this member, so their standing cannot be evidenced. `
                        + 'Take the snapshot for a completed month, or send a reason in override_reason.',
                    );
                }
                if (snapshot && snapshot.standing !== 'in_good_standing' && !body.override_reason) {
                    throw conflict(
                        `That member was "${snapshot.standing}" for ${period}, not in good standing. `
                        + 'If the committee has agreed to pay anyway, send a reason in override_reason.',
                    );
                }
            }

            await query(`UPDATE welfare_claims
           SET status = $2::welfare_claim_status,
               decided_at = now(), decided_by = $3, decision_note = $4,
               period = $5, matrix_score_id = $6,
               standing_relied_on = $7::matrix_standing, score_relied_on = $8,
               updated_at = now()
         WHERE id = $1`, [
                id, body.decision, principal.userId, body.decision_note ?? null,
                period, snapshot?.id ?? null,
                snapshot?.standing ?? null, snapshot?.total_score ?? null,
            ], client);

            await writeAudit(client, {
                entityType: 'welfare_claim', entityId: id, action: 'update',
                fieldChanged: 'status', oldValue: claim.status,
                newValue: {
                    status: body.decision, period,
                    standing_relied_on: snapshot?.standing ?? null,
                    score_relied_on: snapshot?.total_score ?? null,
                    amount: claim.amount,
                    ...(body.override_reason ? { override_reason: body.override_reason } : {}),
                    ...(body.decision_note ? { note: body.decision_note } : {}),
                },
            }, actor);

            return { status: body.decision, standing: snapshot?.standing ?? null };
        });

        res.json({ status: result.status, period, standing_relied_on: result.standing });
    }
    catch (err) {
        next(err);
    }
});

const paymentSchema = z.object({
    payment_reference: z.string().trim().min(1, 'Record how the payment was made').max(120),
    paid_on: isoDate.optional(),
});

adminWelfareRouter.post('/welfare/claims/:id/pay', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const body = paymentSchema.parse(req.body);
        const actor = actorFor(req, 'welfare-claim-paid');
        const principal = principalOf(req);

        await withTransaction(async (client) => {
            const claim = await queryOne<{
                status: string;
                amount: string;
            }>(`SELECT status, amount::text FROM welfare_claims WHERE id = $1 FOR UPDATE`, [id], client);
            if (!claim)
                throw notFound('That claim could not be found.');
            if (claim.status === 'paid')
                throw conflict('That claim is already recorded as paid.');
            if (claim.status !== 'approved') {
                throw conflict(`Only an approved claim can be paid. This one is ${claim.status}.`);
            }

            await query(`UPDATE welfare_claims
           SET status = 'paid', paid_at = COALESCE($2::date, now()), paid_by = $3,
               payment_reference = $4, updated_at = now()
         WHERE id = $1`, [id, body.paid_on ?? null, principal.userId, body.payment_reference], client);

            await writeAudit(client, {
                entityType: 'welfare_claim', entityId: id, action: 'update',
                fieldChanged: 'status', oldValue: 'approved',
                newValue: {
                    status: 'paid', amount: claim.amount,
                    paid_on: body.paid_on ?? todayNairobi(),
                    payment_reference: body.payment_reference,
                },
            }, actor);
        });

        res.json({ status: 'paid' });
    }
    catch (err) {
        next(err);
    }
});

const cancelSchema = z.object({ reason: z.string().trim().min(4, 'Say why it is being withdrawn').max(300) });

adminWelfareRouter.post('/welfare/claims/:id/cancel', async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const { reason } = cancelSchema.parse(req.body);
        const actor = actorFor(req, 'welfare-claim-cancelled');

        await withTransaction(async (client) => {
            const claim = await queryOne<{
                status: string;
            }>(`SELECT status FROM welfare_claims WHERE id = $1 FOR UPDATE`, [id], client);
            if (!claim)
                throw notFound('That claim could not be found.');
            if (claim.status === 'paid')
                throw conflict('That claim has been paid, so it cannot be withdrawn. Record the correction separately.');
            if (claim.status === 'cancelled')
                throw conflict('That claim is already withdrawn.');

            await query(`UPDATE welfare_claims SET status = 'cancelled', decision_note = $2, updated_at = now()
         WHERE id = $1`, [id, reason], client);
            await writeAudit(client, {
                entityType: 'welfare_claim', entityId: id, action: 'update',
                fieldChanged: 'status', oldValue: claim.status,
                newValue: { status: 'cancelled', reason },
            }, actor);
        });

        res.status(200).json({ status: 'cancelled' });
    }
    catch (err) {
        next(err);
    }
});

adminWelfareRouter.get('/welfare/claims', async (req, res, next) => {
    try {
        const filters = z.object({
            status: z.enum(['pending', 'approved', 'rejected', 'paid', 'cancelled']).optional(),
            member_id: z.string().uuid().optional(),
            support_type: z.enum(SUPPORT_TYPES).optional(),
            from: isoDate.optional(),
            to: isoDate.optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
            offset: z.coerce.number().int().min(0).default(0),
        }).parse(req.query);

        const where = [
            filters.status ?? null, filters.member_id ?? null,
            filters.support_type ?? null, filters.from ?? null, filters.to ?? null,
        ];
        const rows = await query(`SELECT c.id, c.support_type, c.amount, c.status, c.period,
              c.standing_relied_on, c.score_relied_on, c.subject_name,
              c.admitted_on, c.discharged_on, c.note, c.decision_note,
              c.requested_at, c.decided_at, c.paid_at, c.payment_reference,
              m.id AS member_id, m.full_name, ph.name AS prayer_house,
              e.title AS event_title, ch.name AS child_name,
              ru.username AS requested_by, du.username AS decided_by, pu.username AS paid_by
       FROM welfare_claims c
       JOIN members m ON m.id = c.member_id
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN children ch ON ch.id = c.child_id
       LEFT JOIN users ru ON ru.id = c.requested_by
       LEFT JOIN users du ON du.id = c.decided_by
       LEFT JOIN users pu ON pu.id = c.paid_by
       WHERE ($1::welfare_claim_status IS NULL OR c.status = $1)
         AND ($2::uuid IS NULL OR c.member_id = $2)
         AND ($3::welfare_support_type IS NULL OR c.support_type = $3)
         AND ($4::date IS NULL OR c.requested_at::date >= $4)
         AND ($5::date IS NULL OR c.requested_at::date <= $5)
       ORDER BY (c.status = 'pending') DESC, c.requested_at DESC
       LIMIT $6 OFFSET $7`, [...where, filters.limit, filters.offset]);

        const totals = await queryOne<{
            n: string;
            open_n: string;
            paid_total: string;
            approved_total: string;
        }>(`SELECT count(*)::text AS n,
              count(*) FILTER (WHERE status = 'pending')::text AS open_n,
              COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::text AS paid_total,
              COALESCE(sum(amount) FILTER (WHERE status = 'approved'), 0)::text AS approved_total
       FROM welfare_claims c
       WHERE ($1::welfare_claim_status IS NULL OR c.status = $1)
         AND ($2::uuid IS NULL OR c.member_id = $2)
         AND ($3::welfare_support_type IS NULL OR c.support_type = $3)
         AND ($4::date IS NULL OR c.requested_at::date >= $4)
         AND ($5::date IS NULL OR c.requested_at::date <= $5)`, where);

        res.json({
            claims: rows.rows,
            total: Number(totals?.n ?? 0),
            pending: Number(totals?.open_n ?? 0),
            paid_total: totals?.paid_total ?? '0',
            approved_unpaid_total: totals?.approved_total ?? '0',
            limit: filters.limit,
            offset: filters.offset,
        });
    }
    catch (err) {
        next(err);
    }
});
