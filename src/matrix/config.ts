import { query, type Queryable } from '../db/pool.js';
export interface MatrixConfig {
    overall_min: number;
    spirituality_min: number;
    financial_min: number;
    enforce_category_mins: boolean;
    rescale_thresholds: boolean;
    min_attainable: number;
    expected_monthly: number;
    monthly_partial_satisfies: boolean;
    weddings_window_months: number;
    affiliation_min_amount: number;
    other_contribution_categories: string[];
    bereavement_categories: string[];
    admin_offices: string[];
    org_name: string;
    coordinator_label: string;
    raw: Record<string, unknown>;
}
const DEFAULTS: Omit<MatrixConfig, 'raw'> = {
    overall_min: 60,
    spirituality_min: 40,
    financial_min: 20,
    enforce_category_mins: true,
    rescale_thresholds: true,
    min_attainable: 70,
    expected_monthly: 100,
    monthly_partial_satisfies: false,
    weddings_window_months: 12,
    affiliation_min_amount: 1000,
    other_contribution_categories: [
        'deanery_affiliation', 'seminar_fee', 'archbishop_support', 'sick_admission', 'sick_visitation',
    ],
    bereavement_categories: [
        'benevolent_member_spouse', 'benevolent_child', 'benevolent_parent',
    ],
    admin_offices: ['coordinator', 'treasurer'],
    org_name: 'CMA Changamwe',
    coordinator_label: 'Coordinator',
};
export async function loadMatrixConfig(client?: Queryable): Promise<MatrixConfig> {
    const rows = await query<{
        key: string;
        value: unknown;
    }>(`SELECT key, value FROM matrix_config`, [], client);
    const raw: Record<string, unknown> = {};
    for (const row of rows.rows)
        raw[row.key] = row.value;
    const num = (key: keyof typeof DEFAULTS): number => {
        const value = raw[key];
        const parsed = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(parsed) ? parsed : (DEFAULTS[key] as number);
    };
    const bool = (key: keyof typeof DEFAULTS): boolean => typeof raw[key] === 'boolean' ? (raw[key] as boolean) : (DEFAULTS[key] as boolean);
    const list = (key: keyof typeof DEFAULTS): string[] => Array.isArray(raw[key]) ? (raw[key] as string[]) : (DEFAULTS[key] as string[]);
    const str = (key: keyof typeof DEFAULTS): string => typeof raw[key] === 'string' ? (raw[key] as string) : (DEFAULTS[key] as string);
    return {
        overall_min: num('overall_min'),
        spirituality_min: num('spirituality_min'),
        financial_min: num('financial_min'),
        enforce_category_mins: bool('enforce_category_mins'),
        rescale_thresholds: bool('rescale_thresholds'),
        min_attainable: num('min_attainable'),
        expected_monthly: num('expected_monthly'),
        monthly_partial_satisfies: bool('monthly_partial_satisfies'),
        weddings_window_months: num('weddings_window_months'),
        affiliation_min_amount: num('affiliation_min_amount'),
        other_contribution_categories: list('other_contribution_categories'),
        bereavement_categories: list('bereavement_categories'),
        admin_offices: list('admin_offices'),
        org_name: str('org_name'),
        coordinator_label: str('coordinator_label'),
        raw,
    };
}
export function configNumber(config: MatrixConfig, key: string, fallback: number): number {
    const value = config.raw[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
export function configList(config: MatrixConfig, key: string, fallback: string[]): string[] {
    const value = config.raw[key];
    return Array.isArray(value) ? (value as string[]) : fallback;
}
