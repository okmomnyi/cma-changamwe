import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { NAIROBI } from '../util/time.js';
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
const NAVY = '#17324F';
const INK = '#1A1815';
const MUTED = '#6B645B';
const RULE = '#C4BEB5';
function value(input: string | number | null | undefined): string {
    if (input === null || input === undefined || input === '')
        return '-';
    return String(input);
}
function titleCase(input: string | null | undefined): string {
    if (!input)
        return '-';
    return input.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
function formatDate(value: string | Date | null | undefined): string {
    if (!value)
        return '-';
    const date = value instanceof Date
        ? DateTime.fromJSDate(value).setZone(NAIROBI)
        : DateTime.fromISO(value.length <= 10 ? `${value}T12:00:00` : value, { zone: NAIROBI });
    return date.isValid ? date.toFormat('d LLLL yyyy') : '-';
}
function formatDateTime(value: string | Date | null | undefined): string {
    if (!value)
        return '-';
    const date = value instanceof Date
        ? DateTime.fromJSDate(value).setZone(NAIROBI)
        : DateTime.fromISO(value, { zone: NAIROBI });
    return date.isValid ? date.toFormat("d LLLL yyyy 'at' HH:mm") : '-';
}
export async function renderBiodataPdf(input: {
    member: BiodataMember;
    children: BiodataChild[];
    orgName: string;
    photo?: Buffer | null;
}): Promise<Buffer> {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: { Title: `${input.member.full_name} - bio-data`, Author: input.orgName },
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
    const PHOTO_W = 90;
    const PHOTO_H = 110;
    const photoX = right - PHOTO_W;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16)
        .text(input.orgName, left, 50, { width: width - PHOTO_W - 16 });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text('Catholic Men Association - member bio-data', { width: width - PHOTO_W - 16 });
    if (input.photo) {
        try {
            doc.image(input.photo, photoX, 46, { fit: [PHOTO_W, PHOTO_H], align: 'center' });
            doc.rect(photoX, 46, PHOTO_W, PHOTO_H).strokeColor(RULE).lineWidth(0.75).stroke();
        }
        catch {
            doc.rect(photoX, 46, PHOTO_W, PHOTO_H).strokeColor(RULE).lineWidth(0.75).stroke();
        }
    }
    else {
        doc.rect(photoX, 46, PHOTO_W, PHOTO_H).dash(2, { space: 2 })
            .strokeColor(RULE).lineWidth(0.75).stroke().undash();
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
            .text('PHOTOGRAPH', photoX, 46 + PHOTO_H / 2 - 4, { width: PHOTO_W, align: 'center' });
    }
    doc.y = Math.max(doc.y, 46 + PHOTO_H) + 8;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(NAVY).lineWidth(1.5).stroke();
    doc.moveDown(1);
    const section = (title: string) => {
        if (doc.y > doc.page.height - 150)
            doc.addPage();
        doc.moveDown(0.5);
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10.5).text(title.toUpperCase(), left);
        doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(RULE).lineWidth(0.5).stroke();
        doc.moveDown(0.6);
    };
    const pair = (labelA: string, valueA: string, labelB?: string, valueB?: string) => {
        if (doc.y > doc.page.height - 110)
            doc.addPage();
        const y = doc.y;
        const half = width / 2;
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(labelA.toUpperCase(), left, y);
        doc.font('Helvetica').fontSize(10.5).fillColor(INK)
            .text(valueA, left, y + 10, { width: half - 12 });
        if (labelB !== undefined) {
            doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(labelB.toUpperCase(), left + half, y);
            doc.font('Helvetica').fontSize(10.5).fillColor(INK)
                .text(valueB ?? '-', left + half, y + 10, { width: half - 12 });
        }
        doc.y = y + 28;
    };
    const m = input.member;
    section('Personal details');
    pair('Full name', value(m.full_name), 'Year of birth', value(m.year_of_birth));
    pair('ID / passport number', value(m.id_or_passport_no), 'Mobile number', value(m.mobile_no));
    pair('Prayer house', value(m.prayer_house), 'Jumuiya', value(m.jumuiya));
    pair('Home parish / diocese', value(m.home_parish_diocese), 'Membership status', titleCase(m.membership_status));
    section('Family details');
    pair('Marital status', titleCase(m.marital_status), 'Spouse name', value(m.spouse_name));
    pair('Spouse status', titleCase(m.spouse_status), 'Father', titleCase(m.father_status));
    pair('Mother', titleCase(m.mother_status));
    section('Children');
    if (input.children.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('None recorded.', left);
        doc.moveDown(0.5);
    }
    else {
        const headerY = doc.y;
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
        doc.text('NAME', left, headerY);
        doc.text('DATE OF BIRTH', left + width / 2, headerY);
        doc.y = headerY + 14;
        for (const child of input.children) {
            if (doc.y > doc.page.height - 130)
                doc.addPage();
            const y = doc.y;
            doc.font('Helvetica').fontSize(10.5).fillColor(INK)
                .text(child.name, left, y, { width: width / 2 - 12 });
            doc.text(formatDate(child.date_of_birth), left + width / 2, y);
            doc.y = y + 17;
            doc.moveTo(left, doc.y - 4).lineTo(right, doc.y - 4)
                .strokeColor('#EFECE7').lineWidth(0.5).stroke();
        }
    }
    section('Next of kin');
    pair('Name', value(m.next_of_kin_name), 'ID number', value(m.next_of_kin_id_no));
    pair('Mobile number', value(m.next_of_kin_mobile));
    section('Declaration');
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text('The member declared that the information above is true and correct to the best of their ' +
        'knowledge, and that the profile is locked to further self-editing once submitted.', left, doc.y, { width });
    doc.moveDown(0.6);
    pair('Submitted on', formatDateTime(m.declaration_accepted_at ?? m.created_at));
    doc.moveDown(1.5);
    if (doc.y > doc.page.height - 140)
        doc.addPage();
    const signY = doc.y;
    const colWidth = (width - 30) / 2;
    for (const [index, role] of ['Chaplain', 'Parish moderator'].entries()) {
        const x = left + index * (colWidth + 30);
        doc.moveTo(x, signY + 26).lineTo(x + colWidth, signY + 26)
            .strokeColor(RULE).lineWidth(0.75).stroke();
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
            .text(`${role.toUpperCase()} - SIGNATURE AND DATE`, x, signY + 31, { width: colWidth });
    }
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Generated ${DateTime.now().setZone(NAIROBI).toFormat('d LLLL yyyy, HH:mm')} (Africa/Nairobi)`, left, doc.page.height - 60, { width, align: 'center' });
    doc.end();
    return done;
}
