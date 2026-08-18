import { DateTime } from 'luxon';
import { NAIROBI } from '../util/time.js';
export interface SnapshotItem {
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
    window: string;
}
export interface SnapshotForReport {
    member_name: string;
    period: string;
    spirituality_score: number;
    financial_score: number;
    total_score: number;
    attainable_total: number;
    standing: string;
    breakdown: {
        items?: SnapshotItem[];
        gate?: {
            passed: boolean;
            reasons: string[];
        };
        thresholds?: {
            overall: number;
            spirituality: number;
            financial: number;
        };
    };
    org_name: string;
}
const STANDING_TEXT: Record<string, string> = {
    in_good_standing: 'In good standing',
    below_threshold: 'Below the threshold',
    insufficient_history: 'Not enough history yet',
    ineligible_gate: 'Not currently eligible',
};
const STANDING_EXPLANATION: Record<string, string> = {
    in_good_standing: 'You meet the requirements for welfare support. Asante for your participation.',
    below_threshold: 'Your score is below the threshold for welfare support. The breakdown below shows where the points were lost.',
    insufficient_history: 'There is not yet enough recorded history to judge your standing. This resolves on its own as the association holds more events.',
    ineligible_gate: 'Your standing cannot be assessed until the eligibility requirements below are met.',
};
export function periodLabel(period: string): string {
    return DateTime.fromISO(`${period}-01`, { zone: NAIROBI }).toFormat('LLLL yyyy');
}
function fmt(value: number): string {
    return value.toFixed(2);
}
function itemLine(item: SnapshotItem): string {
    if (!item.applied) {
        return `  ${item.label.padEnd(24)} not applicable this period (nothing was held)`;
    }
    const pct = item.ratio === null ? '--' : `${(item.ratio * 100).toFixed(0)}%`;
    const flag = item.threshold_met ? '' : `  (below the ${item.threshold_pct}% guide)`;
    return `  ${item.label.padEnd(24)} ${item.count}/${item.total} = ${pct.padStart(4)}` +
        `  ->  ${fmt(item.score)} of ${fmt(item.points)} points${flag}`;
}
export function renderReportText(snapshot: SnapshotForReport): string {
    const items = snapshot.breakdown.items ?? [];
    const spirituality = items.filter((i) => i.category === 'spirituality');
    const financial = items.filter((i) => i.category === 'financial');
    const standing = STANDING_TEXT[snapshot.standing] ?? snapshot.standing;
    const lines: string[] = [
        `${snapshot.org_name} - Matrix report for ${periodLabel(snapshot.period)}`,
        '',
        `Habari ${snapshot.member_name},`,
        '',
        `Your standing: ${standing}`,
        STANDING_EXPLANATION[snapshot.standing] ?? '',
        '',
        `Total score      ${fmt(snapshot.total_score)} out of ${fmt(snapshot.attainable_total)} attainable`,
        `  Spirituality   ${fmt(snapshot.spirituality_score)}`,
        `  Financial      ${fmt(snapshot.financial_score)}`,
        '',
    ];
    if (snapshot.breakdown.gate && !snapshot.breakdown.gate.passed) {
        lines.push('Before your standing can be assessed:');
        for (const reason of snapshot.breakdown.gate.reasons)
            lines.push(`  - ${reason}`);
        lines.push('');
    }
    if (spirituality.length > 0) {
        lines.push('SPIRITUALITY');
        for (const item of spirituality)
            lines.push(itemLine(item));
        lines.push('');
    }
    if (financial.length > 0) {
        lines.push('FINANCIAL');
        for (const item of financial)
            lines.push(itemLine(item));
        lines.push('');
    }
    lines.push('These figures are a snapshot taken when this report was generated. Your live', 'score, including anything recorded since, is always in the member portal.', '', 'If any record here looks wrong, speak to the Coordinator or Treasurer.', '', snapshot.org_name);
    return lines.filter((line) => line !== undefined).join('\n');
}
export function reportSubject(snapshot: SnapshotForReport): string {
    return `${snapshot.org_name} - your Matrix report for ${periodLabel(snapshot.period)}`;
}
