import 'dotenv/config';
import { runBackup } from '../src/backup/run.js';
import { closePool } from '../src/db/pool.js';

/**
 * Takes a backup by hand, with the same code path the daily cron uses.
 *
 *   npm run backup:run
 */
try {
    const result = await runBackup({ reason: 'run by hand' });

    if (result.status === 'skipped') {
        console.error(result.reason);
        process.exitCode = 1;
    }
    else if (result.status === 'failed') {
        console.error(`Backup failed: ${result.reason}`);
        for (const c of result.checks ?? []) {
            console.error(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
        }
        process.exitCode = 1;
    }
    else {
        console.log(`Verified: ${result.object_key}`);
        console.log(`  ${result.row_count} rows, ${((result.byte_size ?? 0) / 1024).toFixed(0)} kB, ${result.duration_ms} ms`);
        for (const c of result.checks ?? []) {
            console.log(`  ok   ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
        }
        if (result.pruned?.length) {
            console.log(`  expired ${result.pruned.length} older backups`);
        }
    }
}
finally {
    await closePool();
}
