import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { query, queryOne } from '../db/pool.js';
import { logger } from '../util/logger.js';
import { BACKUP_FORMAT, BACKUP_TABLES, type BackupHeader, type BackupTable, type BackupTrailer } from './format.js';

// Larger pages mean fewer round trips, which is what dominates the run when
// the function and the database are not in the same region.
const PAGE = 10000;

export interface DumpResult {
    /** The gzipped NDJSON, ready to store. */
    body: Buffer;
    /** Of the stored bytes. */
    sha256: string;
    /** Of the row lines alone, so a truncation inside the file is detectable. */
    rowsSha256: string;
    rowCount: number;
    counts: Record<string, number>;
    schemaVersion: string | null;
    neonBranch: string | null;
    takenAt: Date;
}

/**
 * Reads one table a page at a time rather than in one statement, so a table
 * that has grown for a decade does not have to fit in memory at once.
 */
async function* readTable(name: string, orderBy: string): AsyncGenerator<Record<string, unknown>[]> {
    let offset = 0;
    for (;;) {
        // The table name comes from BACKUP_TABLES, never from a request.
        const page = await query<Record<string, unknown>>(
            `SELECT * FROM ${name} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
            [PAGE, offset],
        );
        if (page.rows.length === 0)
            return;
        yield page.rows;
        if (page.rows.length < PAGE)
            return;
        offset += PAGE;
    }
}

/** One round trip for the whole list, rather than one per table. */
async function existingTables(names: string[]): Promise<Set<string>> {
    const rows = await query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [names],
    );
    return new Set(rows.rows.map((r) => r.table_name));
}

/**
 * How many rows each table holds, in one round trip, so a table that is empty
 * is skipped entirely rather than costing a query to discover.
 */
async function tableCounts(names: string[]): Promise<Map<string, number>> {
    const unions = names.map((n) => `SELECT '${n}' AS t, count(*)::bigint AS n FROM ${n}`).join(' UNION ALL ');
    const rows = await query<{ t: string; n: string }>(unions);
    return new Map(rows.rows.map((r) => [r.t, Number(r.n)]));
}

/**
 * Builds the backup in one pass, hashing rows as they are written so the
 * trailer carries a fingerprint of the body for verification to recompute.
 */
export async function buildDump(): Promise<DumpResult> {
    const takenAt = new Date();
    const started = Date.now();

    const meta = await queryOne<{
        database: string;
        schema_version: string | null;
        neon_branch: string | null;
    }>(`SELECT current_database() AS database,
            (SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1) AS schema_version,
            current_setting('neon.branch_id', true) AS neon_branch`);

    const present = await existingTables(BACKUP_TABLES.map((t) => t.name));
    const tables: BackupTable[] = [];
    for (const t of BACKUP_TABLES) {
        if (present.has(t.name)) tables.push(t);
        else logger.warn({ table: t.name }, 'table in the backup list does not exist, skipping');
    }
    const sizes = await tableCounts(tables.map((t) => t.name));

    const header: BackupHeader = {
        kind: 'header',
        format: BACKUP_FORMAT,
        taken_at: takenAt.toISOString(),
        database: meta?.database ?? 'unknown',
        schema_version: meta?.schema_version ?? null,
        neon_branch: meta?.neon_branch ?? null,
        tables: tables.map((t) => t.name),
    };

    const rowsHash = createHash('sha256');
    const counts: Record<string, number> = {};
    let rowCount = 0;
    // Filled in by the generator when it writes the trailer, which is the only
    // point at which the row hash is complete.
    let rowsSha256 = '';

    // Lines are pushed through gzip as they are produced, so only the compressed
    // result and one page of rows are ever held at once.
    async function* lines(): AsyncGenerator<string> {
        yield `${JSON.stringify(header)}\n`;

        for (const table of tables) {
            counts[table.name] = 0;
            // An empty table costs nothing beyond the count already taken.
            if ((sizes.get(table.name) ?? 0) === 0)
                continue;
            for await (const page of readTable(table.name, table.orderBy)) {
                for (const data of page) {
                    const line = `${JSON.stringify({ kind: 'row', table: table.name, data })}\n`;
                    rowsHash.update(line);
                    counts[table.name] = (counts[table.name] ?? 0) + 1;
                    rowCount += 1;
                    yield line;
                }
            }
        }

        rowsSha256 = rowsHash.digest('hex');
        const trailer: BackupTrailer = {
            kind: 'trailer',
            counts,
            rows: rowCount,
            rows_sha256: rowsSha256,
        };
        yield `${JSON.stringify(trailer)}\n`;
    }

    const chunks: Buffer[] = [];
    const gzip = createGzip({ level: 9 });
    gzip.on('data', (c: Buffer) => chunks.push(c));
    await pipeline(Readable.from(lines()), gzip);

    const body = Buffer.concat(chunks);
    const sha256 = createHash('sha256').update(body).digest('hex');

    logger.info({
        rows: rowCount, bytes: body.length, tables: tables.length, ms: Date.now() - started,
    }, 'backup built');

    return {
        body, sha256, rowsSha256, rowCount, counts,
        schemaVersion: meta?.schema_version ?? null,
        neonBranch: meta?.neon_branch ?? null,
        takenAt,
    };
}
