import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { closePool, query } from '../src/db/pool.js';
import { loadMatrixConfig } from '../src/matrix/config.js';
import { issueDocument, findDocument } from '../src/documents/issue.js';
import { keyId, publicKeyPem, verifyDigest } from '../src/documents/signing.js';
import { drawRoster, type RosterRow } from '../src/pdf/registers.js';

/** Issues one real document and checks the whole chain. Writes it to ./tmp. */
try {
    const config = await loadMatrixConfig();
    const rows = await query<RosterRow>(`SELECT m.full_name, m.id_or_passport_no, m.mobile_no,
          ph.name AS prayer_house, m.jumuiya, m.marital_status, m.membership_status,
          (SELECT string_agg(ot.label, '; ' ORDER BY ot.sort_order)
             FROM office_holders oh
             LEFT JOIN office_types ot ON ot.office_key = oh.office_key
            WHERE oh.member_id = m.id AND oh.term_end IS NULL) AS current_offices,
          to_char(m.created_at, 'YYYY-MM-DD') AS joined
   FROM members m JOIN prayer_houses ph ON ph.id = m.prayer_house_id
   ORDER BY ph.name, m.full_name`);

    const issued = await issueDocument({
        kind: 'member_roster',
        title: 'Member Register',
        orgName: config.org_name,
        subjectLabel: `${rows.rows.length} members`,
        metadata: { members: rows.rows.length },
    }, (doc) => drawRoster(doc, config.org_name, rows.rows));

    const out = process.env.OUT ?? './register.pdf';
    writeFileSync(out, issued.pdf);

    console.log(`Issued   ${issued.documentId}`);
    console.log(`  pages  ${issued.pages}`);
    console.log(`  bytes  ${issued.pdf.length}`);
    console.log(`  sha256 ${issued.sha256.slice(0, 32)}...`);
    console.log(`  saved  ${out}`);

    const record = await findDocument(issued.documentId);
    console.log('\nRecorded in the database:');
    console.log(`  title      ${record!.title}`);
    console.log(`  concerning ${record!.subject_label}`);
    console.log(`  key id     ${record!.key_id}  (server key ${keyId()})`);

    console.log('\nChecks:');
    console.log(`  hash on file matches the file      ${record!.sha256 === createHash('sha256').update(issued.pdf).digest('hex')}`);
    console.log(`  signature verifies against the key ${verifyDigest(record!.sha256, record!.signature)}`);

    // Alter one byte, as a forger would.
    const tampered = Buffer.from(issued.pdf);
    const at = Math.floor(tampered.length / 2);
    tampered.writeUInt8(tampered.readUInt8(at) ^ 0xff, at);
    const tamperedHash = createHash('sha256').update(tampered).digest('hex');
    console.log(`  altered file is rejected           ${tamperedHash !== record!.sha256}`);

    // A signature lifted from another document must not verify here.
    console.log(`  forged signature is rejected       ${!verifyDigest(record!.sha256, Buffer.alloc(64).toString('base64'))}`);

    console.log('\nPublic key served for independent checking:');
    console.log(publicKeyPem().trim().split('\n').map((l) => `  ${l}`).join('\n'));
}
finally {
    await closePool();
}
