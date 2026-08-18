import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { NAIROBI, currentPeriod, nowNairobi } from '../util/time.js';
import { writeSnapshots } from '../matrix/snapshot.js';
import { sendPendingReports } from '../comms/batch.js';
import { sendLeadershipDigest } from '../comms/digest.js';
import { queryOne } from '../db/pool.js';
const CHECK_INTERVAL_MS = 15 * 60000;
let timer: NodeJS.Timeout | null = null;
let running = false;
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
        logger.info('serverless mode: the monthly job runs from cron, not a timer');
        return;
    }
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            const now = nowNairobi();
            const hour = now.hour;
            if (hour < 6 || hour > 20)
                return;
            if (await alreadySentToday())
                return;
            await runDailyTick(now);
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
    logger.info({ intervalMinutes: CHECK_INTERVAL_MS / 60000, timezone: NAIROBI, period: currentPeriod() }, 'monthly report scheduler started');
}
export function stopScheduler(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
