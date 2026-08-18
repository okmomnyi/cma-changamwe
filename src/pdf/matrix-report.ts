import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { NAIROBI } from '../util/time.js';
import { periodLabel, type SnapshotItem } from '../comms/report.js';
export interface MatrixReportInput {
    orgName: string;
    memberName: string;
    prayerHouse: string | null;
    period: string;
    asOf: string;
    source: 'live' | 'snapshot';
    spiritualityScore: number;
    financialScore: number;
    totalScore: number;
    attainableTotal: number;
    standing: string;
    gate: {
        passed: boolean;
        reasons: string[];
    };
    items: SnapshotItem[];
}
const NAVY = '#17324F';
const INK = '#1A1815';
const MUTED = '#6B645B';
const RULE = '#C4BEB5';
const GOOD = '#1A6340';
const WARN = '#855108';
const STANDING_TEXT: Record<string, string> = {
    in_good_standing: 'In good standing',
    below_threshold: 'Below the threshold',
    insufficient_history: 'Not enough history yet',
    ineligible_gate: 'Not currently eligible',
};
export async function renderMatrixReportPdf(input: MatrixReportInput): Promise<Buffer> {
    const doc = new PDFDocument({
        size: 'A4', margin: 50,
        info: { Title: `${input.memberName} - Matrix ${input.period}`, Author: input.orgName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(input.orgName, left, 50);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text(`Matrix report - ${periodLabel(input.period)}`, { width });
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(NAVY).lineWidth(1.5).stroke();
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(input.memberName, left);
    if (input.prayerHouse) {
        doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`${input.prayerHouse} prayer house`);
    }
    doc.moveDown(0.8);
    const standingColour = input.standing === 'in_good_standing' ? GOOD : WARN;
    const boxY = doc.y;
    doc.roundedRect(left, boxY, width, 62, 6).fillAndStroke('#F8F6F3', RULE);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('TOTAL SCORE', left + 14, boxY + 12);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY)
        .text(input.totalScore.toFixed(2), left + 14, boxY + 24);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text(`of ${input.attainableTotal.toFixed(0)} attainable`, left + 14, boxY + 47);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('SPIRITUALITY', left + 150, boxY + 12);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK)
        .text(input.spiritualityScore.toFixed(2), left + 150, boxY + 26);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('FINANCIAL', left + 250, boxY + 12);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK)
        .text(input.financialScore.toFixed(2), left + 250, boxY + 26);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('STANDING', left + 350, boxY + 12);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(standingColour)
        .text(STANDING_TEXT[input.standing] ?? input.standing, left + 350, boxY + 26, { width: width - 364 });
    doc.y = boxY + 78;
    if (!input.gate.passed) {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(WARN)
            .text('Before your standing can be assessed:', left);
        doc.font('Helvetica').fontSize(9.5).fillColor(INK);
        for (const reason of input.gate.reasons)
            doc.text(`  - ${reason}`, left);
        doc.moveDown(0.8);
    }
    const columns = {
        item: left, window: left + 150, count: left + 300, ratio: left + 360, score: left + 430,
    };
    const attainableOf = (items: SnapshotItem[]) => items.filter((i) => i.applied).reduce((sum, i) => sum + i.points, 0);
    const renderGroup = (title: string, items: SnapshotItem[], earned: number) => {
        if (items.length === 0)
            return;
        if (doc.y > doc.page.height - 170)
            doc.addPage();
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY)
            .text(`${title.toUpperCase()}  -  ${earned.toFixed(2)} of ${attainableOf(items).toFixed(0)}`, left);
        doc.moveDown(0.4);
        const headY = doc.y;
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
        doc.text('ITEM', columns.item, headY);
        doc.text('WINDOW', columns.window, headY);
        doc.text('COUNT', columns.count, headY);
        doc.text('RATIO', columns.ratio, headY);
        doc.text('POINTS', columns.score, headY, { width: right - columns.score, align: 'right' });
        doc.y = headY + 12;
        doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(RULE).lineWidth(0.5).stroke();
        doc.moveDown(0.3);
        for (const item of items) {
            if (doc.y > doc.page.height - 110)
                doc.addPage();
            const y = doc.y;
            doc.font('Helvetica').fontSize(9.5).fillColor(INK)
                .text(item.label, columns.item, y, { width: 145 });
            doc.fontSize(8).fillColor(MUTED).text(item.window, columns.window, y + 1, { width: 145 });
            if (!item.applied) {
                doc.fontSize(9).fillColor(MUTED)
                    .text('not applicable - nothing was held', columns.count, y, { width: right - columns.count });
            }
            else {
                doc.font('Helvetica').fontSize(9.5).fillColor(INK)
                    .text(`${item.count}/${item.total}`, columns.count, y);
                doc.text(item.ratio === null ? '-' : `${(item.ratio * 100).toFixed(0)}%`, columns.ratio, y);
                doc.font(item.threshold_met ? 'Helvetica' : 'Helvetica-Oblique')
                    .fillColor(item.threshold_met ? INK : WARN)
                    .text(`${item.score.toFixed(2)} / ${item.points.toFixed(0)}`, columns.score, y, { width: right - columns.score, align: 'right' });
            }
            doc.y = y + 20;
            doc.moveTo(left, doc.y - 5).lineTo(right, doc.y - 5)
                .strokeColor('#EFECE7').lineWidth(0.5).stroke();
        }
    };
    renderGroup('Spirituality', input.items.filter((i) => i.category === 'spirituality'), input.spiritualityScore);
    renderGroup('Financial', input.items.filter((i) => i.category === 'financial'), input.financialScore);
    doc.moveDown(0.8);
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text('Items in italics are below their guide percentage. A guide is a flag for follow-up, not a ' +
        'penalty: every item is scored proportionally.', left, doc.y, { width });
    const sourceNote = input.source === 'snapshot'
        ? `Snapshot for ${periodLabel(input.period)} - this is the figure that was emailed.`
        : `Live figures as at ${DateTime.fromISO(input.asOf, { zone: NAIROBI }).toFormat('d LLLL yyyy')}. A monthly snapshot may differ.`;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`${sourceNote}  Generated ${DateTime.now().setZone(NAIROBI).toFormat('d LLLL yyyy, HH:mm')} (Africa/Nairobi).`, left, doc.page.height - 62, { width, align: 'center' });
    doc.end();
    return done;
}
