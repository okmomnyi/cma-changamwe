import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { NAIROBI, currentPeriod, nowNairobi } from '../util/time.js';
import { writeSnapshots } from '../matrix/snapshot.js';
import { sendPendingReports } from '../comms/batch.js';
import { sendLeadershipDigest } from '../comms/digest.js';
import { queryOne } from '../db/pool.js';
import { runBackup } from '../backup/run.js';
import { purgeScanPhotos } from '../omr/retention.js';

const CHECK_INTERVAL_MS = 15 * 60000;
/** Nairobi hour the nightly backup runs at. */
const BACKUP_HOUR = 2;
let timer: NodeJS.Timeout | null = null;
let running = false;

/** True once a verified backup exists for today, Nairobi time. */
async function backedUpToday(): Promise<boolean> {
    const row = await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM backup_runs
          WHERE status = 'verified'
            AND (started_at AT TIME ZONE 'Africa/Nairobi')::date
                = (now() AT TIME ZONE 'Africa/Nairobi')::date`);
    return Number(row?.n ?? 0) > 0;
}
/**
 * The nightly backup, from the timer rather than an external cron. Idempotent:
 * once one is verified for the day, it does not run again.
 */
export async function runBackupTick(now: DateTime = nowNairobi()): Promise<void> {
    if (now.hour < BACKUP_HOUR)
        return;
    if (await backedUpToday())
        return;
    const result = await runBackup({ reason: 'nightly' });
    if (result.status === 'failed')
        logger.error(result, 'nightly backup failed and will be retried on the next tick');
}

export async function runDailyTick(now: DateTime = nowNairobi()): Promise<void> {
    const period = now.toFormat('yyyy-MM');
    if (now.day === 1) {
        const previous = now.minus({ months: 1 }).toFormat('yyyy-MM');
        const summary = await writeSnapshots(previous, now.minus({ days: 1 }).toISODate()!);
        if (summary.written > 0) {
            logger.info(summary, 'monthly snapshots generated');
            await sendLeadershipDigest({ period: previous });
        }
    }
    const pending = await queryOne<{
        period: string;
    }>(`SELECT period FROM matrix_scores WHERE email_status = 'pending'
     ORDER BY period DESC LIMIT 1`);
    if (pending) {
        const result = await sendPendingReports({ period: pending.period });
        if (result.attempted > 0)
            logger.info(result, 'daily report batch sent');
    }
    void period;
}
async function alreadySentToday(): Promise<boolean> {
    const row = await queryOne<{
        n: string;
    }>(`SELECT count(*)::text AS n FROM matrix_scores
     WHERE sent_at >= date_trunc('day', now())`);
    return Number(row?.n ?? 0) > 0;
}
export function startScheduler(): void {
    if (timer)
        return;
    if (env.NODE_ENV === 'test')
        return;
    if (env.SERVERLESS) {
        logger.info('SERVERLESS=true: jobs run from an external cron, not this timer');
        return;
    }
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            const now = nowNairobi();

            // The backup runs overnight, outside the hours reports go out, and
            // is kept separate so a failed batch does not stop it.
            try {
                await runBackupTick(now);
            }
            catch (err) {
                logger.error({ err }, 'nightly backup failed; it will be retried on the next tick');
            }

            // Photographs of attendance sheets carry member names, so they
            // are purged as soon as the month they belong to is closed. It
            // runs beside the backup, out of the way of the working day.
            try {
                await purgeScanPhotos();
            }
            catch (err) {
                logger.error({ err }, 'purging attendance scan photographs failed; it will be retried on the next tick');
            }

            // Reports keep to waking hours, and only once a day.
            if (now.hour >= 6 && now.hour <= 20 && !(await alreadySentToday())) {
                await runDailyTick(now);
            }
        }
        catch (err) {
            logger.error({ err }, 'scheduled job failed; it will be retried on the next tick');
        }
        finally {
            running = false;
        }
    };
    timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
    timer.unref();
    logger.info({
        intervalMinutes: CHECK_INTERVAL_MS / 60000, timezone: NAIROBI,
        period: currentPeriod(), backupHour: BACKUP_HOUR,
    }, 'scheduler started: nightly backup and daily reports');
}
export function stopScheduler(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
