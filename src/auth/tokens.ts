import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
const secretKey = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'cma-changamwe';
const AUDIENCE = 'cma-portal';
export interface AccessClaims {
    sub: string;
    mid: string;
}
export async function signAccessToken(claims: AccessClaims): Promise<string> {
    return new SignJWT({ mid: claims.mid })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(claims.sub)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(env.ACCESS_TOKEN_TTL)
        .sign(secretKey);
}
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, secretKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.mid !== 'string') {
        throw new Error('malformed access token claims');
    }
    return { sub: payload.sub, mid: payload.mid };
}
const LOGIN_CHALLENGE_AUDIENCE = 'cma-login-challenge';

export async function signLoginChallenge(userId: string): Promise<string> {
    return new SignJWT({ typ: 'login_challenge' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(LOGIN_CHALLENGE_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(secretKey);
}

export async function verifyLoginChallenge(token: string): Promise<string> {
    const { payload } = await jwtVerify(token, secretKey, {
        issuer: ISSUER,
        audience: LOGIN_CHALLENGE_AUDIENCE,
        algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || payload.typ !== 'login_challenge') {
        throw new Error('malformed login challenge');
    }
    return payload.sub;
}

export function generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
}
export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
export interface RefreshRow {
    id: string;
    user_id: string;
    family_id: string;
    expires_at: Date;
    revoked_at: Date | null;
}
export async function issueRefreshToken(client: PoolClient, userId: string, opts: {
    familyId?: string;
    userAgent?: string | null;
} = {}): Promise<{
    token: string;
    id: string;
    familyId: string;
}> {
    const token = generateRefreshToken();
    const row = await queryOne<{
        id: string;
        family_id: string;
    }>(`INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
     VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3,
             now() + ($4 || ' days')::interval, $5)
     RETURNING id, family_id`, [userId, opts.familyId ?? null, hashToken(token), String(env.REFRESH_TOKEN_TTL_DAYS), opts.userAgent ?? null], client);
    if (!row)
        throw new Error('failed to issue refresh token');
    return { token, id: row.id, familyId: row.family_id };
}
export async function revokeFamily(client: PoolClient, familyId: string): Promise<void> {
    await query(`UPDATE refresh_tokens SET revoked_at = now()
     WHERE family_id = $1 AND revoked_at IS NULL`, [familyId], client);
}
