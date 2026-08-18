import { Router } from 'express';
import { queryOne } from '../db/pool.js';
import { nowNairobi } from '../util/time.js';
export const healthRouter = Router();
healthRouter.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: nowNairobi().toISO() });
});
healthRouter.get('/ready', async (_req, res) => {
    try {
        const row = await queryOne<{
            now: string;
            tz: string;
        }>(`SELECT now()::text AS now, current_setting('TimeZone') AS tz`);
        res.json({ status: 'ready', db: 'ok', db_time: row?.now, db_timezone: row?.tz });
    }
    catch {
        res.status(503).json({ status: 'not_ready', db: 'unreachable' });
    }
});
