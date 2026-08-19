import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { hashToken } from '../auth/tokens.js';
import { hashPassword } from '../auth/password.js';
import { issueSignupOtp, verifyOtp, OTP_TTL_MINUTES } from '../auth/otp.js';
import { sendEmail } from '../email/mailer.js';
import { otpEmail, noticeEmail } from '../email/templates.js';
import { writeAudit } from '../audit/audit.js';
import { otpSendLimiter, otpVerifyLimiter, loginLimiter } from '../middleware/rateLimit.js';
import { badRequest, conflict, notFound, tooManyRequests, unauthorized } from '../util/errors.js';
import { completeDraftSchema, draftDataSchema, missingMandatory, STEPS } from '../signup/schema.js';
import { isProduction } from '../config/env.js';
import { logger } from '../util/logger.js';
export const signupRouter = Router();
const DRAFT_TTL_DAYS = 30;
function draftTokenFrom(req: {
    get(name: string): string | undefined;
}): string | null {
    const header = req.get('x-draft-token');
    return header && header.trim() ? header.trim() : null;
}
async function loadDraft(token: string) {
    return queryOne<{
        id: string;
        email: string;
        data_json: Record<string, unknown>;
        current_step: number;
        email_verified: boolean;
        promoted_at: Date | null;
        expired: boolean;
    }>(`SELECT id, email, data_json, current_step, email_verified, promoted_at,
            (expires_at <= now()) AS expired
     FROM signup_drafts WHERE draft_token_hash = $1`, [hashToken(token)]);
}
const startSchema = z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(320),
});
signupRouter.post('/start', otpSendLimiter, async (req, res, next) => {
    try {
        const { email } = startSchema.parse(req.body);
        const existingUser = await queryOne<{
            id: string;
        }>(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
        if (existingUser) {
            await sendEmail({
                to: email,
                ...noticeEmail({
                    subject: 'CMA Changamwe - account already registered',
                    heading: 'This email already has an account',
                    paragraphs: [
                        'Someone started a registration with this address, but it already belongs to a CMA Changamwe account.',
                        'If that was you, please sign in instead. If you have forgotten your password, use the "forgot password" option on the sign-in page.',
                    ],
                }),
            });
            res.status(202).json({ status: 'otp_sent', message: 'Check your email for a 6-digit code.' });
            return;
        }
        const token = randomBytes(32).toString('base64url');
        const result = await withTransaction(async (client) => {
            await query(`UPDATE signup_drafts SET expires_at = now()
         WHERE lower(email) = $1 AND promoted_at IS NULL AND expires_at > now()`, [email], client);
            const draft = await queryOne<{
                id: string;
            }>(`INSERT INTO signup_drafts (email, draft_token_hash, data_json, current_step, expires_at)
         VALUES ($1, $2, '{}'::jsonb, 1, now() + ($3 || ' days')::interval)
         RETURNING id`, [email, hashToken(token), String(DRAFT_TTL_DAYS)], client);
            const code = await issueSignupOtp(client, draft!.id);
            return { draftId: draft!.id, code };
        });
        await sendEmail({
            to: email,
            subject: 'CMA Changamwe - your verification code',
            text: `Your CMA Changamwe verification code is ${result.code}.\n\nIt expires in ${OTP_TTL_MINUTES} minutes. If you did not start a registration, ignore this message.`,
        });
        res.status(202).json({
            status: 'otp_sent',
            draft_token: token,
            expires_in_days: DRAFT_TTL_DAYS,
            message: 'Check your email for a 6-digit code.',
        });
    }
    catch (err) {
        next(err);
    }
});
const verifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
signupRouter.post('/verify-email', otpVerifyLimiter, async (req, res, next) => {
    try {
        const token = draftTokenFrom(req);
        if (!token)
            throw unauthorized('Start a registration first.');
        const { code } = verifySchema.parse(req.body);
        const draft = await loadDraft(token);
        if (!draft || draft.expired)
            throw notFound('That registration has expired. Start again.');
        if (draft.promoted_at)
            throw conflict('That registration is already complete. Please sign in.');
        const outcome = await withTransaction(async (client) => {
            const result = await verifyOtp(client, { draftId: draft.id }, 'signup', code);
            if (result.ok) {
                await query(`UPDATE signup_drafts SET email_verified = true, updated_at = now() WHERE id = $1`, [draft.id], client);
            }
            return result;
        });
        if (!outcome.ok) {
            if (outcome.failure === 'locked_out') {
                throw tooManyRequests('Too many incorrect codes. Request a new one.');
            }
            if (outcome.failure === 'expired' || outcome.failure === 'not_found') {
                throw badRequest('That code has expired. Request a new one.');
            }
            if (outcome.failure === 'consumed')
                throw badRequest('That code has already been used.');
            throw badRequest(outcome.attemptsRemaining
                ? `Incorrect code. ${outcome.attemptsRemaining} attempts remaining.`
                : 'Incorrect code.');
        }
        res.json({ status: 'verified', email_verified: true });
    }
    catch (err) {
        next(err);
    }
});
signupRouter.post('/resend-code', otpSendLimiter, async (req, res, next) => {
    try {
        const token = draftTokenFrom(req);
        if (!token)
            throw unauthorized('Start a registration first.');
        const draft = await loadDraft(token);
        if (!draft || draft.expired)
            throw notFound('That registration has expired. Start again.');
        if (draft.promoted_at)
            throw conflict('That registration is already complete.');
        const code = await withTransaction((client) => issueSignupOtp(client, draft.id));
        await sendEmail({
            to: draft.email,
            subject: 'CMA Changamwe - your verification code',
            text: `Your CMA Changamwe verification code is ${code}.\n\nIt expires in ${OTP_TTL_MINUTES} minutes.`,
        });
        res.status(202).json({ status: 'otp_sent' });
    }
    catch (err) {
        next(err);
    }
});
signupRouter.get('/draft', async (req, res, next) => {
    try {
        const token = draftTokenFrom(req);
        if (!token)
            throw unauthorized('No registration in progress.');
        const draft = await loadDraft(token);
        if (!draft || draft.expired)
            throw notFound('That registration has expired. Start again.');
        if (draft.promoted_at)
            throw conflict('That registration is already complete. Please sign in.');
        const data = draftDataSchema.parse(draft.data_json ?? {});
        res.json({
            email: draft.email,
            email_verified: draft.email_verified,
            current_step: draft.current_step,
            step_key: STEPS[draft.current_step - 1] ?? STEPS[0],
            data,
            missing_mandatory: missingMandatory(data),
        });
    }
    catch (err) {
        next(err);
    }
});
const saveSchema = z.object({
    current_step: z.coerce.number().int().min(1).max(STEPS.length),
    data: z.record(z.unknown()),
});
signupRouter.patch('/draft', async (req, res, next) => {
    try {
        const token = draftTokenFrom(req);
        if (!token)
            throw unauthorized('No registration in progress.');
        const { current_step, data } = saveSchema.parse(req.body);
        const draft = await loadDraft(token);
        if (!draft || draft.expired)
            throw notFound('That registration has expired. Start again.');
        if (draft.promoted_at)
            throw conflict('That registration is already complete.');
        const merged = draftDataSchema.parse({ ...(draft.data_json ?? {}), ...data });
        await query(`UPDATE signup_drafts
       SET data_json = $2::jsonb, current_step = GREATEST(current_step, $3), updated_at = now()
       WHERE id = $1`, [draft.id, JSON.stringify(merged), current_step]);
        res.json({ status: 'saved', data: merged, missing_mandatory: missingMandatory(merged) });
    }
    catch (err) {
        next(err);
    }
});
const completeSchema = z.object({
    username: z
        .string().trim().min(3, 'Choose a username of at least 3 characters').max(40)
        .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores'),
    password: z.string().min(10, 'Use a password of at least 10 characters').max(1024),
    declaration_accepted: z.literal(true, {
        errorMap: () => ({ message: 'You must accept the declaration to finish' }),
    }),
});
signupRouter.post('/complete', loginLimiter, async (req, res, next) => {
    try {
        const token = draftTokenFrom(req);
        if (!token)
            throw unauthorized('No registration in progress.');
        const { username, password } = completeSchema.parse(req.body);
        const draft = await loadDraft(token);
        if (!draft || draft.expired)
            throw notFound('That registration has expired. Start again.');
        if (draft.promoted_at)
            throw conflict('That registration is already complete. Please sign in.');
        if (!draft.email_verified)
            throw badRequest('Verify your email address before finishing.');
        const parsed = completeDraftSchema.safeParse(draft.data_json ?? {});
        if (!parsed.success) {
            throw badRequest('Some required details are still missing.', {
                missing: [...new Set(parsed.error.issues.map((i) => i.path.join('.')))],
            });
        }
        const form = parsed.data;
        const passwordHash = await hashPassword(password);
        const created = await withTransaction(async (client) => {
            const stillPending = await queryOne<{
                id: string;
            }>(`SELECT id FROM signup_drafts WHERE id = $1 AND promoted_at IS NULL FOR UPDATE`, [draft.id], client);
            if (!stillPending)
                throw conflict('That registration is already complete. Please sign in.');
            const member = await queryOne<{
                id: string;
            }>(`INSERT INTO members
           (full_name, year_of_birth, id_or_passport_no, mobile_no, home_parish_diocese,
            jumuiya, prayer_house_id, marital_status, spouse_name, spouse_status,
            father_status, mother_status, next_of_kin_name, next_of_kin_id_no,
            next_of_kin_mobile, profile_locked, declaration_accepted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::marital_status,$9,$10::life_status,
                 $11::life_status,$12::life_status,$13,$14,$15,true, now())
         RETURNING id`, [
                form.full_name, form.year_of_birth, form.id_or_passport_no, form.mobile_no,
                form.home_parish_diocese ?? null, form.jumuiya ?? null, form.prayer_house_id,
                form.marital_status, form.spouse_name ?? null, form.spouse_status ?? null,
                form.father_status ?? null, form.mother_status ?? null,
                form.next_of_kin_name, form.next_of_kin_id_no ?? null, form.next_of_kin_mobile,
            ], client);
            for (const child of form.children ?? []) {
                await query(`INSERT INTO children (member_id, name, date_of_birth) VALUES ($1, $2, $3::date)`, [member!.id, child.name, child.date_of_birth ?? null], client);
            }
            const user = await queryOne<{
                id: string;
            }>(`INSERT INTO users (member_id, username, password_hash, email, email_verified)
         VALUES ($1, $2, $3, $4, true) RETURNING id`, [member!.id, username, passwordHash, draft.email], client);
            await query(`INSERT INTO member_photos
           (member_id, object_key, content_type, byte_size, width, height)
         SELECT $1, p.object_key, p.content_type, p.byte_size, p.width, p.height
         FROM signup_draft_photos p WHERE p.draft_id = $2`, [member!.id, draft.id], client);
            await query(`DELETE FROM signup_draft_photos WHERE draft_id = $1`, [draft.id], client);
            await query(`UPDATE signup_drafts SET promoted_at = now(), updated_at = now() WHERE id = $1`, [draft.id], client);
            const actor = { userId: user!.id, requestId: 'signup', ip: req.ip ?? null };
            await writeAudit(client, {
                entityType: 'member', entityId: member!.id, action: 'create',
                newValue: { full_name: form.full_name, prayer_house_id: form.prayer_house_id, source: 'signup' },
            }, actor);
            await writeAudit(client, {
                entityType: 'user', entityId: user!.id, action: 'create',
                newValue: { username, email: draft.email, source: 'signup' },
            }, actor);
            return { memberId: member!.id, userId: user!.id };
        });
        await sendEmail({
            to: draft.email,
            toName: form.full_name,
            subject: 'CMA Changamwe - your registration is complete',
            text: `Karibu ${form.full_name},\n\nYour CMA Changamwe registration is complete and your profile is now locked. Sign in with the username "${username}".\n\nTo correct any detail, speak to the Coordinator or Treasurer. Your email address is the only field you can change yourself.`,
        });
        logger.info({ memberId: created.memberId }, 'signup completed');
        res.status(201).json({
            status: 'complete',
            member_id: created.memberId,
            username,
            message: 'Your profile is locked. You can now sign in.',
        });
    }
    catch (err) {
        next(err);
    }
});
signupRouter.get('/prayer-houses', async (_req, res, next) => {
    try {
        const rows = await query(`SELECT id, name FROM prayer_houses ORDER BY name`);
        res.json({ prayer_houses: rows.rows });
    }
    catch (err) {
        next(err);
    }
});
