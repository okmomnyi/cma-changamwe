import { query, withTransaction } from '../db/pool.js';
import { currentPeriod } from '../util/time.js';
import { logger } from '../util/logger.js';
import { recalculateAll } from './recalc.js';
import type { MatrixResult } from './engine.js';
export interface SnapshotSummary {
    period: string;
    written: number;
    skipped_existing: number;
    by_standing: Record<string, number>;
}
function toRow(result: MatrixResult) {
    return {
        member_id: result.member_id,
        spirituality: result.spirituality_score,
        financial: result.financial_score,
        total: result.total_score,
        attainable: result.attainable_total,
        standing: result.standing,
        breakdown: JSON.stringify({
            as_of: result.as_of,
            gate: result.gate,
            thresholds: result.thresholds,
            attainable_spirituality: result.attainable_spirituality,
            attainable_financial: result.attainable_financial,
            items: result.items,
        }),
    };
}
export async function writeSnapshots(period: string = currentPeriod(), asOf?: string): Promise<SnapshotSummary> {
    const results = await recalculateAll(asOf);
    if (results.length === 0) {
        return { period, written: 0, skipped_existing: 0, by_standing: {} };
    }
    const rows = results.map(toRow);
    const inserted = await withTransaction(async (client) => query<{
        member_id: string;
    }>(`INSERT INTO matrix_scores
         (member_id, period, spirituality_score, financial_score, total_score,
          attainable_total, standing, breakdown_json, email_status)
       SELECT s.member_id, $2, s.spirituality, s.financial, s.total, s.attainable,
              s.standing::matrix_standing, s.breakdown::jsonb, 'pending'
       FROM unnest($1::uuid[], $3::numeric[], $4::numeric[], $5::numeric[],
                   $6::numeric[], $7::text[], $8::text[])
            AS s(member_id, spirituality, financial, total, attainable, standing, breakdown)
       ON CONFLICT (member_id, period) DO NOTHING
       RETURNING member_id`, [
        rows.map((r) => r.member_id), period,
        rows.map((r) => r.spirituality), rows.map((r) => r.financial),
        rows.map((r) => r.total), rows.map((r) => r.attainable),
        rows.map((r) => r.standing), rows.map((r) => r.breakdown),
    ], client));
    const byStanding: Record<string, number> = {};
    for (const result of results) {
        byStanding[result.standing] = (byStanding[result.standing] ?? 0) + 1;
    }
    const summary: SnapshotSummary = {
        period,
        written: inserted.rowCount ?? 0,
        skipped_existing: results.length - (inserted.rowCount ?? 0),
        by_standing: byStanding,
    };
    logger.info(summary, 'matrix snapshots written');
    return summary;
}
