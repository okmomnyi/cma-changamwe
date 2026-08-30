/**
 * Shared shapes for welfare support, under by-laws section 5.3.
 *
 * These live outside the page because a Next.js route file may only export its
 * default and a fixed set of framework names.
 */
export interface ClaimRow {
    id: string;
    support_type: string;
    amount: string;
    status: string;
    period: string | null;
    standing_relied_on: string | null;
    score_relied_on: string | null;
    subject_name: string | null;
    admitted_on: string | null;
    discharged_on: string | null;
    note: string | null;
    decision_note: string | null;
    requested_at: string;
    decided_at: string | null;
    paid_at: string | null;
    payment_reference: string | null;
    member_id: string;
    full_name: string;
    prayer_house: string;
    event_title: string | null;
    child_name: string | null;
    requested_by: string | null;
    decided_by: string | null;
    paid_by: string | null;
}

export const SUPPORT_LABELS: Record<string, string> = {
    pre_wedding: 'Pre-wedding support',
    wedding_gift: 'Wedding gift',
    sickness_advance: 'Sickness advance',
    benevolent_member_spouse: 'Benevolent, member or spouse',
    benevolent_child: 'Benevolent, child',
    benevolent_parent: 'Benevolent, parent',
};

export const SUPPORT_TYPES = [
    'pre_wedding', 'wedding_gift', 'sickness_advance',
    'benevolent_member_spouse', 'benevolent_child', 'benevolent_parent',
] as const;

/** The last twelve completed months, newest first. A snapshot only exists for
 *  a month that has ended, so the current one is never offered. */
export function completedPeriods(): string[] {
    const out: string[] = [];
    const now = new Date();
    for (let back = 1; back <= 12; back += 1) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return out;
}
