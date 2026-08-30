import 'dotenv/config';
import { listBackups, getBackup, backupsConfigured, backupsUnconfiguredReason } from '../src/backup/store.js';
import { verifyBackupBytes } from '../src/backup/verify.js';

/**
 * Re-reads every backup in R2. The nightly job verifies each one when written;
 * this catches a file that has decayed or been altered since.
 *
 *   npm run backup:verify [-- --latest]
 */

const latestOnly = process.argv.includes('--latest');

if (!backupsConfigured) {
    console.error(backupsUnconfiguredReason());
    process.exit(1);
}

const stored = await listBackups();
if (stored.length === 0) {
    console.error('There are no backups in R2 at all.');
    process.exit(1);
}

const toCheck = latestOnly ? stored.slice(0, 1) : stored;
console.log(`Checking ${toCheck.length} of ${stored.length} stored backups.\n`);

let bad = 0;
for (const item of toCheck) {
    const name = item.key.split('/').pop() ?? item.key;
    const size = `${(item.size / 1024).toFixed(0)} kB`;
    try {
        const body = await getBackup(item.key);
        const result = verifyBackupBytes(body);
        if (result.ok) {
            console.log(`  ok    ${name}  ${size.padStart(9)}  ${result.rowCount} rows, taken ${result.header!.taken_at}`);
        }
        else {
            bad += 1;
            console.log(`  FAIL  ${name}  ${size.padStart(9)}  ${result.failure}`);
            for (const c of result.checks.filter((x) => !x.ok)) {
                console.log(`          failed check: ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
            }
        }
    }
    catch (err) {
        bad += 1;
        console.log(`  FAIL  ${name}  could not be read: ${err instanceof Error ? err.message : err}`);
    }
}

console.log();
if (bad === 0) {
    console.log(`All ${toCheck.length} backups read cleanly.`);
}
else {
    console.error(`${bad} of ${toCheck.length} backups are not sound. Do not rely on them.`);
    process.exitCode = 1;
}
