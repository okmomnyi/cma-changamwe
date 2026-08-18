import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
    path.resolve(process.cwd(), 'db', 'grants.sql'),
    path.resolve(here, '..', 'db', 'grants.sql'),
    path.resolve(here, '..', '..', 'db', 'grants.sql'),
];
const grantsPath = candidates.find((p) => existsSync(p));
if (!grantsPath) {
    console.error('Could not find db/grants.sql. Looked in: ' + candidates.join(', '));
    process.exit(1);
}
const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const appRole = process.env.APP_DB_USER ?? 'cma_app';
const appPassword = process.env.APP_DB_PASSWORD ?? '';
if (!ownerUrl) {
    console.error('MIGRATION_DATABASE_URL (or DATABASE_URL) must be set to the owner connection.');
    process.exit(1);
}
const sql = await readFile(grantsPath, 'utf8');
const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
client.on('notice', (n) => {
    if (n.message)
        console.log(`  postgres: ${n.message}`);
});
try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['cma.app_role', appRole]);
    await client.query('SELECT set_config($1, $2, true)', ['cma.app_password', appPassword]);
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`Grants applied for role "${appRole}".`);
}
catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    console.error('Failed to apply grants:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
}
finally {
    await client.end();
}
