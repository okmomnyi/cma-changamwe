import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { loadMatrixConfig } from '../src/matrix/config.js';
import { issueDocument } from '../src/documents/issue.js';
import { drawBiodata, drawMatrixReport, type BiodataMember } from '../src/pdf/member-documents.js';
import {
    drawContributions, drawMatrixSummary, drawRoster, drawWelfare,
    type ContributionRow, type MatrixSummaryRow, type RosterRow, type WelfareRow,
} from '../src/pdf/registers.js';
import { evaluateMatrixForMember } from '../src/matrix/engine.js';
import { previousPeriod } from '../src/util/time.js';

/**
 * Renders one of each kind and reports how close the lowest ink sits to the
 * foot of the sheet, on A4 and on the shorter US Letter.
 */
const out = process.env.OUT ?? '.';

try {
    const config = await loadMatrixConfig();
    const org = config.org_name;
    const made: Array<{ kind: string; file: string }> = [];

    const member = await queryOne<BiodataMember & { id: string }>(
        `SELECT m.id, m.full_name, m.year_of_birth, m.id_or_passport_no, m.mobile_no,
                m.home_parish_diocese, m.jumuiya, ph.name AS prayer_house, m.marital_status,
                m.spouse_name, m.spouse_status, m.father_status, m.mother_status,
                m.next_of_kin_name, m.next_of_kin_id_no, m.next_of_kin_mobile,
                m.membership_status, m.declaration_accepted_at, m.created_at
           FROM members m JOIN prayer_houses ph ON ph.id = m.prayer_house_id
          WHERE m.id_or_passport_no = 'DEMO-0001'`);
    const children = await query<{ name: string; date_of_birth: string | null }>(
        `SELECT name, date_of_birth::text FROM children WHERE member_id = $1`, [member!.id]);

    const bio = await issueDocument({
        kind: 'member_biodata', title: 'Member Bio-Data', orgName: org,
        subjectMemberId: member!.id, subjectLabel: member!.full_name, metadata: {},
    }, (d) => drawBiodata(d, { member: member!, children: children.rows, orgName: org, photo: null }));
    writeFileSync(`${out}/check-biodata.pdf`, bio.pdf);
    made.push({ kind: 'member_biodata', file: 'check-biodata.pdf' });

    const live = await evaluateMatrixForMember(member!.id);
    const report = await issueDocument({
        kind: 'matrix_report', title: 'Matrix Report', orgName: org,
        subjectMemberId: member!.id, subjectLabel: member!.full_name, metadata: {},
    }, (d) => drawMatrixReport(d, {
        orgName: org, memberName: member!.full_name, prayerHouse: member!.prayer_house!,
        period: live!.period, asOf: live!.as_of, source: 'live',
        spiritualityScore: live!.spirituality_score, financialScore: live!.financial_score,
        totalScore: live!.total_score, attainableTotal: live!.attainable_total,
        standing: live!.standing, gate: live!.gate, items: live!.items as never[],
    }));
    writeFileSync(`${out}/check-matrix-report.pdf`, report.pdf);
    made.push({ kind: 'matrix_report', file: 'check-matrix-report.pdf' });

    const roster = await query<RosterRow>(`SELECT m.full_name, m.id_or_passport_no, m.mobile_no,
          ph.name AS prayer_house, m.jumuiya, m.marital_status, m.membership_status,
          (SELECT string_agg(ot.label, '; ' ORDER BY ot.sort_order) FROM office_holders oh
             LEFT JOIN office_types ot ON ot.office_key = oh.office_key
            WHERE oh.member_id = m.id AND oh.term_end IS NULL) AS current_offices,
          to_char(m.created_at, 'YYYY-MM-DD') AS joined
     FROM members m JOIN prayer_houses ph ON ph.id = m.prayer_house_id
     ORDER BY ph.name, m.full_name`);
    const reg = await issueDocument({
        kind: 'member_roster', title: 'Member Register', orgName: org, metadata: {},
    }, (d) => drawRoster(d, org, roster.rows));
    writeFileSync(`${out}/check-register.pdf`, reg.pdf);
    made.push({ kind: 'member_roster', file: 'check-register.pdf' });

    const cons = await query<ContributionRow>(`SELECT to_char(c.date,'YYYY-MM-DD') AS date,
          m.full_name, ph.name AS prayer_house, c.category::text, c.amount::text,
          to_char(c.contribution_month,'YYYY-MM') AS contribution_month,
          c.affiliation_year, e.title AS event, u.username AS recorded_by
     FROM contributions c JOIN members m ON m.id=c.member_id
     JOIN prayer_houses ph ON ph.id=m.prayer_house_id
     LEFT JOIN events e ON e.id=c.event_id LEFT JOIN users u ON u.id=c.recorded_by
     ORDER BY c.date DESC, m.full_name`);
    const con = await issueDocument({
        kind: 'contributions_statement', title: 'Statement of Matoleo', orgName: org, metadata: {},
    }, (d) => drawContributions(d, org, cons.rows, {}));
    writeFileSync(`${out}/check-matoleo.pdf`, con.pdf);
    made.push({ kind: 'contributions_statement', file: 'check-matoleo.pdf' });

    const period = previousPeriod();
    const scores = await query<MatrixSummaryRow>(`SELECT m.full_name, ph.name AS prayer_house,
          s.spirituality_score::text, s.financial_score::text, s.total_score::text,
          s.attainable_total::text, s.standing
     FROM matrix_scores s JOIN members m ON m.id=s.member_id
     JOIN prayer_houses ph ON ph.id=m.prayer_house_id
     WHERE s.period=$1 ORDER BY s.total_score DESC`, [period]);
    if (scores.rows.length > 0) {
        const sum = await issueDocument({
            kind: 'matrix_summary', title: 'Matrix Standing', orgName: org, period, metadata: {},
        }, (d) => drawMatrixSummary(d, org, period, scores.rows));
        writeFileSync(`${out}/check-standing.pdf`, sum.pdf);
        made.push({ kind: 'matrix_summary', file: 'check-standing.pdf' });
    }

    const claims = await query<WelfareRow>(`SELECT m.full_name, ph.name AS prayer_house,
          c.support_type::text, c.amount::text, c.status::text, c.period,
          c.standing_relied_on::text, c.subject_name, c.requested_at::text,
          c.paid_at::text, c.payment_reference, du.username AS decided_by
     FROM welfare_claims c JOIN members m ON m.id=c.member_id
     JOIN prayer_houses ph ON ph.id=m.prayer_house_id
     LEFT JOIN users du ON du.id=c.decided_by ORDER BY c.requested_at DESC`);
    const wel = await issueDocument({
        kind: 'welfare_statement', title: 'Welfare Support', orgName: org, metadata: {},
    }, (d) => drawWelfare(d, org, claims.rows));
    writeFileSync(`${out}/check-welfare.pdf`, wel.pdf);
    made.push({ kind: 'welfare_statement', file: 'check-welfare.pdf' });

    console.log(JSON.stringify(made));
}
finally {
    await closePool();
}
