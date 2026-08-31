import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { loadMatrixConfig } from '../matrix/config.js';
import { reportDownloadLimiter } from '../middleware/rateLimit.js';
import { todayNairobi } from '../util/time.js';

/**
 * What the parish shows the world. No account, no session.
 *
 * Only the programme and the prayer houses. Never a member, never a
 * contribution, never an attendance mark, and never a count of anything a
 * member would recognise as their own.
 */
export const publicRouter = Router();

/**
 * Gatherings anyone may come to. Weddings and welfare-driven events are left
 * out: they belong to the families concerned, not to a public calendar.
 */
const PUBLIC_EVENT_TYPES = [
    'mass', 'dominica', 'prayer_house_meeting', 'novena', 'seminar', 'pilgrimage',
    'national_prayer_day', 'family_day', 'agm', 'special_general_meeting',
    'choir', 'act_of_mercy', 'mentorship', 'sports', 'shg_activity',
];

publicRouter.get('/events', reportDownloadLimiter, async (req, res, next) => {
    try {
        const limit = z.coerce.number().int().min(1).max(50).default(12).parse(req.query.limit ?? 12);

        const rows = await query<{
            title: string;
            date: string;
            type: string;
            prayer_house: string | null;
        }>(
            `SELECT e.title, e.date::text, e.type::text, ph.name AS prayer_house
               FROM events e
               LEFT JOIN prayer_houses ph ON ph.id = e.prayer_house_id
              WHERE e.date >= $1::date
                AND e.type::text = ANY($2::text[])
              ORDER BY e.date, e.title
              LIMIT $3`,
            [todayNairobi(), PUBLIC_EVENT_TYPES, limit],
        );

        res.setHeader('cache-control', 'public, max-age=600');
        res.json({ events: rows.rows, as_of: todayNairobi() });
    }
    catch (err) {
        next(err);
    }
});

publicRouter.get('/prayer-houses', reportDownloadLimiter, async (_req, res, next) => {
    try {
        const rows = await query<{ name: string }>(
            `SELECT name FROM prayer_houses ORDER BY name`);
        const config = await loadMatrixConfig();
        res.setHeader('cache-control', 'public, max-age=3600');
        res.json({ prayer_houses: rows.rows.map((r) => r.name), org_name: config.org_name });
    }
    catch (err) {
        next(err);
    }
});
