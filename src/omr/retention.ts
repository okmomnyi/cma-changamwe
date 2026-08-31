import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { logger } from '../util/logger.js';
import { deleteObject } from '../media/r2.js';

/**
 * A photograph of an attendance sheet carries the names of everyone on that
 * page, so it is kept for exactly as long as it is useful and no longer.
 *
 * It is useful until the month the meeting falls in has a finalised snapshot:
 * up to that point a disputed row can still be settled by looking at the paper
 * as photographed. Once the month is closed the image is deleted and its hash
 * and per-cell measurements stay behind, which is what an audit actually needs.
 *
 * Two bounds keep that honest. Nothing is purged before SCAN_PHOTO_MIN_DAYS,
 * so a month closed the next morning still leaves a window to check. Anything
 * older than SCAN_PHOTO_MAX_DAYS goes regardless, so a month nobody ever closes
 * cannot quietly keep member names on disk for ever.
 */

export interface PurgeSummary {
    considered: number;
    purged: number;
    failed: number;
}

interface PurgeCandidate {
    id: string;
    photo_ref: string;
    reason: string;
}

export async function purgeScanPhotos(): Promise<PurgeSummary> {
    const candidates = await query<PurgeCandidate>(
        `SELECT s.id, s.photo_ref,
                CASE WHEN s.uploaded_at < now() - ($2 || ' days')::interval
                     THEN 'older than the backstop'
                     ELSE 'the month has been closed' END AS reason
           FROM attendance_scans s
           JOIN attendance_sheets sh ON sh.id = s.sheet_id
           JOIN events e ON e.id = sh.event_id
          WHERE s.photo_ref IS NOT NULL
            AND s.photo_purged_at IS NULL
            AND s.uploaded_at < now() - ($1 || ' days')::interval
            AND (
                  s.uploaded_at < now() - ($2 || ' days')::interval
                  OR EXISTS (SELECT 1 FROM matrix_scores ms
                              WHERE ms.period = to_char(e.date, 'YYYY-MM'))
                )
          ORDER BY s.uploaded_at
          LIMIT 500`,
        [env.SCAN_PHOTO_MIN_DAYS, env.SCAN_PHOTO_MAX_DAYS]);

    let purged = 0;
    let failed = 0;

    for (const candidate of candidates.rows) {
        try {
            await deleteObject(candidate.photo_ref);
            await query(
                `UPDATE attendance_scans
                    SET photo_ref = NULL, photo_purged_at = now()
                  WHERE id = $1 AND photo_purged_at IS NULL`, [candidate.id]);
            purged += 1;
        }
        catch (err) {
            failed += 1;
            logger.warn({ err, scanId: candidate.id }, 'could not purge an attendance scan photograph');
        }
    }

    if (purged > 0)
        logger.info({ purged, failed }, 'attendance scan photographs purged');

    return { considered: candidates.rows.length, purged, failed };
}
