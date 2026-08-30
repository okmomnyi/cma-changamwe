import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { hashToken, issueRefreshToken, revokeFamily, signAccessToken, signLoginChallenge, verifyLoginChallenge, } from '../auth/tokens.js';
import { claimResetToken, issueResetToken, RESET_TTL_MINUTES } from '../auth/passwordReset.js';
import { loadPrincipal } from '../auth/authz.js';
import { writeAudit } from '../audit/audit.js';
import { requireAuth, principalOf } from '../middleware/auth.js';
import { loginLimiter, otpVerifyLimiter, passwordResetLimiter } from '../middleware/rateLimit.js';
import { badRequest, tooManyRequests, unauthorized } from '../util/errors.js';
import { logger } from '../util/logger.js';
import { issueLoginOtp, verifyOtp, OTP_TTL_MINUTES } from '../auth/otp.js';
import { sendEmail } from '../email/mailer.js';
import { actionEmail, noticeEmail, otpEmail } from '../email/templates.js';
export const authRouter = Router();
const REFRESH_COOKIE = 'cma_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';
function refreshCookieOptions() {
    return {
        httpOnly: true,
        secure: env.SECURE_COOKIES,
        sameSite: 'strict' as const,
        path: REFRESH_COOKIE_PATH,
        maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
        ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
    };
}
const loginSchema = z.object({
    identifier: z.string().min(1, 'Enter your username or email address').max(320),
    password: z.string().min(1, 'Enter your password').max(1024),
});
let decoyHash: string | null = null;
async function getDecoyHash(): Promise<string> {
    decoyHash ??= await hashPassword('login-timing-decoy-not-a-real-password');
    return decoyHash;
}
async function issueSession(req: import('express').Request, res: import('express').Response, userId: string, memberId: string): Promise<void> {
    const { accessToken, refreshToken } = await withTransaction(async (client) => {
        const refresh = await issueRefreshToken(client, userId, {
            userAgent: req.get('user-agent') ?? null,
        });
        const access = await signAccessToken({ sub: userId, mid: memberId });
        return { accessToken: access, refreshToken: refresh.token };
    });
    const principal = await loadPrincipal(userId);
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: env.ACCESS_TOKEN_TTL,
        user: principal && publicPrincipal(principal),
    });
}

authRouter.post('/login', loginLimiter, async (req, res, next) => {
    try {
        const { identifier, password } = loginSchema.parse(req.body);
        const user = await queryOne<{
            id: string;
            member_id: string;
            password_hash: string;
            email: string;
            full_name: string;
            is_demo: boolean;
        }>(`SELECT u.id, u.member_id, u.password_hash, u.email, m.full_name,
                   (m.id_or_passport_no LIKE 'DEMO-%') AS is_demo
       FROM users u
       JOIN members m ON m.id = u.member_id
       WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1)`, [identifier]);
        const ok = user
            ? await verifyPassword(user.password_hash, password)
            : (await verifyPassword(await getDecoyHash(), password), false);
        if (!ok || !user)
            throw unauthorized('Incorrect username or password');

        // Demo accounts skip the email step so reviewers can sign in directly.
        // The deployment decides whether that is allowed at all; the ID number
        // is administrator-editable, so it must not be the only control.
        if (user.is_demo && env.ALLOW_DEMO_LOGIN) {
            await issueSession(req, res, user.id, user.member_id);
            return;
        }

        // Everyone else gets a one-time code by email before a session is issued.
        const code = await withTransaction((client) => issueLoginOtp(client, user.id));
        await sendEmail({
            to: user.email,
            toName: user.full_name,
            ...otpEmail({
                subject: 'CMA Changamwe - your sign-in code',
                heading: 'Your sign-in code',
                intro: 'Use this code to finish signing in to CMA Changamwe.',
                code,
                ttlMinutes: OTP_TTL_MINUTES,
                footer: 'If you did not just try to sign in, someone may have your password. Change it and tell the Coordinator.',
            }),
        });
        const challenge = await signLoginChallenge(user.id);
        res.json({
            status: 'otp_required',
            challenge_token: challenge,
            email_hint: maskEmail(user.email),
            expires_in_minutes: OTP_TTL_MINUTES,
        });
    }
    catch (err) {
        next(err);
    }
});
function maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!domain || !name)
        return 'your email';
    const shown = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
    return `${shown}${'*'.repeat(Math.max(1, name.length - shown.length))}@${domain}`;
}

const verifyLoginSchema = z.object({
    challenge_token: z.string().min(10),
    code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

authRouter.post('/login/verify', otpVerifyLimiter, async (req, res, next) => {
    try {
        const { challenge_token, code } = verifyLoginSchema.parse(req.body);
        let userId: string;
        try {
            userId = await verifyLoginChallenge(challenge_token);
        }
        catch {
            throw unauthorized('That sign-in attempt has expired. Please sign in again.');
        }
        const user = await queryOne<{ id: string; member_id: string }>(
            `SELECT id, member_id FROM users WHERE id = $1`, [userId]);
        if (!user)
            throw unauthorized('That sign-in attempt is no longer valid.');

        const outcome = await withTransaction((client) => verifyOtp(client, { userId }, 'login', code));
        if (!outcome.ok) {
            if (outcome.failure === 'locked_out')
                throw tooManyRequests('Too many incorrect codes. Please sign in again.');
            if (outcome.failure === 'expired' || outcome.failure === 'not_found')
                throw badRequest('That code has expired. Please sign in again.');
            if (outcome.failure === 'consumed')
                throw badRequest('That code has already been used.');
            throw badRequest(outcome.attemptsRemaining
                ? `Incorrect code. ${outcome.attemptsRemaining} attempts remaining.`
                : 'Incorrect code.');
        }
        await issueSession(req, res, user.id, user.member_id);
    }
    catch (err) {
        next(err);
    }
});

const resetRequestSchema = z.object({
    identifier: z.string().trim().min(1, 'Enter your username or email address').max(320),
});

authRouter.post('/password-reset/request', passwordResetLimiter, async (req, res, next) => {
    try {
        const { identifier } = resetRequestSchema.parse(req.body);
        const user = await queryOne<{
            id: string;
            email: string;
            full_name: string;
            username: string;
        }>(`SELECT u.id, u.email, u.username, m.full_name
       FROM users u
       JOIN members m ON m.id = u.member_id
       WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1)`, [identifier]);

        // The reply never varies. Whether or not the account exists, the caller
        // is told the same thing, so this cannot be used to test addresses.
        if (user) {
            const token = await withTransaction((client) => issueResetToken(client, user.id));
            const url = `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
            await sendEmail({
                to: user.email,
                toName: user.full_name,
                ...actionEmail({
                    subject: 'CMA Changamwe - reset your password',
                    heading: 'Reset your password',
                    intro: `Someone asked to reset the password for the account "${user.username}". Use the button below to choose a new one.`,
                    actionLabel: 'Choose a new password',
                    url,
                    ttlMinutes: RESET_TTL_MINUTES,
                    footer: 'If you did not ask for this, ignore this message. Your password has not changed, and nobody can use this link without your email.',
                }),
            });
            logger.info({ userId: user.id }, 'password reset requested');
        }

        res.status(202).json({
            status: 'sent',
            message: 'If that username or email belongs to an account, a reset link is on its way.',
        });
    }
    catch (err) {
        next(err);
    }
});

const resetConfirmSchema = z.object({
    token: z.string().trim().min(20, 'That reset link is not valid').max(200),
    password: z.string().min(10, 'Use a password of at least 10 characters').max(1024),
});

authRouter.post('/password-reset/confirm', otpVerifyLimiter, async (req, res, next) => {
    try {
        const { token, password } = resetConfirmSchema.parse(req.body);
        const passwordHash = await hashPassword(password);

        const outcome = await withTransaction(async (client) => {
            const claimed = await claimResetToken(client, token);
            if (!claimed.ok)
                return claimed;

            const before = await queryOne<{
                email: string;
                full_name: string;
            }>(`SELECT u.email, m.full_name
           FROM users u JOIN members m ON m.id = u.member_id
           WHERE u.id = $1 FOR UPDATE OF u`, [claimed.subject.userId], client);
            if (!before)
                return { ok: false as const, failure: 'not_found' as const };

            await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [claimed.subject.userId, passwordHash], client);

            // Every existing session goes. A reset is how someone recovers an
            // account they may have lost control of, so nothing may survive it.
            await query(`UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`, [claimed.subject.userId], client);

            await writeAudit(client, {
                entityType: 'user', entityId: claimed.subject.userId, action: 'update',
                fieldChanged: 'password_hash', oldValue: null, newValue: 'reset by email link',
            }, { userId: claimed.subject.userId, requestId: 'password-reset', ip: req.ip ?? null });

            return { ok: true as const, email: before.email, fullName: before.full_name };
        });

        if (!outcome.ok) {
            if (outcome.failure === 'consumed')
                throw badRequest('That reset link has already been used. Ask for a new one.');
            throw badRequest('That reset link has expired or is not valid. Ask for a new one.');
        }

        await sendEmail({
            to: outcome.email,
            toName: outcome.fullName,
            ...noticeEmail({
                subject: 'CMA Changamwe - your password was changed',
                heading: 'Your password was changed',
                paragraphs: [
                    'The password on your CMA Changamwe account has just been reset, and every device that was signed in has been signed out.',
                    'If this was not you, tell the Coordinator straight away.',
                ],
            }),
        });

        res.json({ status: 'reset', message: 'Your password has been changed. You can now sign in.' });
    }
    catch (err) {
        next(err);
    }
});

authRouter.post('/refresh', async (req, res, next) => {
    try {
        const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
        if (!presented)
            throw unauthorized('No session to refresh');
        const result = await withTransaction(async (client) => {
            const row = await queryOne<{
                id: string;
                user_id: string;
                member_id: string;
                family_id: string;
                expired: boolean;
                revoked_at: Date | null;
            }>(`SELECT rt.id, rt.user_id, rt.family_id, rt.revoked_at,
                (rt.expires_at <= now()) AS expired, u.member_id
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = $1
         FOR UPDATE OF rt`, [hashToken(presented)], client);
            if (!row)
                return null;
            if (row.revoked_at !== null) {
                await revokeFamily(client, row.family_id);
                logger.warn({ familyId: row.family_id }, 'refresh token reuse detected; family revoked');
                return null;
            }
            if (row.expired)
                return null;
            const next = await issueRefreshToken(client, row.user_id, {
                familyId: row.family_id,
                userAgent: req.get('user-agent') ?? null,
            });
            await client.query(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [row.id, next.id]);
            const access = await signAccessToken({ sub: row.user_id, mid: row.member_id });
            return { accessToken: access, refreshToken: next.token };
        });
        if (!result) {
            res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
            throw unauthorized('Your session has expired. Please sign in again.');
        }
        res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
        res.json({
            access_token: result.accessToken,
            token_type: 'Bearer',
            expires_in: env.ACCESS_TOKEN_TTL,
        });
    }
    catch (err) {
        next(err);
    }
});
authRouter.post('/logout', async (req, res, next) => {
    try {
        const presented = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
        if (presented) {
            await withTransaction(async (client) => {
                const row = await queryOne<{
                    family_id: string;
                }>(`SELECT family_id FROM refresh_tokens WHERE token_hash = $1`, [hashToken(presented)], client);
                if (row)
                    await revokeFamily(client, row.family_id);
            });
        }
        res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
authRouter.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicPrincipal(principalOf(req)) });
});
function publicPrincipal(p: {
    userId: string;
    memberId: string;
    username: string;
    email: string;
    emailVerified: boolean;
    profileLocked: boolean;
    offices: string[];
    adminOffices: string[];
    isAdmin: boolean;
}) {
    return {
        id: p.userId,
        member_id: p.memberId,
        username: p.username,
        email: p.email,
        email_verified: p.emailVerified,
        profile_locked: p.profileLocked,
        offices: p.offices,
        admin_offices: p.adminOffices,
        is_admin: p.isAdmin,
    };
}
