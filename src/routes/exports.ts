import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../db/pool.js';
import { requireAuth, requireAdmin, principalOf } from '../middleware/auth.js';
import { reportDownloadLimiter } from '../middleware/rateLimit.js';
import { notFound } from '../util/errors.js';
import { loadMatrixConfig } from '../matrix/config.js';
import { evaluateMatrixForMember } from '../matrix/engine.js';
import { drawBiodata, drawMatrixReport, type BiodataMember } from '../pdf/member-documents.js';
import { todayNairobi } from '../util/time.js';
import { fetchPhotoBytes } from '../media/r2.js';
import { issueDocument } from '../documents/issue.js';
import { drawContributions, drawMatrixSummary, drawRoster, drawWelfare,
    type ContributionRow, type MatrixSummaryRow, type RosterRow, type WelfareRow } from '../pdf/registers.js';
import { previousPeriod } from '../util/time.js';
export const exportsRouter = Router();
exportsRouter.use(requireAuth);
function filename(name: string, suffix: string): string {
    const safe = name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `${safe || 'member'}-${suffix}`;
}
async function biodataFor(memberId: string) {
    const member = await queryOne<BiodataMember>(`SELECT m.full_name, m.year_of_birth, m.id_or_passport_no, m.mobile_no,
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
async function issueBiodata(memberId: string, issuedBy: string) {
    const data = await biodataFor(memberId);
    const issued = await issueDocument({
        kind: 'member_biodata',
        title: 'Member Bio-Data',
        orgName: data.orgName,
        subjectMemberId: memberId,
        subjectLabel: data.member.full_name,
        metadata: {
            member: data.member.full_name,
            prayer_house: data.member.prayer_house,
            children_listed: data.children.length,
            membership: data.member.membership_status,
        },
        issuedBy,
    }, (doc) => drawBiodata(doc, data));
    return { issued, name: filename(data.member.full_name, 'biodata.pdf') };
}

async function issueMatrixReport(memberId: string, period: string | undefined, issuedBy: string) {
    const data = await matrixReportFor(memberId, period);
    const issued = await issueDocument({
        kind: 'matrix_report',
        title: 'Matrix Report',
        orgName: data.orgName,
        subjectMemberId: memberId,
        subjectLabel: data.memberName,
        period: data.source === 'snapshot' ? data.period : null,
        metadata: {
            member: data.memberName,
            prayer_house: data.prayerHouse,
            standing: data.standing,
            score: `${data.totalScore.toFixed(2)} of ${data.attainableTotal.toFixed(0)}`,
            covering: data.source === 'snapshot' ? 'a closed month' : 'live figures',
        },
        issuedBy,
    }, (doc) => drawMatrixReport(doc, data));
    return { issued, name: filename(data.memberName, `matrix-${data.period}.pdf`) };
}

exportsRouter.get('/me/biodata.pdf', reportDownloadLimiter, async (req, res, next) => {
    try {
        const { memberId, userId } = principalOf(req);
        const { issued, name } = await issueBiodata(memberId, userId);
        sendIssued(res, issued.pdf, name, issued.documentId);
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/me/matrix.pdf', reportDownloadLimiter, async (req, res, next) => {
    try {
        const { memberId, userId } = principalOf(req);
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().parse(req.query.period);
        const { issued, name } = await issueMatrixReport(memberId, period, userId);
        sendIssued(res, issued.pdf, name, issued.documentId);
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/admin/members/:id/biodata.pdf', requireAdmin, reportDownloadLimiter, async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const { issued, name } = await issueBiodata(id, principalOf(req).userId);
        sendIssued(res, issued.pdf, name, issued.documentId);
    }
    catch (err) {
        next(err);
    }
});
exportsRouter.get('/admin/members/:id/matrix.pdf', requireAdmin, reportDownloadLimiter, async (req, res, next) => {
    try {
        const id = z.string().uuid().parse(req.params.id);
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().parse(req.query.period);
        const { issued, name } = await issueMatrixReport(id, period, principalOf(req).userId);
        sendIssued(res, issued.pdf, name, issued.documentId);
    }
    catch (err) {
        next(err);
    }
});

/**
 * Registers, as sealed PDFs. Each one is hashed and signed as it is made, and
 * can be checked afterwards by anyone holding the file.
 */
function sendIssued(res: Parameters<Parameters<typeof exportsRouter.get>[1]>[1], pdf: Buffer, name: string, documentId: string) {
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('content-length', String(pdf.length));
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-document-id', documentId);
    res.end(pdf);
}

const dated = (stem: string) => `cma-changamwe-${stem}-${todayNairobi()}.pdf`;

exportsRouter.get('/admin/exports/roster.pdf', requireAdmin, reportDownloadLimiter, async (req, res, next) => {
    try {
        const config = await loadMatrixConfig();
        const rows = await query<RosterRow>(`SELECT m.full_name, m.id_or_passport_no, m.mobile_no,
              ph.name AS prayer_house, m.jumuiya, m.marital_status, m.membership_status,
              (SELECT string_agg(ot.label, '; ' ORDER BY ot.sort_order)
                 FROM office_holders oh
                 LEFT JOIN office_types ot ON ot.office_key = oh.office_key
                WHERE oh.member_id = m.id AND oh.term_end IS NULL) AS current_offices,
              to_char(m.created_at, 'YYYY-MM-DD') AS joined
       FROM members m
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       ORDER BY ph.name, m.full_name`);

        const issued = await issueDocument({
            kind: 'member_roster',
            title: 'Member Register',
            orgName: config.org_name,
            subjectLabel: `${rows.rows.length} members`,
            metadata: { members: rows.rows.length, prayer_houses: new Set(rows.rows.map((r) => r.prayer_house)).size },
            issuedBy: principalOf(req).userId,
        }, (doc) => drawRoster(doc, config.org_name, rows.rows));

        sendIssued(res, issued.pdf, dated('member-register'), issued.documentId);
    }
    catch (err) {
        next(err);
    }
});

exportsRouter.get('/admin/exports/matrix.pdf', requireAdmin, reportDownloadLimiter, async (req, res, next) => {
    try {
        const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()
            .parse(req.query.period) ?? previousPeriod();
        const config = await loadMatrixConfig();

        const rows = await query<MatrixSummaryRow>(`SELECT m.full_name, ph.name AS prayer_house,
              s.spirituality_score::text, s.financial_score::text, s.total_score::text,
              s.attainable_total::text, s.standing
       FROM matrix_scores s
       JOIN members m ON m.id = s.member_id
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       WHERE s.period = $1
       ORDER BY s.total_score DESC`, [period]);

        if (rows.rows.length === 0) {
            throw notFound(`No standing has been recorded for ${period}. Close the month from the Matrix screen first.`);
        }

        const issued = await issueDocument({
            kind: 'matrix_summary',
            title: 'Matrix Standing',
            orgName: config.org_name,
            period,
            subjectLabel: `${rows.rows.length} members`,
            metadata: {
                members: rows.rows.length,
                month: period,
                in_good_standing: rows.rows.filter((r) => r.standing === 'in_good_standing').length,
            },
            issuedBy: principalOf(req).userId,
        }, (doc) => drawMatrixSummary(doc, config.org_name, period, rows.rows));

        sendIssued(res, issued.pdf, dated(`matrix-${period}`), issued.documentId);
    }
    catch (err) {
        next(err);
    }
});

exportsRouter.get('/admin/exports/contributions.pdf', requireAdmin, reportDownloadLimiter, async (req, res, next) => {
    try {
        const filters = z.object({
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }).parse(req.query);
        const config = await loadMatrixConfig();

        const rows = await query<ContributionRow>(`SELECT to_char(c.date, 'YYYY-MM-DD') AS date,
              m.full_name, ph.name AS prayer_house, c.category::text, c.amount::text,
              to_char(c.contribution_month, 'YYYY-MM') AS contribution_month,
              c.affiliation_year, e.title AS event, u.username AS recorded_by
       FROM contributions c
       JOIN members m ON m.id = c.member_id
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN events e ON e.id = c.event_id
       LEFT JOIN users u ON u.id = c.recorded_by
       WHERE ($1::date IS NULL OR c.date >= $1) AND ($2::date IS NULL OR c.date <= $2)
       ORDER BY c.date DESC, m.full_name`, [filters.from ?? null, filters.to ?? null]);

        const issued = await issueDocument({
            kind: 'contributions_statement',
            title: 'Statement of Matoleo',
            orgName: config.org_name,
            subjectLabel: filters.from || filters.to
                ? `${filters.from ?? 'the beginning'} to ${filters.to ?? 'today'}`
                : 'All contributions',
            metadata: {
                entries: rows.rows.length,
                total: rows.rows.reduce((sum, r) => sum + Number(r.amount || 0), 0),
                from: filters.from ?? null,
                to: filters.to ?? null,
            },
            issuedBy: principalOf(req).userId,
        }, (doc) => drawContributions(doc, config.org_name, rows.rows, filters));

        sendIssued(res, issued.pdf, dated('matoleo'), issued.documentId);
    }
    catch (err) {
        next(err);
    }
});

exportsRouter.get('/admin/exports/welfare.pdf', requireAdmin, reportDownloadLimiter, async (req, res, next) => {
    try {
        const config = await loadMatrixConfig();
        const rows = await query<WelfareRow>(`SELECT m.full_name, ph.name AS prayer_house,
              c.support_type::text, c.amount::text, c.status::text, c.period,
              c.standing_relied_on::text, c.subject_name,
              c.requested_at::text, c.paid_at::text, c.payment_reference,
              du.username AS decided_by
       FROM welfare_claims c
       JOIN members m ON m.id = c.member_id
       JOIN prayer_houses ph ON ph.id = m.prayer_house_id
       LEFT JOIN users du ON du.id = c.decided_by
       ORDER BY c.requested_at DESC`);

        const issued = await issueDocument({
            kind: 'welfare_statement',
            title: 'Welfare Support',
            orgName: config.org_name,
            subjectLabel: `${rows.rows.length} claims`,
            metadata: {
                claims: rows.rows.length,
                paid: rows.rows.filter((r) => r.status === 'paid').length,
                paid_total: rows.rows.filter((r) => r.status === 'paid')
                    .reduce((sum, r) => sum + Number(r.amount || 0), 0),
            },
            issuedBy: principalOf(req).userId,
        }, (doc) => drawWelfare(doc, config.org_name, rows.rows));

        sendIssued(res, issued.pdf, dated('welfare'), issued.documentId);
    }
    catch (err) {
        next(err);
    }
});
