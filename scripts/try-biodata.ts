import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { closePool, query, queryOne } from '../src/db/pool.js';
import { loadMatrixConfig } from '../src/matrix/config.js';
import { issueDocument } from '../src/documents/issue.js';
import { drawBiodata, type BiodataMember } from '../src/pdf/member-documents.js';

/** Issues one member bio-data, for looking at. */
try {
    const config = await loadMatrixConfig();
    const member = await queryOne<BiodataMember & { id: string }>(
        `SELECT m.id, m.full_name, m.year_of_birth, m.id_or_passport_no, m.mobile_no,
                m.home_parish_diocese, m.jumuiya, ph.name AS prayer_house, m.marital_status,
                m.spouse_name, m.spouse_status, m.father_status, m.mother_status,
                m.next_of_kin_name, m.next_of_kin_id_no, m.next_of_kin_mobile,
                m.membership_status, m.declaration_accepted_at, m.created_at
           FROM members m JOIN prayer_houses ph ON ph.id = m.prayer_house_id
          WHERE m.id_or_passport_no = 'DEMO-0001'`);
    if (!member) throw new Error('demo member not found');

    const children = await query<{ name: string; date_of_birth: string | null }>(
        `SELECT name, date_of_birth::text FROM children WHERE member_id = $1`, [member.id]);

    const data = { member, children: children.rows, orgName: config.org_name, photo: null };
    const issued = await issueDocument({
        kind: 'member_biodata',
        title: 'Member Bio-Data',
        orgName: config.org_name,
        subjectMemberId: member.id,
        subjectLabel: member.full_name,
        metadata: {
            member: member.full_name,
            prayer_house: member.prayer_house,
            children_listed: children.rows.length,
            membership: member.membership_status,
        },
    }, (doc) => drawBiodata(doc, data));

    writeFileSync(process.env.OUT ?? './biodata.pdf', issued.pdf);
    console.log(issued.documentId);
}
finally {
    await closePool();
}
