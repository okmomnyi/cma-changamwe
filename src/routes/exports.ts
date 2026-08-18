import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { requireAuth, requireAdmin, principalOf } from '../middleware/auth.js';
import { reportDownloadLimiter } from '../middleware/rateLimit.js';
import { notFound } from '../util/errors.js';
import { loadMatrixConfig } from '../matrix/config.js';
import { evaluateMatrixForMember } from '../matrix/engine.js';
import { renderBiodataPdf } from '../pdf/biodata.js';
import { renderMatrixReportPdf } from '../pdf/matrix-report.js';
import { currentPeriod } from '../util/time.js';
import { fetchPhotoBytes } from '../media/r2.js';
export const exportsRouter = Router();
exportsRouter.use(requireAuth);
function filename(name: string, suffix: string): string {
    const safe = name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `${safe || 'member'}-${suffix}`;
}
async function biodataFor(memberId: string) {
    const member = await queryOne<Parameters<typeof renderBiodataPdf>[0]['member']>(`SELECT m.full_name, m.year_of_birth, m.id_or_passport_no, m.mobile_no,
            m.home_parish_diocese, m.jumuiya, ph.name AS prayer_house, m.marital_status,
            m.spouse_name, m.spouse_status, m.father_status, m.mother_status,
            m.next_of_kin_name, m.next_of_kin_id_no, m.next_of_kin_mobile,
            m.membership_status, m.declaration_accepted_at, m.created_at
     FROM members m JOIN prayer_houses ph ON ph.id = m.prayer_house_id
     WHERE m.id = $1`, [memberId]);
    if (!member)
        throw notFound('That member could not be found.');
    const children = await query<{
        name: string;
        date_of_birth: string | null;
    }>(`SELECT name, date_of_birth::text FROM children WHERE member_id = $1
     ORDER BY date_of_birth NULLS LAST, name`, [memberId]);
    const stored = await queryOne<{
        object_key: string;
    }>(`SELECT object_key FROM member_photos WHERE member_id = $1`, [memberId]);
    const photo = stored ? await fetchPhotoBytes(stored.object_key) : null;
    const config = await loadMatrixConfig();
    return {
        member,
        children: children.rows,
        orgName: config.org_name,
        photo,
    };
}
async function matrixReportFor(memberId: string, period?: string) {
    const config = await loadMatrixConfig();
    const member = await queryOne<{
        full_name: string;
        prayer_house: string;
    }>(`SELECT m.full_name, ph.name AS prayer_house FROM members m
     JOIN prayer_houses ph ON ph.id = m.prayer_house_id WHERE m.id = $1`, [memberId]);
    if (!member)
        throw notFound('That member could not be found.');
    if (period) {
        const snapshot = await queryOne<{
            period: string;
            spirituality_score: string;
            financial_score: string;
            total_score: string;
            attainable_total: string;
            standing: string;
            breakdown_json: {
                items?: [
                ];
                gate?: {
                    passed: boolean;
                    reasons: string[];
                };
                as_of?: string;
            };
            generated_at: string;
        }>(`SELECT period, spirituality_score::text, financial_score::text, total_score::text,
              attainable_total::text, standing, breakdown_json, generated_at::text
       FROM matrix_scores WHERE member_id = $1 AND period = $2`, [memberId, period]);
        if (!snapshot)
            throw notFound('There is no report for that period.');
        return {
            orgName: config.org_name,
            memberName: member.full_name,
            prayerHouse: member.prayer_house,
            period: snapshot.period,
            asOf: snapshot.breakdown_json?.as_of ?? snapshot.generated_at.slice(0, 10),
            source: 'snapshot' as const,
            spiritualityScore: Number(snapshot.spirituality_score),
            financialScore: Number(snapshot.financial_score),
            totalScore: Number(snapshot.total_score),
            attainableTotal: Number(snapshot.attainable_total),
            standing: snapshot.standing,
            gate: snapshot.breakdown_json?.gate ?? { passed: true, reasons: [] },
            items: (snapshot.breakdown_json?.items ?? []) as never[],
        };
    }
    const live = await evaluateMatrixForMember(memberId);
    if (!live)
        throw notFound('That member could not be found.');
    return {
        orgName: config.org_name,
        memberName: member.full_name,
        prayerHouse: member.prayer_house,
        period: live.period,
        asOf: live.as_of,
        source: 'live' as const,
        spiritualityScore: live.spirituality_score,
        financialScore: live.financial_score,
        totalScore: live.total_score,
        attainableTotal: live.attainable_total,
        standing: live.standing,
        gate: live.gate,
        items: live.items as never[],
    };
}
function sendPdf(res: Parameters<Parameters<typeof exportsRouter.get>[1]>[1], pdf: Buffer, name: string) {
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('content-length', String(pdf.length));
    res.setHeader('cache-control', 'private, no-store');
    res.end(pdf);
}
exportsRouter.get('/me/biodata.pdf', reportDownloadLimiter, async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const data = await biodataFor(memberId);
        const pdf = await renderBiodataPdf(data);
        sendPdf(res, pdf, filename(data.member.full_name, 'biodata.pdf'));
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/me/matrix.pdf', reportDownloadLimiter, async (req, res, next) => {
    try {
        const { memberId } = principalOf(req);
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().parse(req.query.period);
        const data = await matrixReportFor(memberId, period);
        const pdf = await renderMatrixReportPdf(data);
        sendPdf(res, pdf, filename(data.memberName, `matrix-${data.period}.pdf`));
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/admin/members/:id/biodata.pdf', requireAdmin, async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const data = await biodataFor(id);
        const pdf = await renderBiodataPdf(data);
        sendPdf(res, pdf, filename(data.member.full_name, 'biodata.pdf'));
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/admin/members/:id/matrix.pdf', requireAdmin, async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().parse(req.query.period);
        const data = await matrixReportFor(id, period);
        const pdf = await renderMatrixReportPdf(data);
        sendPdf(res, pdf, filename(data.memberName, `matrix-${data.period}.pdf`));
    }
    catch (err) {
        next(err);
    }
});
function csvCell(input: unknown): string {
    if (input === null || input === undefined)
        return '';
    const text = String(input);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csvRows(rows: Array<Record<string, unknown>>, columns: string[]): string {
    const lines = [columns.map(csvCell).join(',')];
    for (const row of rows)
        lines.push(columns.map((c) => csvCell(row[c])).join(','));
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}
function sendCsv(res: Parameters<Parameters<typeof exportsRouter.get>[1]>[1], csv: string, name: string) {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.end(csv);
}
exportsRouter.get('/admin/exports/roster.csv', requireAdmin, async (_req, res, next) => {
    try {
        const rows = await query(`SELECT m.full_name, m.year_of_birth, m.id_or_passport_no, m.mobile_no,
              ph.name AS prayer_house, m.jumuiya, m.home_parish_diocese,
              m.marital_status, m.spouse_name, m.spouse_status,
              m.father_status, m.mother_status,
              m.next_of_kin_name, m.next_of_kin_id_no, m.next_of_kin_mobile,
              m.membership_status, m.profile_locked,
              u.username, u.email,
              (SELECT count(*) FROM children c WHERE c.member_id = m.id)::int AS children,
              (SELECT string_agg(oh.office_key, '; ' ORDER BY oh.office_key)
                 FROM office_holders oh
                WHERE oh.member_id = m.id AND oh.term_end IS NULL) AS current_offices,
              to_char(m.declaration_accepted_at, 'YYYY-MM-DD') AS declaration_accepted,
              to_char(m.created_at, 'YYYY-MM-DD') AS joined
       FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN users u ON u.member_id = m.id
       ORDER BY ph.name, m.full_name`);
        const csv = csvRows(rows.rows, [
            'full_name', 'year_of_birth', 'id_or_passport_no', 'mobile_no', 'prayer_house',
            'jumuiya', 'home_parish_diocese', 'marital_status', 'spouse_name', 'spouse_status',
            'father_status', 'mother_status', 'next_of_kin_name', 'next_of_kin_id_no',
            'next_of_kin_mobile', 'membership_status', 'profile_locked', 'username', 'email',
            'children', 'current_offices', 'declaration_accepted', 'joined',
        ]);
        sendCsv(res, csv, `cma-changamwe-roster-${new Date().toISOString().slice(0, 10)}.csv`);
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/admin/exports/matrix.csv', requireAdmin, async (req, res, next) => {
    try {
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
            .parse(req.query.period) ?? currentPeriod();
        const rows = await query(`SELECT m.full_name, ph.name AS prayer_house, s.period,
              round(s.spirituality_score, 4) AS spirituality_score,
              round(s.financial_score, 4) AS financial_score,
              round(s.total_score, 4) AS total_score,
              round(s.attainable_total, 2) AS attainable_total,
              s.standing, s.email_status,
              to_char(s.generated_at, 'YYYY-MM-DD HH24:MI') AS generated_at
       FROM matrix_scores s
       JOIN members m ON m.id = s.member_id
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       WHERE s.period = $1
       ORDER BY s.total_score DESC`, [period]);
        const csv = csvRows(rows.rows, [
            'full_name', 'prayer_house', 'period', 'spirituality_score', 'financial_score',
            'total_score', 'attainable_total', 'standing', 'email_status', 'generated_at',
        ]);
        sendCsv(res, csv, `cma-changamwe-matrix-${period}.csv`);
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/admin/exports/contributions.csv', requireAdmin, async (req, res, next) => {
    try {
        const filters = z.object({
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }).parse(req.query);
        const rows = await query(`SELECT to_char(c.date, 'YYYY-MM-DD') AS date, m.full_name, ph.name AS prayer_house,
              c.category, c.amount,
              to_char(c.contribution_month, 'YYYY-MM') AS contribution_month,
              c.affiliation_year, e.title AS event, c.note,
              u.username AS recorded_by,
              to_char(c.recorded_at, 'YYYY-MM-DD HH24:MI') AS recorded_at
       FROM contributions c
       JOIN members m ON m.id = c.member_id
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN users u ON u.id = c.recorded_by
       WHERE ($1::date IS NULL OR c.date >= $1) AND ($2::date IS NULL OR c.date <= $2)
       ORDER BY c.date DESC, m.full_name`, [filters.from ?? null, filters.to ?? null]);
        const csv = csvRows(rows.rows, [
            'date', 'full_name', 'prayer_house', 'category', 'amount', 'contribution_month',
            'affiliation_year', 'event', 'note', 'recorded_by', 'recorded_at',
        ]);
        sendCsv(res, csv, `cma-changamwe-contributions-${new Date().toISOString().slice(0, 10)}.csv`);
    }
    catch (err) {
        next(err);
    }
});
