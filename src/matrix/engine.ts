import { DateTime } from 'luxon';
import { query, type Queryable } from '../db/pool.js';
import { NAIROBI, todayNairobi } from '../util/time.js';
import { loadMatrixConfig, type MatrixConfig } from './config.js';
import { loadMatrixRules, type MatrixRule } from './rules.js';
import { evaluateRule } from './windows.js';
export type Standing = 'in_good_standing' | 'below_threshold' | 'insufficient_history' | 'ineligible_gate';
export interface ItemBreakdown {
    item_key: string;
    label: string;
    category: 'spirituality' | 'financial';
    applied: boolean;
    count: number;
    total: number;
    ratio: number | null;
    points: number;
    score: number;
    threshold_pct: number;
    threshold_met: boolean | null;
    hard_gate: boolean;
    window: string;
}
export interface GateResult {
    passed: boolean;
    affiliation_paid: boolean;
    profile_locked: boolean;
    reasons: string[];
}
export interface MatrixResult {
    member_id: string;
    as_of: string;
    period: string;
    spirituality_score: number;
    financial_score: number;
    total_score: number;
    attainable_total: number;
    attainable_spirituality: number;
    attainable_financial: number;
    standing: Standing;
    gate: GateResult;
    thresholds: {
        overall: number;
        spirituality: number;
        financial: number;
        enforced_category_mins: boolean;
    };
    items: ItemBreakdown[];
}
function describeWindow(rule: MatrixRule): string {
    switch (rule.window_type) {
        case 'rolling_months':
            return rule.source_filter?.per === 'month'
                ? `Rolling ${rule.window_value} months, counted per month`
                : `Rolling ${rule.window_value} months`;
        case 'last_n_occurrences': return `Last ${rule.window_value} occurrences`;
        case 'last_n_series': return `Last ${rule.window_value} series, counted per day`;
        case 'frequency': return `Rolling ${rule.window_value} months`;
        case 'mandatory': return 'Current affiliation year';
        default: return rule.window_type;
    }
}
async function evaluateGate(memberIds: string[], config: MatrixConfig, asOf: string, client?: Queryable): Promise<Map<string, GateResult>> {
    const year = DateTime.fromISO(asOf, { zone: NAIROBI }).year;
    const result = await query<{
        member_id: string;
        affiliation_paid: boolean;
        profile_locked: boolean;
    }>(`SELECT m.id AS member_id,
            m.profile_locked,
            COALESCE((
              SELECT sum(c.amount) FROM contributions c
              WHERE c.member_id = m.id
                AND c.category = 'diocese_affiliation'
                AND c.affiliation_year = $2
                AND c.date <= $3::date
            ), 0) >= $4 AS affiliation_paid
     FROM members m
     WHERE m.id = ANY($1::uuid[])`, [memberIds, year, asOf, config.affiliation_min_amount], client);
    const gates = new Map<string, GateResult>();
    for (const row of result.rows) {
        const reasons: string[] = [];
        if (!row.affiliation_paid) {
            reasons.push(`Diocese affiliation for ${year} is not fully paid.`);
        }
        if (!row.profile_locked)
            reasons.push('Bio-data profile is not complete.');
        gates.set(row.member_id, {
            passed: row.affiliation_paid && row.profile_locked,
            affiliation_paid: row.affiliation_paid,
            profile_locked: row.profile_locked,
            reasons,
        });
    }
    return gates;
}
export async function evaluateMatrix(memberIds: string[], options: {
    asOf?: string;
    client?: Queryable;
} = {}): Promise<MatrixResult[]> {
    if (memberIds.length === 0)
        return [];
    const asOf = options.asOf ?? todayNairobi();
    const [config, rules] = await Promise.all([
        loadMatrixConfig(options.client),
        loadMatrixRules(options.client),
    ]);
    const tallies = new Map<string, Map<string, {
        count: number;
        total: number;
    }>>();
    for (const rule of rules) {
        const results = await evaluateRule(rule, config, memberIds, { asOf, client: options.client });
        for (const tally of results) {
            let perMember = tallies.get(tally.memberId);
            if (!perMember) {
                perMember = new Map();
                tallies.set(tally.memberId, perMember);
            }
            perMember.set(rule.item_key, { count: tally.count, total: tally.total });
        }
    }
    const gates = await evaluateGate(memberIds, config, asOf, options.client);
    const period = DateTime.fromISO(asOf, { zone: NAIROBI }).toFormat('yyyy-MM');
    return memberIds.map((memberId) => {
        const perMember = tallies.get(memberId) ?? new Map();
        const items: ItemBreakdown[] = [];
        let spiritualityScore = 0;
        let financialScore = 0;
        let attainableSpirituality = 0;
        let attainableFinancial = 0;
        for (const rule of rules) {
            const tally = perMember.get(rule.item_key) ?? { count: 0, total: 0 };
            const applied = tally.total > 0;
            const ratio = applied ? tally.count / tally.total : null;
            const thresholdMet = ratio === null ? null : ratio >= rule.min_threshold_pct / 100;
            let score = 0;
            if (applied && ratio !== null) {
                score = rule.hard_gate && !thresholdMet ? 0 : ratio * rule.points;
            }
            if (applied) {
                if (rule.category === 'spirituality') {
                    spiritualityScore += score;
                    attainableSpirituality += rule.points;
                }
                else {
                    financialScore += score;
                    attainableFinancial += rule.points;
                }
            }
            items.push({
                item_key: rule.item_key,
                label: rule.label,
                category: rule.category,
                applied,
                count: tally.count,
                total: tally.total,
                ratio,
                points: rule.points,
                score,
                threshold_pct: rule.min_threshold_pct,
                threshold_met: thresholdMet,
                hard_gate: rule.hard_gate,
                window: describeWindow(rule),
            });
        }
        const totalScore = spiritualityScore + financialScore;
        const attainableTotal = attainableSpirituality + attainableFinancial;
        const maxSpirituality = rules
            .filter((r) => r.category === 'spirituality')
            .reduce((sum, r) => sum + r.points, 0);
        const maxFinancial = rules
            .filter((r) => r.category === 'financial')
            .reduce((sum, r) => sum + r.points, 0);
        const maxTotal = maxSpirituality + maxFinancial;
        const scale = (attainable: number, max: number) => config.rescale_thresholds && max > 0 ? attainable / max : 1;
        const overallThreshold = config.overall_min * scale(attainableTotal, maxTotal);
        const spiritualityThreshold = config.spirituality_min * scale(attainableSpirituality, maxSpirituality);
        const financialThreshold = config.financial_min * scale(attainableFinancial, maxFinancial);
        const gate = gates.get(memberId) ?? {
            passed: false, affiliation_paid: false, profile_locked: false,
            reasons: ['Member record not found.'],
        };
        let standing: Standing;
        if (!gate.passed) {
            standing = 'ineligible_gate';
        }
        else if (attainableTotal < config.min_attainable) {
            standing = 'insufficient_history';
        }
        else {
            const meetsOverall = totalScore >= overallThreshold;
            const meetsCategories = !config.enforce_category_mins
                || (spiritualityScore >= spiritualityThreshold && financialScore >= financialThreshold);
            standing = meetsOverall && meetsCategories ? 'in_good_standing' : 'below_threshold';
        }
        return {
            member_id: memberId,
            as_of: asOf,
            period,
            spirituality_score: spiritualityScore,
            financial_score: financialScore,
            total_score: totalScore,
            attainable_total: attainableTotal,
            attainable_spirituality: attainableSpirituality,
            attainable_financial: attainableFinancial,
            standing,
            gate,
            thresholds: {
                overall: overallThreshold,
                spirituality: spiritualityThreshold,
                financial: financialThreshold,
                enforced_category_mins: config.enforce_category_mins,
            },
            items,
        };
    });
}
export async function evaluateMatrixForMember(memberId: string, options: {
    asOf?: string;
    client?: Queryable;
} = {}): Promise<MatrixResult | null> {
    const [result] = await evaluateMatrix([memberId], options);
    return result ?? null;
}
