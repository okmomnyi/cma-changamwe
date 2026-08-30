import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import pg from 'pg';
import { BACKUP_TABLES } from '../src/backup/format.js';
import { verifyBackupBytes } from '../src/backup/verify.js';

/**
 * Restores a backup. Meant to be run on a scratch Neon branch before it is ever
 * needed in anger.
 *
 *   npm run backup:restore -- --key docs/backups/cma-....ndjson.gz --into "$URL"
 *
 * Restores rows, not structure: migrate the target first. Refuses a target that
 * already holds members unless --force.
 */

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const file = arg('file');
const key = arg('key');
const into = arg('into') ?? process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const force = has('force');
const dryRun = has('dry-run');

if (!file && !key) {
    console.error('Give either --file <path> or --key <r2 object key>.');
    process.exit(1);
}
if (!into) {
    console.error('Give --into <connection string>, or set MIGRATION_DATABASE_URL.');
    process.exit(1);
}

async function load(): Promise<Buffer> {
    if (file) return readFile(file);
    const { getBackup } = await import('../src/backup/store.js');
    console.log(`Fetching ${key} from R2...`);
    return getBackup(key!);
}

const body = await load();

console.log('Verifying the backup before touching anything...');
const check = verifyBackupBytes(body);
for (const c of check.checks) {
    console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
}
if (!check.ok) {
    console.error(`\nThis backup is not sound: ${check.failure}`);
    console.error('Nothing has been changed. Use an earlier backup.');
    process.exit(1);
}

console.log(`\nTaken at ${check.header!.taken_at}`);
console.log(`Schema   ${check.header!.schema_version}`);
console.log(`Rows     ${check.rowCount} across ${Object.keys(check.counts).length} tables`);

if (dryRun) {
    console.log('\n--dry-run: the backup reads cleanly. Nothing was written.');
    process.exit(0);
}

const client = new pg.Client({ connectionString: into });
await client.connect();

try {
    const target = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM members`);
    if (Number(target.rows[0]!.n) > 0 && !force) {
        console.error(`\nThe target already holds ${target.rows[0]!.n} members.`);
        console.error('Restoring would replace them. Re-run with --force if that is what you want.');
        process.exit(1);
    }

    const schema = await client.query<{ name: string }>(
        `SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1`);
    const targetSchema = schema.rows[0]?.name ?? null;
    if (targetSchema !== check.header!.schema_version) {
        console.warn(`\nWarning: the backup was taken at schema "${check.header!.schema_version}"`);
        console.warn(`         and the target is at "${targetSchema}".`);
        if (!force) {
            console.error('Run the migrations on the target first, or pass --force.');
            process.exit(1);
        }
    }

    // Group the rows by table so each one is inserted in dependency order.
    const text = gunzipSync(body).toString('utf8');
    const byTable = new Map<string, Record<string, unknown>[]>();
    for (const raw of text.split('\n')) {
        if (!raw) continue;
        const line = JSON.parse(raw) as { kind: string; table?: string; data?: Record<string, unknown> };
        if (line.kind !== 'row' || !line.table || !line.data) continue;
        const bucket = byTable.get(line.table) ?? [];
        bucket.push(line.data);
        byTable.set(line.table, bucket);
    }

    await client.query('BEGIN');

    const order = BACKUP_TABLES.map((t) => t.name).filter((n) => byTable.has(n));

    // Cleared in reverse dependency order so foreign keys never block it.
    console.log('\nClearing the target...');
    for (const name of [...order].reverse()) {
        if (name === 'pgmigrations') continue;
        await client.query(`DELETE FROM ${name}`);
    }

    // A jsonb column needs its value re-encoded on the way back in. Postgres
    // hands `'"CMA Changamwe"'::jsonb` to the driver as the bare string
    // "CMA Changamwe", which is indistinguishable from a text value; writing
    // that back raw is not valid JSON. Every json column is therefore
    // stringified and cast explicitly.
    const jsonColumns = new Map<string, Set<string>>();
    const jsonMeta = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND data_type IN ('json','jsonb')`);
    for (const row of jsonMeta.rows) {
        const set = jsonColumns.get(row.table_name) ?? new Set<string>();
        set.add(row.column_name);
        jsonColumns.set(row.table_name, set);
    }

    console.log('Restoring...');
    let written = 0;
    for (const name of order) {
        if (name === 'pgmigrations') continue;
        const rows = byTable.get(name)!;
        if (rows.length === 0) continue;

        const columns = Object.keys(rows[0]!);
        const quoted = columns.map((c) => `"${c}"`).join(', ');
        const jsonCols = jsonColumns.get(name) ?? new Set<string>();

        // One statement per 500 rows, so a large table does not build one
        // enormous parameter list.
        for (let i = 0; i < rows.length; i += 500) {
            const slice = rows.slice(i, i + 500);
            const params: unknown[] = [];
            const tuples = slice.map((row) => {
                const placeholders = columns.map((c) => {
                    const value = row[c] ?? null;
                    if (jsonCols.has(c)) {
                        params.push(value === null ? null : JSON.stringify(value));
                        return `$${params.length}::jsonb`;
                    }
                    params.push(value);
                    return `$${params.length}`;
                });
                return `(${placeholders.join(', ')})`;
            });
            await client.query(
                `INSERT INTO ${name} (${quoted}) VALUES ${tuples.join(', ')}`,
                params,
            );
        }
        written += rows.length;
        console.log(`  ${name.padEnd(24)} ${rows.length}`);
    }

    // Sequences do not move when rows are inserted with explicit keys, so the
    // next insert after a restore would collide without this.
    const sequences = await client.query<{ seq: string; tab: string; col: string }>(
        `SELECT s.relname AS seq, t.relname AS tab, a.attname AS col
           FROM pg_class s
           JOIN pg_depend d ON d.objid = s.oid
           JOIN pg_class t ON t.oid = d.refobjid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
          WHERE s.relkind = 'S'`);
    for (const s of sequences.rows) {
        await client.query(
            `SELECT setval($1, COALESCE((SELECT max("${s.col}") FROM ${s.tab}), 0) + 1, false)`,
            [s.seq],
        );
    }
    console.log(`  ${String(sequences.rowCount ?? 0)} sequences reset`);

    await client.query('COMMIT');
    console.log(`\nRestored ${written} rows. Re-apply the grants next: npm run db:grants`);
}
catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nRestore failed and was rolled back. The target is unchanged.');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
}
finally {
    await client.end();
}
