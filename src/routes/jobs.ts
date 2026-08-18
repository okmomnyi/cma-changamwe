import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { nowNairobi } from '../util/time.js';
import { runDailyTick } from '../jobs/scheduler.js';
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
async function runTriggered(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        if (!env.CRON_SECRET) {
            throw badRequest('CRON_SECRET is not configured, so scheduled jobs cannot be triggered.');
        }
        const header = req.get('authorization') ?? '';
        const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
        const presented = bearer || req.get('x-cron-secret')?.trim() || '';
        if (!presented || !secretMatches(presented))
            throw unauthorized('Invalid cron credentials.');
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
jobsRouter.post('/run-daily', runTriggered);
jobsRouter.get('/run-daily', runTriggered);
