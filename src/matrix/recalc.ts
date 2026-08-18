import { query } from '../db/pool.js';
import { logger } from '../util/logger.js';
import { evaluateMatrix, type MatrixResult } from './engine.js';
export async function recalculateForMember(memberId: string): Promise<MatrixResult | null> {
    const [result] = await evaluateMatrix([memberId]);
    return result ?? null;
}
export async function recalculateForMembers(memberIds: string[]): Promise<number> {
    const unique = [...new Set(memberIds)];
    if (unique.length === 0)
        return 0;
    const results = await evaluateMatrix(unique);
    return results.length;
}
export async function recalculateForEvent(eventId: string): Promise<number> {
    const members = await query<{
        member_id: string;
    }>(`SELECT DISTINCT member_id FROM attendance WHERE event_id = $1`, [eventId]);
    const ids = members.rows.map((r) => r.member_id);
    if (ids.length === 0)
        return 0;
    const started = Date.now();
    const results = await evaluateMatrix(ids);
    logger.info({ eventId, members: results.length, ms: Date.now() - started }, 'bulk matrix recalculation complete');
    return results.length;
}
export async function recalculateAll(asOf?: string): Promise<MatrixResult[]> {
    const members = await query<{
        id: string;
    }>(`SELECT id FROM members WHERE membership_status = 'active' ORDER BY id`);
    const ids = members.rows.map((r) => r.id);
    if (ids.length === 0)
        return [];
    return evaluateMatrix(ids, asOf ? { asOf } : {});
}
