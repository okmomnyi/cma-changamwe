import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { nowNairobi } from '../util/time.js';
import { runDailyTick } from '../jobs/scheduler.js';
import { runBackup } from '../backup/run.js';
import { unauthorized, badRequest } from '../util/errors.js';
export const jobsRouter = Router();
function secretMatches(presented: string): boolean {
    if (!env.CRON_SECRET)
        return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(env.CRON_SECRET);
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
function assertCronCredentials(req: Request): void {
    if (!env.CRON_SECRET) {
        throw badRequest('CRON_SECRET is not configured, so scheduled jobs cannot be triggered.');
    }
    const header = req.get('authorization') ?? '';
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const presented = bearer || req.get('x-cron-secret')?.trim() || '';
    if (!presented || !secretMatches(presented))
        throw unauthorized('Invalid cron credentials.');
}

async function runTriggered(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        assertCronCredentials(req);
        const started = Date.now();
        await runDailyTick(nowNairobi());
        const ms = Date.now() - started;
        logger.info({ ms }, 'scheduled daily tick completed via cron');
        res.json({ status: 'ok', ran_at: nowNairobi().toISO(), duration_ms: ms });
    }
    catch (err) {
        next(err);
    }
}
/**
 * The off-site backup runs on its own schedule and its own function invocation,
 * so a slow report batch cannot eat the time budget the backup needs, and a
 * failure in one does not stop the other.
 */
async function runBackupTriggered(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        assertCronCredentials(req);
        const result = await runBackup({ reason: 'scheduled' });
        // A failed backup answers 500 on purpose. Vercel records the cron
        // invocation as failed, which is the only alerting there is.
        res.status(result.status === 'failed' ? 500 : 200).json({
            ...result, ran_at: nowNairobi().toISO(),
        });
    }
    catch (err) {
        next(err);
    }
}

jobsRouter.post('/run-daily', runTriggered);
jobsRouter.get('/run-daily', runTriggered);
jobsRouter.post('/run-backup', runBackupTriggered);
jobsRouter.get('/run-backup', runBackupTriggered);
