import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { requireAuth, principalOf } from '../middleware/auth.js';
import { badRequest, conflict, notFound, tooManyRequests, unauthorized } from '../util/errors.js';
import { evaluateMatrixForMember } from '../matrix/engine.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { hashToken } from '../auth/tokens.js';
import { issueEmailChangeOtp, verifyOtp, OTP_TTL_MINUTES } from '../auth/otp.js';
import { sendEmail } from '../email/mailer.js';
import { otpEmail, noticeEmail } from '../email/templates.js';
import { writeAudit } from '../audit/audit.js';
import { otpSendLimiter, otpVerifyLimiter } from '../middleware/rateLimit.js';
export const meRouter = Router();
meRouter.use(requireAuth);
meRouter.get('/profile', async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const member = await queryOne(`SELECT m.id, m.full_name, m.year_of_birth, m.id_or_passport_no, m.mobile_no,
              m.home_parish_diocese, m.jumuiya, m.marital_status, m.spouse_name,
              m.spouse_status, m.father_status, m.mother_status,
              m.next_of_kin_name, m.next_of_kin_id_no, m.next_of_kin_mobile,
              m.membership_status, m.profile_locked, m.declaration_accepted_at,
              m.created_at, ph.name AS prayer_house
       FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       WHERE m.id = $1`, [memberId]);
        if (!member)
            throw notFound('Your member record could not be found.');
        const children = await query(`SELECT id, name, date_of_birth FROM children
       WHERE member_id = $1 ORDER BY date_of_birth NULLS LAST, name`, [memberId]);
        const offices = await query(`SELECT office_key, scope, term_start, term_end
       FROM office_holders WHERE member_id = $1
       ORDER BY term_start DESC`, [memberId]);
        res.json({ member, children: children.rows, offices: offices.rows });
    }
    catch (err) {
        next(err);
    }
});
const historyQuery = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
meRouter.get('/attendance', async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const { limit, offset } = historyQuery.parse(req.query);
        const rows = await query(`SELECT a.id, a.status, a.reason, a.recorded_at,
              e.id AS event_id, e.title, e.date, e.type, e.subtype,
              e.matrix_item_key,
              (e.matrix_item_key IS NOT NULL) AS counts_for_matrix
       FROM attendance a
       JOIN events e ON e.id = a.event_id
       WHERE a.member_id = $1
       ORDER BY e.date DESC, e.title
       LIMIT $2 OFFSET $3`, [memberId, limit, offset]);
        const total = await queryOne<{
            n: string;
        }>(`SELECT count(*)::text AS n FROM attendance WHERE member_id = $1`, [memberId]);
        res.json({ records: rows.rows, total: Number(total?.n ?? 0), limit, offset });
    }
    catch (err) {
        next(err);
    }
});
meRouter.get('/contributions', async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const { limit, offset } = historyQuery.parse(req.query);
        const rows = await query(`SELECT c.id, c.category, c.amount, c.date, c.contribution_month,
              c.affiliation_year, c.note, c.recorded_at,
              e.title AS event_title, e.date AS event_date
       FROM contributions c
       LEFT JOIN events e ON e.id = c.event_id
       WHERE c.member_id = $1
       ORDER BY c.date DESC, c.recorded_at DESC
       LIMIT $2 OFFSET $3`, [memberId, limit, offset]);
        const summary = await query(`SELECT category, sum(amount)::text AS total, count(*)::text AS n
       FROM contributions WHERE member_id = $1
       GROUP BY category ORDER BY category`, [memberId]);
        const total = await queryOne<{
            n: string;
        }>(`SELECT count(*)::text AS n FROM contributions WHERE member_id = $1`, [memberId]);
        res.json({
            records: rows.rows,
            by_category: summary.rows,
            total: Number(total?.n ?? 0),
            limit,
            offset,
        });
    }
    catch (err) {
        next(err);
    }
});
meRouter.get('/matrix', async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const result = await evaluateMatrixForMember(memberId);
        if (!result)
            throw notFound('Your member record could not be found.');
        res.json({
            available: true,
            as_of: result.as_of,
            period: result.period,
            spirituality_score: result.spirituality_score,
            financial_score: result.financial_score,
            total_score: result.total_score,
            attainable_total: result.attainable_total,
            attainable_spirituality: result.attainable_spirituality,
            attainable_financial: result.attainable_financial,
            standing: result.standing,
            gate: result.gate,
            thresholds: result.thresholds,
            items: result.items,
        });
    }
    catch (err) {
        next(err);
    }
});
meRouter.get('/matrix/history', async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const rows = await query(`SELECT period, spirituality_score, financial_score, total_score,
              attainable_total, standing, generated_at, email_status, sent_at
       FROM matrix_scores WHERE member_id = $1
       ORDER BY period DESC LIMIT 24`, [memberId]);
        res.json({ snapshots: rows.rows });
    }
    catch (err) {
        next(err);
    }
});
meRouter.get('/welfare', async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const rows = await query(`SELECT c.id, c.support_type, c.amount, c.status, c.period,
              c.subject_name, c.requested_at, c.decided_at, c.paid_at,
              e.title AS event_title, ch.name AS child_name
       FROM welfare_claims c
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN children ch ON ch.id = c.child_id
       WHERE c.member_id = $1
       ORDER BY c.requested_at DESC
       LIMIT 50`, [memberId]);
        const paid = await queryOne<{
            total: string;
        }>(`SELECT COALESCE(sum(amount), 0)::text AS total FROM welfare_claims
       WHERE member_id = $1 AND status = 'paid'`, [memberId]);
        res.json({ claims: rows.rows, paid_total: paid?.total ?? '0' });
    }
    catch (err) {
        next(err);
    }
});
const passwordChangeSchema = z.object({
    current_password: z.string().min(1, 'Enter your current password').max(1024),
    new_password: z.string().min(10, 'Use a password of at least 10 characters').max(1024),
});

meRouter.post('/password', otpVerifyLimiter, async (req, res, next) => {
    try {
        const principal = principalOf(req);
        const { current_password, new_password } = passwordChangeSchema.parse(req.body);

        const user = await queryOne<{
            password_hash: string;
            email: string;
            full_name: string;
        }>(`SELECT u.password_hash, u.email, m.full_name
       FROM users u JOIN members m ON m.id = u.member_id
       WHERE u.id = $1`, [principal.userId]);
        if (!user)
            throw unauthorized();
        if (!(await verifyPassword(user.password_hash, current_password))) {
            throw unauthorized('That password is not correct.');
        }
        if (await verifyPassword(user.password_hash, new_password)) {
            throw badRequest('That is already your password. Choose a different one.');
        }

        const passwordHash = await hashPassword(new_password);
        const cookies = req.cookies as Record<string, string> | undefined;
        const keeping = cookies?.['cma_refresh'] ? hashToken(cookies['cma_refresh']) : null;

        await withTransaction(async (client) => {
            await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [principal.userId, passwordHash], client);
            // Other devices are signed out. The one making the change keeps its
            // session, so the member is not thrown back to the sign-in page.
            await query(`UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
           AND ($2::text IS NULL OR token_hash <> $2)`, [principal.userId, keeping], client);
            await writeAudit(client, {
                entityType: 'user', entityId: principal.userId, action: 'update',
                fieldChanged: 'password_hash', oldValue: null, newValue: 'changed by member',
            }, { userId: principal.userId, requestId: 'password-change', ip: req.ip ?? null });
        });

        await sendEmail({
            to: user.email,
            toName: user.full_name,
            ...noticeEmail({
                subject: 'CMA Changamwe - your password was changed',
                heading: 'Your password was changed',
                paragraphs: [
                    'The password on your CMA Changamwe account has just been changed, and any other device that was signed in has been signed out.',
                    'If this was not you, use the forgot-password link on the sign-in page to take the account back, then tell the Coordinator.',
                ],
            }),
        });

        res.json({ status: 'changed' });
    }
    catch (err) {
        next(err);
    }
});

const emailChangeSchema = z.object({
    new_email: z.string().trim().toLowerCase().email('Enter a valid email address').max(320),
    current_password: z.string().min(1, 'Enter your current password').max(1024),
});
meRouter.post('/email/change-request', otpSendLimiter, async (req, res, next) => {
    try {
        const principal = principalOf(req);
        const { new_email, current_password } = emailChangeSchema.parse(req.body);
        const user = await queryOne<{
            password_hash: string;
            email: string;
        }>(`SELECT password_hash, email FROM users WHERE id = $1`, [principal.userId]);
        if (!user)
            throw unauthorized();
        if (!(await verifyPassword(user.password_hash, current_password))) {
            throw unauthorized('That password is not correct.');
        }
        if (new_email === user.email.toLowerCase()) {
            throw badRequest('That is already your email address.');
        }
        const taken = await queryOne<{
            id: string;
        }>(`SELECT id FROM users WHERE lower(email) = $1 AND id <> $2`, [new_email, principal.userId]);
        if (!taken) {
            const code = await withTransaction((client) => issueEmailChangeOtp(client, principal.userId, new_email));
            await sendEmail({
                to: new_email,
                ...otpEmail({
                    subject: 'CMA Changamwe - confirm your new email address',
                    heading: 'Confirm your new email address',
                    intro: 'Enter this code in the portal to move your account to this address.',
                    code,
                    ttlMinutes: OTP_TTL_MINUTES,
                }),
            });
            await sendEmail({
                to: user.email,
                ...noticeEmail({
                    subject: 'CMA Changamwe - a change to your email address was requested',
                    heading: 'Someone asked to change your email address',
                    paragraphs: [
                        `A request was made to move your CMA Changamwe account to ${new_email}. Nothing has changed yet.`,
                        'If this was not you, use the forgot-password link on the sign-in page to take the account back, then tell the Coordinator.',
                    ],
                }),
            });
        }
        res.status(202).json({
            status: 'otp_sent',
            message: 'If that address can be used, a confirmation code has been sent to it.',
        });
    }
    catch (err) {
        next(err);
    }
});
const confirmSchema = z.object({
    code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
meRouter.post('/email/confirm', otpVerifyLimiter, async (req, res, next) => {
    try {
        const principal = principalOf(req);
        const { code } = confirmSchema.parse(req.body);
        const outcome = await withTransaction(async (client) => {
            const result = await verifyOtp(client, { userId: principal.userId }, 'email_change', code);
            if (!result.ok || !result.newEmail)
                return result;
            const before = await queryOne<{
                email: string;
            }>(`SELECT email FROM users WHERE id = $1 FOR UPDATE`, [principal.userId], client);
            // Checked again at the point of writing. The address was free when
            // the code was sent, and somebody else may have taken it since.
            const taken = await queryOne<{
                id: string;
            }>(`SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2`, [result.newEmail, principal.userId], client);
            if (taken)
                throw conflict('That email address has since been taken. Start the change again with a different one.');
            await query(`UPDATE users SET email = $2, email_verified = true WHERE id = $1`, [principal.userId, result.newEmail], client);
            await writeAudit(client, {
                entityType: 'user', entityId: principal.userId, action: 'update',
                fieldChanged: 'email', oldValue: before?.email ?? null, newValue: result.newEmail,
            }, { userId: principal.userId, requestId: 'email-change', ip: req.ip ?? null });
            return result;
        });
        if (!outcome.ok) {
            if (outcome.failure === 'locked_out') {
                throw tooManyRequests('Too many incorrect codes. Start the change again.');
            }
            if (outcome.failure === 'expired' || outcome.failure === 'not_found') {
                throw badRequest('That code has expired. Start the change again.');
            }
            if (outcome.failure === 'consumed')
                throw badRequest('That code has already been used.');
            throw badRequest('Incorrect code.');
        }
        res.json({ status: 'changed', email: outcome.newEmail });
    }
    catch (err) {
        next(err);
    }
});
