import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, queryOne } from '../db/pool.js';
import { hashToken } from './tokens.js';

export const RESET_TTL_MINUTES = 60;

export interface ResetSubject {
  resetId: string;
  userId: string;
}

export type ResetFailure = 'not_found' | 'expired' | 'consumed';

/**
 * Issues a single-use reset token. Any token already outstanding for the user
 * is consumed first, so asking twice invalidates the earlier message.
 */
export async function issueResetToken(client: PoolClient, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query(
    `UPDATE password_resets SET consumed_at = now()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
    client,
  );
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, hashToken(token), String(RESET_TTL_MINUTES)],
    client,
  );
  return token;
}

/**
 * Claims a reset token inside the caller's transaction. The row is locked and
 * marked consumed here, so two requests presenting the same token cannot both
 * go on to set a password.
 */
export async function claimResetToken(
  client: PoolClient,
  token: string,
): Promise<{ ok: true; subject: ResetSubject } | { ok: false; failure: ResetFailure }> {
  const row = await queryOne<{
    id: string;
    user_id: string;
    consumed_at: Date | null;
    expired: boolean;
  }>(
    `SELECT id, user_id, consumed_at, (expires_at <= now()) AS expired
       FROM password_resets
      WHERE token_hash = $1
      FOR UPDATE`,
    [hashToken(token)],
    client,
  );

  if (!row) return { ok: false, failure: 'not_found' };
  if (row.consumed_at) return { ok: false, failure: 'consumed' };
  if (row.expired) return { ok: false, failure: 'expired' };

  await query(`UPDATE password_resets SET consumed_at = now() WHERE id = $1`, [row.id], client);
  return { ok: true, subject: { resetId: row.id, userId: row.user_id } };
}
