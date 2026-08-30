/**
 * What a backup contains, in foreign-key order so a restore can insert table by
 * table without deferring constraints. Both the dump and the restore read it.
 */

export const BACKUP_FORMAT = 'cma-backup-v1';

export interface BackupTable {
    /** Table name. */
    name: string;
    /** Column to order by, so paging through a large table is stable. */
    orderBy: string;
}

/**
 * Everything that cannot be reconstructed. Session state is deliberately
 * absent: a restore should not resurrect live sessions, and signing in again
 * costs nothing. `signup_drafts` stays, being work a member actually did.
 */
export const BACKUP_TABLES: BackupTable[] = [
    { name: 'prayer_houses', orderBy: 'id' },
    { name: 'office_types', orderBy: 'office_key' },
    { name: 'members', orderBy: 'id' },
    { name: 'children', orderBy: 'id' },
    { name: 'users', orderBy: 'id' },
    { name: 'office_holders', orderBy: 'id' },
    { name: 'matrix_rules', orderBy: 'id' },
    { name: 'matrix_config', orderBy: 'key' },
    { name: 'events', orderBy: 'id' },
    { name: 'attendance', orderBy: 'id' },
    { name: 'contributions', orderBy: 'id' },
    { name: 'matrix_scores', orderBy: 'id' },
    { name: 'welfare_claims', orderBy: 'id' },
    { name: 'member_photos', orderBy: 'member_id' },
    { name: 'signup_drafts', orderBy: 'id' },
    { name: 'signup_draft_photos', orderBy: 'draft_id' },
    { name: 'audit_log', orderBy: 'id' },
    { name: 'pgmigrations', orderBy: 'id' },
];

/** Tables a restore must be able to see rows in, or the backup is not a backup. */
export const ESSENTIAL_TABLES = ['members', 'matrix_rules', 'matrix_config', 'prayer_houses'];

export interface BackupHeader {
    kind: 'header';
    format: string;
    taken_at: string;
    database: string;
    schema_version: string | null;
    neon_branch: string | null;
    tables: string[];
}

export interface BackupRow {
    kind: 'row';
    table: string;
    data: Record<string, unknown>;
}

export interface BackupTrailer {
    kind: 'trailer';
    counts: Record<string, number>;
    rows: number;
    rows_sha256: string;
}

export type BackupLine = BackupHeader | BackupRow | BackupTrailer;

/** `docs/backups/cma-2026-08-30T04-00-00.ndjson.gz` */
export function backupObjectKey(prefix: string, takenAt: Date): string {
    const stamp = takenAt.toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
    const clean = prefix.replace(/^\/+|\/+$/g, '') || 'docs';
    return `${clean}/backups/cma-${stamp}.ndjson.gz`;
}

/** True for a key this application produced, so pruning cannot touch anything else. */
export function isBackupKey(prefix: string, key: string): boolean {
    const clean = prefix.replace(/^\/+|\/+$/g, '') || 'docs';
    return new RegExp(`^${clean.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/backups/cma-[0-9TZ-]+\\.ndjson\\.gz$`).test(key);
}
