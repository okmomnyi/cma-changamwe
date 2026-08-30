import {
    CONTENT_WIDTH, HAIRLINE, INK, MARGIN, MUTED, NAVY, RULE, SUBTLE,
    drawLetterhead, fieldGrid, formatDate, formatMonth, sectionHeading, table,
    type Column, type Doc,
} from './letterhead.js';

function titleCase(input: string | null | undefined): string {
    if (!input) return '-';
    return input.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function value(input: string | number | null | undefined): string {
    if (input === null || input === undefined || input === '') return '-';
    return String(input);
}

export interface BiodataMember {
    full_name: string;
    year_of_birth: number | null;
    id_or_passport_no: string | null;
    mobile_no: string | null;
    home_parish_diocese: string | null;
    jumuiya: string | null;
    prayer_house: string | null;
    marital_status: string | null;
    spouse_name: string | null;
    spouse_status: string | null;
    father_status: string | null;
    mother_status: string | null;
    next_of_kin_name: string | null;
    next_of_kin_id_no: string | null;
    next_of_kin_mobile: string | null;
    membership_status: string | null;
    declaration_accepted_at: string | Date | null;
    created_at: string | Date | null;
}

export interface BiodataChild {
    name: string;
    date_of_birth: string | null;
}

export function drawBiodata(doc: Doc, data: {
    member: BiodataMember;
    children: BiodataChild[];
    orgName: string;
    photo: Buffer | null;
}): number {
    const { member, children, photo } = data;

    let y = drawLetterhead(doc, {
        documentId: '', orgName: data.orgName,
        title: 'Member Bio-Data',
        subject: member.full_name,
        subtitle: `${value(member.prayer_house)} prayer house  ·  Commissioned ${formatDate(member.created_at)}`,
    });

    // The photograph sits to the right of the first block, if there is one.
    const photoWidth = 84;
    const photoHeight = 84;
    let textWidth = CONTENT_WIDTH;
    if (photo) {
        try {
            doc.image(photo, MARGIN + CONTENT_WIDTH - photoWidth, y, {
                fit: [photoWidth, photoHeight], align: 'center', valign: 'center',
            });
            doc.rect(MARGIN + CONTENT_WIDTH - photoWidth, y, photoWidth, photoHeight)
                .lineWidth(0.6).strokeColor(RULE).stroke();
            textWidth = CONTENT_WIDTH - photoWidth - 16;
        }
        catch {
            // A photograph that will not decode must not stop the document.
        }
    }

    const startY = y;
    y = sectionHeading(doc, 'Personal', y);
    y = fieldGrid(doc, [
        ['Full name', value(member.full_name)],
        ['Year of birth', value(member.year_of_birth)],
        ['ID or passport number', value(member.id_or_passport_no)],
        ['Mobile number', value(member.mobile_no)],
    ], y, textWidth === CONTENT_WIDTH ? 2 : 1);

    if (photo) y = Math.max(y, startY + photoHeight + 12);

    y = sectionHeading(doc, 'Membership', y + 4);
    y = fieldGrid(doc, [
        ['Prayer house', value(member.prayer_house)],
        ['Jumuiya', value(member.jumuiya)],
        ['Home parish or diocese', value(member.home_parish_diocese)],
        ['Membership', titleCase(member.membership_status)],
    ], y);

    y = sectionHeading(doc, 'Family', y + 4);
    y = fieldGrid(doc, [
        ['Marital status', titleCase(member.marital_status)],
        ['Spouse name', value(member.spouse_name)],
        ['Spouse', titleCase(member.spouse_status)],
        ['Father', titleCase(member.father_status)],
        ['Mother', titleCase(member.mother_status)],
    ], y);

    y = sectionHeading(doc, 'Children', y + 4);
    if (children.length === 0) {
        doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
            .text('None recorded.', MARGIN, y, { width: CONTENT_WIDTH });
        y = doc.y + 8;
    }
    else {
        const columns: Column[] = [
            { header: 'Name', width: 320, strong: true },
            { header: 'Date of birth', width: 167 },
        ];
        y = table(doc, columns, children.map((c) => [c.name, formatDate(c.date_of_birth)]), y);
        y += 6;
    }

    y = sectionHeading(doc, 'Next of kin', y + 4);
    y = fieldGrid(doc, [
        ['Name', value(member.next_of_kin_name)],
        ['Mobile number', value(member.next_of_kin_mobile)],
        ['ID number', value(member.next_of_kin_id_no)],
    ], y);

    y = sectionHeading(doc, 'Declaration', y + 4);
    doc.font('Helvetica').fontSize(9).fillColor(INK)
        .text('The member confirms the details above are true, and undertakes to observe the '
            + 'constitution of the Catholic Men Association and the governing by-laws of this parish.',
            MARGIN, y, { width: CONTENT_WIDTH });
    y = doc.y + 8;
    y = fieldGrid(doc, [
        ['Accepted on', formatDate(member.declaration_accepted_at ?? member.created_at)],
        ['On the register since', formatDate(member.created_at)],
    ], y);

    // Space for a wet signature, which the parish still asks for.
    y += 8;
    const half = (CONTENT_WIDTH - 30) / 2;
    doc.moveTo(MARGIN, y + 24).lineTo(MARGIN + half, y + 24)
        .lineWidth(0.6).strokeColor(RULE).stroke();
    doc.moveTo(MARGIN + half + 30, y + 24).lineTo(MARGIN + CONTENT_WIDTH, y + 24)
        .lineWidth(0.6).strokeColor(RULE).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(SUBTLE)
        .text('MEMBER SIGNATURE', MARGIN, y + 28, { width: half, characterSpacing: 0.5 });
    doc.text('SECRETARY OR COORDINATOR', MARGIN + half + 30, y + 28, { width: half, characterSpacing: 0.5 });

    return y + 44;
}

export interface MatrixItem {
    label: string;
    category: string;
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

export interface MatrixReportData {
    orgName: string;
    memberName: string;
    prayerHouse: string;
    period: string;
    asOf: string;
    source: 'snapshot' | 'live';
    spiritualityScore: number;
    financialScore: number;
    totalScore: number;
    attainableTotal: number;
    standing: string;
    gate: { passed: boolean; reasons: string[] };
    items: MatrixItem[];
}

const STANDING_WORDS: Record<string, string> = {
    in_good_standing: 'In good standing',
    below_threshold: 'Below the threshold',
    insufficient_history: 'Not enough history yet',
    ineligible_gate: 'Not currently eligible',
};

const STANDING_NOTE: Record<string, string> = {
    in_good_standing: 'You meet the requirements for welfare support. Asante for your participation.',
    below_threshold: 'Your score is below the threshold for welfare support. The breakdown below shows where the points were lost.',
    insufficient_history: 'There is not yet enough recorded history to judge your standing. This settles on its own as the association holds more events.',
    ineligible_gate: 'Your standing cannot be assessed until the requirements below are met.',
};

export function drawMatrixReport(doc: Doc, data: MatrixReportData): number {
    let y = drawLetterhead(doc, {
        documentId: '', orgName: data.orgName,
        title: 'Matrix Report',
        period: formatMonth(data.period),
        subject: data.memberName,
        subtitle: `${data.prayerHouse} prayer house  ·  ${data.source === 'snapshot'
            ? `As the month closed on ${formatDate(data.asOf)}`
            : `Live figures as at ${formatDate(data.asOf)}`}`,
    });

    // The standing, stated plainly before any arithmetic.
    const boxHeight = 62;
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, boxHeight, 4).fill('#FBF5E9');
    doc.font('Helvetica').fontSize(7).fillColor(SUBTLE)
        .text('YOUR STANDING', MARGIN + 14, y + 11, { characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY)
        .text(STANDING_WORDS[data.standing] ?? data.standing, MARGIN + 14, y + 22);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY)
        .text(`${data.totalScore.toFixed(1)}`, MARGIN, y + 16, { width: CONTENT_WIDTH - 16, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(`out of ${data.attainableTotal.toFixed(0)}`, MARGIN, y + 40, { width: CONTENT_WIDTH - 16, align: 'right' });
    y += boxHeight + 10;

    doc.font('Helvetica').fontSize(9).fillColor(INK)
        .text(STANDING_NOTE[data.standing] ?? '', MARGIN, y, { width: CONTENT_WIDTH });
    y = doc.y + 12;

    if (!data.gate.passed && data.gate.reasons.length > 0) {
        y = sectionHeading(doc, 'Before the Matrix is read', y);
        for (const reason of data.gate.reasons) {
            doc.font('Helvetica').fontSize(9).fillColor(INK)
                .text(`•  ${reason}`, MARGIN + 4, y, { width: CONTENT_WIDTH - 8 });
            y = doc.y + 3;
        }
        y += 8;
    }

    y = sectionHeading(doc, 'Spirituality, 60 points', y);
    y = itemTable(doc, data.items.filter((i) => i.category === 'spirituality'), y, data.spiritualityScore);

    y = sectionHeading(doc, 'Financial, 40 points', y + 8);
    y = itemTable(doc, data.items.filter((i) => i.category === 'financial'), y, data.financialScore);

    y += 8;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text('Each item scores in proportion to what you attended or paid: the count divided by the '
            + 'total, multiplied by the points. The minimum percentage is a flag for follow-up, not a '
            + 'cut-off, so an item below it still earns its share. An item with no total is one where '
            + 'nothing was held since you joined, and it is left out of the reckoning entirely.',
            MARGIN, y, { width: CONTENT_WIDTH });

    return doc.y;
}

function itemTable(doc: Doc, items: MatrixItem[], y: number, subtotal: number): number {
    const columns: Column[] = [
        { header: 'Item', width: 118, strong: true },
        { header: 'Period', width: 128 },
        { header: 'You', width: 42, align: 'right' },
        { header: 'Held', width: 42, align: 'right' },
        { header: 'Share', width: 48, align: 'right' },
        { header: 'Points', width: 49, align: 'right' },
    ];

    const rows = items.map((i) => [
        i.label,
        i.window,
        i.applied ? String(i.count) : '-',
        i.applied ? String(i.total) : 'none held',
        i.ratio === null ? '-' : `${Math.round(i.ratio * 100)}%`,
        `${i.score.toFixed(2)} / ${i.points}`,
    ]);

    let out = table(doc, columns, rows, y);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
        .text(`Subtotal  ${subtotal.toFixed(2)}`, MARGIN, out + 2, {
            width: CONTENT_WIDTH, align: 'right',
        });
    return doc.y + 4;
}
