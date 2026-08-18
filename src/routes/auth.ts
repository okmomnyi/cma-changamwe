import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { queryOne, withTransaction } from '../db/pool.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { hashToken, issueRefreshToken, revokeFamily, signAccessToken, } from '../auth/tokens.js';
import { loadPrincipal } from '../auth/authz.js';
import { requireAuth, principalOf } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { unauthorized } from '../util/errors.js';
import { logger } from '../util/logger.js';
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
authRouter.post('/login', loginLimiter, async (req, res, next) => {
    try {
        const { identifier, password } = loginSchema.parse(req.body);
        const user = await queryOne<{
            id: string;
            member_id: string;
            password_hash: string;
            email_verified: boolean;
        }>(`SELECT u.id, u.member_id, u.password_hash, u.email_verified
       FROM users u
       WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1)`, [identifier]);
        const ok = user
            ? await verifyPassword(user.password_hash, password)
            : (await verifyPassword(await getDecoyHash(), password), false);
        if (!ok || !user)
            throw unauthorized('Incorrect username or password');
        const { accessToken, refreshToken } = await withTransaction(async (client) => {
            const refresh = await issueRefreshToken(client, user.id, {
                userAgent: req.get('user-agent') ?? null,
            });
            const access = await signAccessToken({ sub: user.id, mid: user.member_id });
            return { accessToken: access, refreshToken: refresh.token };
        });
        const principal = await loadPrincipal(user.id);
        res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
        res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: env.ACCESS_TOKEN_TTL,
            user: principal && publicPrincipal(principal),
        });
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
