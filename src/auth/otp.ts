import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export function generateOtp(): string {
    return String(randomInt(0, 1000000)).padStart(6, '0');
}
export function hashOtp(code: string): string {
    return createHmac('sha256', env.JWT_SECRET).update(code).digest('hex');
}
function constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length)
        return false;
    return timingSafeEqual(bufA, bufB);
}
export type OtpFailure = 'not_found' | 'expired' | 'consumed' | 'locked_out' | 'mismatch';
export interface OtpVerification {
    ok: boolean;
    failure?: OtpFailure;
    newEmail?: string | null;
    attemptsRemaining?: number;
}
export async function issueSignupOtp(client: PoolClient, draftId: string): Promise<string> {
    const code = generateOtp();
    await query(`UPDATE email_verifications SET consumed_at = now()
     WHERE draft_id = $1 AND purpose = 'signup' AND consumed_at IS NULL`, [draftId], client);
    await query(`INSERT INTO email_verifications (draft_id, purpose, code_hash, expires_at)
     VALUES ($1, 'signup', $2, now() + ($3 || ' minutes')::interval)`, [draftId, hashOtp(code), String(OTP_TTL_MINUTES)], client);
    return code;
}
export async function issueEmailChangeOtp(client: PoolClient, userId: string, newEmail: string): Promise<string> {
    const code = generateOtp();
    await query(`UPDATE email_verifications SET consumed_at = now()
     WHERE user_id = $1 AND purpose = 'email_change' AND consumed_at IS NULL`, [userId], client);
    await query(`INSERT INTO email_verifications (user_id, purpose, code_hash, new_email, expires_at)
     VALUES ($1, 'email_change', $2, $3, now() + ($4 || ' minutes')::interval)`, [userId, hashOtp(code), newEmail, String(OTP_TTL_MINUTES)], client);
    return code;
}
export async function verifyOtp(client: PoolClient, subject: {
    draftId?: string;
    userId?: string;
}, purpose: 'signup' | 'email_change', code: string): Promise<OtpVerification> {
    const row = await queryOne<{
        id: string;
        code_hash: string;
        new_email: string | null;
        attempts: number;
        expired: boolean;
        consumed_at: Date | null;
    }>(`SELECT id, code_hash, new_email, attempts, consumed_at,
            (expires_at <= now()) AS expired
     FROM email_verifications
     WHERE purpose = $1
       AND ($2::uuid IS NULL OR draft_id = $2)
       AND ($3::uuid IS NULL OR user_id  = $3)
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`, [purpose, subject.draftId ?? null, subject.userId ?? null], client);
    if (!row)
        return { ok: false, failure: 'not_found' };
    if (row.consumed_at)
        return { ok: false, failure: 'consumed' };
    if (row.expired)
        return { ok: false, failure: 'expired' };
    if (row.attempts >= OTP_MAX_ATTEMPTS)
        return { ok: false, failure: 'locked_out' };
    if (!constantTimeEqual(row.code_hash, hashOtp(code))) {
        const updated = await queryOne<{
            attempts: number;
        }>(`UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`, [row.id], client);
        const attempts = updated?.attempts ?? row.attempts + 1;
        return {
            ok: false,
            failure: attempts >= OTP_MAX_ATTEMPTS ? 'locked_out' : 'mismatch',
            attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - attempts),
        };
    }
    await query(`UPDATE email_verifications SET consumed_at = now() WHERE id = $1`, [row.id], client);
    return { ok: true, newEmail: row.new_email };
}
