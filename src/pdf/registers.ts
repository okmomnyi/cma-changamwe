import {
    CONTENT_WIDTH, MARGIN, MUTED, SUBTLE, INK, NAVY,
    drawLetterhead, fieldGrid, formatDate, formatMonth, kes, sectionHeading, table,
    type Column, type Doc,
} from './letterhead.js';

/** Drawn again at the top of every page after the first. */
function continuation(doc: Doc, title: string): void {
    doc.font('Helvetica').fontSize(7.5).fillColor(SUBTLE)
        .text(`${title} (continued)`, MARGIN, MARGIN - 16, { width: CONTENT_WIDTH });
}

function totals(doc: Doc, pairs: Array<[string, string]>, y: number): number {
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 34, 3).fill('#FBF5E9');
    const width = CONTENT_WIDTH / pairs.length;
    pairs.forEach(([label, value], i) => {
        const x = MARGIN + i * width + 10;
        doc.font('Helvetica').fontSize(7).fillColor(SUBTLE)
            .text(label.toUpperCase(), x, y + 7, { width: width - 20, characterSpacing: 0.5 });
        doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
            .text(value, x, y + 17, { width: width - 20 });
    });
    return y + 44;
}

export interface RosterRow {
    full_name: string;
    id_or_passport_no: string;
    mobile_no: string;
    prayer_house: string;
    jumuiya: string | null;
    marital_status: string;
    membership_status: string;
    current_offices: string | null;
    joined: string | null;
}

export function drawRoster(doc: Doc, orgName: string, rows: RosterRow[]): number {
    const title = 'Member Register';
    let y = drawLetterhead(doc, {
        documentId: '', orgName, title,
        subtitle: 'Every member on the register, with the prayer house they belong to and any office they hold.',
        subject: `${rows.length} members`,
    });

    const active = rows.filter((r) => r.membership_status === 'active').length;
    const houses = new Set(rows.map((r) => r.prayer_house)).size;
    y = totals(doc, [
        ['Members', String(rows.length)],
        ['Active', String(active)],
        ['Prayer houses', String(houses)],
        ['Holding office', String(rows.filter((r) => r.current_offices).length)],
    ], y);

    const columns: Column[] = [
        { header: 'Name', width: 132, strong: true },
        { header: 'ID number', width: 74 },
        { header: 'Mobile', width: 70 },
        { header: 'Prayer house', width: 92 },
        { header: 'Status', width: 52 },
        { header: 'Office', width: 67 },
    ];

    y = table(doc, columns, rows.map((r) => [
        r.full_name,
        r.id_or_passport_no,
        r.mobile_no,
        r.prayer_house,
        r.membership_status.replace(/_/g, ' '),
        (r.current_offices ?? '').replace(/_/g, ' '),
    ]), y, () => continuation(doc, title));

    return y;
}

export interface ContributionRow {
    date: string;
    full_name: string;
    prayer_house: string;
    category: string;
    amount: string;
    contribution_month: string | null;
    affiliation_year: number | null;
    event: string | null;
    recorded_by: string | null;
}

export function drawContributions(
    doc: Doc,
    orgName: string,
    rows: ContributionRow[],
    range: { from?: string; to?: string },
): number {
    const title = 'Statement of Matoleo';
    const span = range.from || range.to
        ? `${range.from ? formatDate(range.from) : 'the beginning'} to ${range.to ? formatDate(range.to) : 'today'}`
        : 'All contributions on record';

    let y = drawLetterhead(doc, {
        documentId: '', orgName, title,
        subtitle: 'Contributions received, in the order they were made.',
        subject: span,
    });

    const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const byCategory = new Map<string, number>();
    for (const r of rows) {
        byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + Number(r.amount || 0));
    }

    y = totals(doc, [
        ['Entries', String(rows.length)],
        ['Total received', kes(total)],
        ['Categories', String(byCategory.size)],
        ['Members', String(new Set(rows.map((r) => r.full_name)).size)],
    ], y);

    y = sectionHeading(doc, 'By category', y);
    const summary: Column[] = [
        { header: 'Category', width: 300 },
        { header: 'Amount', width: 187, align: 'right', strong: true },
    ];
    y = table(doc, summary,
        [...byCategory.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([category, amount]) => [category.replace(/_/g, ' '), kes(amount)]),
        y, () => continuation(doc, title));

    y += 12;
    y = sectionHeading(doc, 'Every entry', y);

    const columns: Column[] = [
        { header: 'Date', width: 60 },
        { header: 'Member', width: 122, strong: true },
        { header: 'Prayer house', width: 84 },
        { header: 'Category', width: 110 },
        { header: 'For', width: 51 },
        { header: 'Amount', width: 60, align: 'right' },
    ];

    y = table(doc, columns, rows.map((r) => [
        formatDate(r.date),
        r.full_name,
        r.prayer_house,
        r.category.replace(/_/g, ' '),
        r.contribution_month ? formatMonth(r.contribution_month) : (r.affiliation_year ? String(r.affiliation_year) : '-'),
        kes(r.amount),
    ]), y, () => continuation(doc, title));

    return y;
}

export interface MatrixSummaryRow {
    full_name: string;
    prayer_house: string;
    spirituality_score: string;
    financial_score: string;
    total_score: string;
    attainable_total: string;
    standing: string;
}

const STANDING_WORDS: Record<string, string> = {
    in_good_standing: 'In good standing',
    below_threshold: 'Below threshold',
    insufficient_history: 'Not enough history',
    ineligible_gate: 'Not eligible',
};

export function drawMatrixSummary(
    doc: Doc,
    orgName: string,
    period: string,
    rows: MatrixSummaryRow[],
): number {
    const title = 'Matrix Standing';
    let y = drawLetterhead(doc, {
        documentId: '', orgName, title,
        period: formatMonth(period),
        subject: `${formatMonth(period)}, ${rows.length} members`,
        subtitle: 'Scores as they stood when the month closed. Sixty points for spirituality, forty for financial obligation.',
    });

    const good = rows.filter((r) => r.standing === 'in_good_standing').length;
    const below = rows.filter((r) => r.standing === 'below_threshold').length;
    y = totals(doc, [
        ['Members', String(rows.length)],
        ['In good standing', String(good)],
        ['Below threshold', String(below)],
        ['Not yet eligible', String(rows.length - good - below)],
    ], y);

    const columns: Column[] = [
        { header: 'Member', width: 140, strong: true },
        { header: 'Prayer house', width: 95 },
        { header: 'Spirit.', width: 48, align: 'right' },
        { header: 'Financial', width: 52, align: 'right' },
        { header: 'Total', width: 46, align: 'right', strong: true },
        { header: 'Standing', width: 106 },
    ];

    y = table(doc, columns, rows.map((r) => [
        r.full_name,
        r.prayer_house,
        Number(r.spirituality_score).toFixed(1),
        Number(r.financial_score).toFixed(1),
        `${Number(r.total_score).toFixed(1)} / ${Number(r.attainable_total).toFixed(0)}`,
        STANDING_WORDS[r.standing] ?? r.standing.replace(/_/g, ' '),
    ]), y, () => continuation(doc, title));

    return y;
}

export interface WelfareRow {
    full_name: string;
    prayer_house: string;
    support_type: string;
    amount: string;
    status: string;
    period: string | null;
    standing_relied_on: string | null;
    subject_name: string | null;
    requested_at: string;
    paid_at: string | null;
    payment_reference: string | null;
    decided_by: string | null;
}

const SUPPORT_WORDS: Record<string, string> = {
    pre_wedding: 'Pre-wedding support',
    wedding_gift: 'Wedding gift',
    sickness_advance: 'Sickness advance',
    benevolent_member_spouse: 'Benevolent, member or spouse',
    benevolent_child: 'Benevolent, child',
    benevolent_parent: 'Benevolent, parent',
};

export function drawWelfare(doc: Doc, orgName: string, rows: WelfareRow[]): number {
    const title = 'Welfare Support';
    let y = drawLetterhead(doc, {
        documentId: '', orgName, title,
        subtitle: 'Support given under section 5.3 of the by-laws, and the standing each decision rested on.',
        subject: `${rows.length} claims on record`,
    });

    const paid = rows.filter((r) => r.status === 'paid');
    const paidTotal = paid.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    y = totals(doc, [
        ['Claims', String(rows.length)],
        ['Paid', String(paid.length)],
        ['Total paid', kes(paidTotal)],
        ['Awaiting a decision', String(rows.filter((r) => r.status === 'pending').length)],
    ], y);

    const columns: Column[] = [
        { header: 'Member', width: 116, strong: true },
        { header: 'Support', width: 118 },
        { header: 'Amount', width: 58, align: 'right' },
        { header: 'Month used', width: 66 },
        { header: 'Status', width: 52 },
        { header: 'Paid', width: 77 },
    ];

    y = table(doc, columns, rows.map((r) => [
        r.full_name,
        SUPPORT_WORDS[r.support_type] ?? r.support_type.replace(/_/g, ' '),
        kes(r.amount),
        r.period ? formatMonth(r.period) : '-',
        r.status === 'cancelled' ? 'withdrawn' : r.status,
        r.paid_at ? `${formatDate(r.paid_at)}${r.payment_reference ? `\n${r.payment_reference}` : ''}` : '-',
    ]), y, () => continuation(doc, title));

    if (rows.length > 0) {
        y += 10;
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
            .text('Eligibility rests on the member standing for a closed month, not on their score today, '
                + 'so every decision above can be re-checked against the figures that were on record at the time.',
                MARGIN, y, { width: CONTENT_WIDTH });
        y = doc.y;
    }

    return y;
}

export { fieldGrid, sectionHeading, NAVY };
