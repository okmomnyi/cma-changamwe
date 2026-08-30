import { query } from '../db/pool.js';
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
export async function recalculateAll(asOf?: string): Promise<MatrixResult[]> {
    const members = await query<{
        id: string;
    }>(`SELECT id FROM members WHERE membership_status = 'active' ORDER BY id`);
    const ids = members.rows.map((r) => r.id);
    if (ids.length === 0)
        return [];
    return evaluateMatrix(ids, asOf ? { asOf } : {});
}
