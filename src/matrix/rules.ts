import { query, type Queryable } from '../db/pool.js';
export interface MatrixRule {
    id: string;
    item_key: string;
    label: string;
    category: 'spirituality' | 'financial';
    source_kind: 'attendance' | 'contribution';
    source_filter: Record<string, unknown>;
    window_type: 'rolling_months' | 'last_n_occurrences' | 'last_n_series' | 'mandatory' | 'frequency';
    window_value: number | null;
    points: number;
    min_threshold_pct: number;
    hard_gate: boolean;
    sort_order: number;
}
export async function loadMatrixRules(client?: Queryable): Promise<MatrixRule[]> {
    const result = await query<MatrixRule & {
        points: string;
        min_threshold_pct: string;
    }>(`SELECT id, item_key, label, category, source_kind, source_filter,
            window_type, window_value, points::text, min_threshold_pct::text,
            hard_gate, sort_order
     FROM matrix_rules
     WHERE active
     ORDER BY sort_order, item_key`, [], client);
    return result.rows.map((row) => ({
        ...row,
        points: Number(row.points),
        min_threshold_pct: Number(row.min_threshold_pct),
        source_filter: (row.source_filter ?? {}) as Record<string, unknown>,
    }));
}
