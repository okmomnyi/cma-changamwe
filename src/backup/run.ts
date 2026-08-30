import { env } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
import { logger } from '../util/logger.js';
import { backupObjectKey } from './format.js';
import { buildDump } from './dump.js';
import {
    BACKUP_PREFIX, backupsConfigured, backupsUnconfiguredReason,
    deleteBackup, getBackup, listBackups, putBackup,
} from './store.js';
import { verifyBackupBytes } from './verify.js';

export interface BackupRunResult {
    status: 'verified' | 'failed' | 'skipped';
    object_key?: string;
    byte_size?: number;
    row_count?: number;
    duration_ms?: number;
    pruned?: string[];
    checks?: Array<{ name: string; ok: boolean; detail?: string }>;
    reason?: string;
}

/**
 * Takes a backup, proves it, records it, expires what is no longer needed.
 * Nothing is pruned until the new backup has been read back and verified, so a
 * run of failures accumulates old copies rather than eroding them.
 */
export async function runBackup(options: { reason?: string } = {}): Promise<BackupRunResult> {
    if (!backupsConfigured) {
        const reason = backupsUnconfiguredReason();
        logger.error({ reason }, 'backup skipped');
        return { status: 'skipped', reason };
    }

    const started = Date.now();
    const dump = await buildDump();
    const objectKey = backupObjectKey(BACKUP_PREFIX, dump.takenAt);

    // Recorded before the upload, so a run that dies mid-flight leaves a row
    // saying so rather than leaving no trace at all.
    const run = await queryOne<{ id: string }>(
        `INSERT INTO backup_runs
           (object_key, status, byte_size, row_count, table_counts, sha256,
            rows_sha256, schema_version, neon_branch, note)
         VALUES ($1, 'running', $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
         ON CONFLICT (object_key) DO UPDATE SET status = 'running', error = NULL
         RETURNING id`,
        [
            objectKey, dump.body.length, dump.rowCount, JSON.stringify(dump.counts),
            dump.sha256, dump.rowsSha256, dump.schemaVersion, dump.neonBranch,
            options.reason ?? null,
        ],
    );

    const finish = async (status: 'verified' | 'failed', extra: { error?: string; note?: string } = {}) => {
        await query(
            `UPDATE backup_runs
                SET status = $2::backup_status, finished_at = now(),
                    verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END,
                    duration_ms = $3, error = $4, note = COALESCE($5, note)
              WHERE id = $1`,
            [run!.id, status, Date.now() - started, extra.error ?? null, extra.note ?? null],
        );
    };

    try {
        await putBackup(objectKey, dump.body, {
            sha256: dump.sha256,
            rows: String(dump.rowCount),
            schema: dump.schemaVersion ?? 'unknown',
            taken_at: dump.takenAt.toISOString(),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await finish('failed', { error: `upload failed: ${message}` });
        logger.error({ err, objectKey }, 'backup upload failed');
        return { status: 'failed', object_key: objectKey, reason: message };
    }

    // Read it back rather than trusting the write. This is the whole point.
    let verified;
    try {
        const stored = await getBackup(objectKey);
        verified = verifyBackupBytes(stored, {
            sha256: dump.sha256,
            rowsSha256: dump.rowsSha256,
            rowCount: dump.rowCount,
            counts: dump.counts,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await finish('failed', { error: `could not read the backup back: ${message}` });
        logger.error({ err, objectKey }, 'backup could not be read back for verification');
        return { status: 'failed', object_key: objectKey, reason: message };
    }

    if (!verified.ok) {
        await finish('failed', { error: verified.failure ?? 'verification failed' });
        logger.error({ objectKey, failure: verified.failure, checks: verified.checks },
            'backup failed verification and will not be relied on');
        return {
            status: 'failed', object_key: objectKey,
            reason: verified.failure, checks: verified.checks,
        };
    }

    await finish('verified');
    logger.info({
        objectKey, bytes: dump.body.length, rows: dump.rowCount, ms: Date.now() - started,
    }, 'backup verified');

    const pruned = await pruneOldBackups();

    return {
        status: 'verified',
        object_key: objectKey,
        byte_size: dump.body.length,
        row_count: dump.rowCount,
        duration_ms: Date.now() - started,
        pruned,
        checks: verified.checks,
    };
}

/**
 * Age alone never justifies deletion. A backup goes only once BACKUP_MIN_KEEP
 * verified newer ones exist, so a fortnight of failures cannot destroy the only
 * copies there are.
 */
export async function pruneOldBackups(): Promise<string[]> {
    const retentionDays = env.BACKUP_RETENTION_DAYS;
    const minKeep = env.BACKUP_MIN_KEEP;

    const stored = await listBackups();
    const verifiedKeys = new Set(
        (await query<{ object_key: string }>(
            `SELECT object_key FROM backup_runs WHERE status = 'verified' AND object_key IS NOT NULL`,
        )).rows.map((r) => r.object_key),
    );

    // Newest first, so index 0 is the most recent.
    const verified = stored.filter((s) => verifiedKeys.has(s.key));
    if (verified.length <= minKeep) {
        logger.info({ verified: verified.length, minKeep }, 'nothing pruned: too few verified backups');
        return [];
    }

    const cutoff = Date.now() - retentionDays * 86400000;
    const removed: string[] = [];

    for (const candidate of stored) {
        const age = candidate.lastModified?.getTime() ?? Date.now();
        if (age >= cutoff) continue;

        // How many verified backups newer than this one would remain.
        const newerVerified = verified.filter(
            (v) => (v.lastModified?.getTime() ?? 0) > age,
        ).length;
        if (newerVerified < minKeep) continue;

        try {
            await deleteBackup(candidate.key);
            await query(
                `UPDATE backup_runs SET status = 'pruned', pruned_at = now() WHERE object_key = $1`,
                [candidate.key],
            );
            removed.push(candidate.key);
        }
        catch {
            // deleteBackup has already logged. One failure must not stop the rest.
        }
    }

    if (removed.length > 0)
        logger.info({ removed: removed.length, retentionDays }, 'expired backups removed');
    return removed;
}

/** What the administration screen shows, and what an alert would read. */
export async function backupStatus(): Promise<{
    configured: boolean;
    reason: string | null;
    retention_days: number;
    min_keep: number;
    last_verified: unknown;
    last_attempt: unknown;
    verified_in_last_48h: number;
    stale: boolean;
}> {
    const lastVerified = await queryOne(
        `SELECT object_key, started_at, verified_at, byte_size, row_count, schema_version
           FROM backup_runs WHERE status = 'verified'
          ORDER BY started_at DESC LIMIT 1`);
    const lastAttempt = await queryOne(
        `SELECT object_key, status, started_at, finished_at, error
           FROM backup_runs ORDER BY started_at DESC LIMIT 1`);
    const recent = await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM backup_runs
          WHERE status = 'verified' AND started_at > now() - interval '48 hours'`);

    const verifiedRecently = Number(recent?.n ?? 0);
    return {
        configured: backupsConfigured,
        reason: backupsConfigured ? null : backupsUnconfiguredReason(),
        retention_days: env.BACKUP_RETENTION_DAYS,
        min_keep: env.BACKUP_MIN_KEEP,
        last_verified: lastVerified,
        last_attempt: lastAttempt,
        verified_in_last_48h: verifiedRecently,
        // Two missed days is past a daily schedule plus one retry.
        stale: backupsConfigured && verifiedRecently === 0,
    };
}

