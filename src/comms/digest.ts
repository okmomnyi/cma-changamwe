import { query } from '../db/pool.js';
import { loadMatrixConfig } from '../matrix/config.js';
import { logger } from '../util/logger.js';
import { periodLabel } from './report.js';
import { sendEmail as defaultSend, type EmailMessage, type SendResult } from '../email/mailer.js';
import { preformattedEmail } from '../email/templates.js';
export interface DigestResult {
    period: string;
    recipients: string[];
    below_threshold: number;
    delivered: number;
}
type Sender = (message: EmailMessage) => Promise<SendResult>;
async function resolveRecipients(): Promise<Array<{
    email: string;
    name: string;
}>> {
    const config = await loadMatrixConfig();
    const offices = Array.isArray(config.raw.digest_offices)
        ? (config.raw.digest_offices as string[])
        : ['coordinator', 'treasurer'];
    const holders = await query<{
        email: string;
        full_name: string;
    }>(`SELECT DISTINCT u.email, m.full_name
     FROM office_holders oh
     JOIN members m ON m.id = oh.member_id
     JOIN users u ON u.member_id = m.id
     WHERE oh.term_end IS NULL AND oh.office_key = ANY($1::text[])`, [offices]);
    const extras = Array.isArray(config.raw.digest_extra_recipients)
        ? (config.raw.digest_extra_recipients as string[])
        : [];
    const recipients = holders.rows.map((r) => ({ email: r.email, name: r.full_name }));
    for (const email of extras) {
        if (!recipients.some((r) => r.email.toLowerCase() === email.toLowerCase())) {
            recipients.push({ email, name: 'Chaplain' });
        }
    }
    return recipients;
}
export async function sendLeadershipDigest(options: {
    period: string;
    send?: Sender;
}): Promise<DigestResult> {
    const send = options.send ?? defaultSend;
    const config = await loadMatrixConfig();
    const rows = await query<{
        full_name: string;
        prayer_house: string;
        total_score: string;
        spirituality_score: string;
        financial_score: string;
        mobile_no: string;
    }>(`SELECT m.full_name, ph.name AS prayer_house, m.mobile_no,
            s.total_score::text, s.spirituality_score::text, s.financial_score::text
     FROM matrix_scores s
     JOIN members m ON m.id = s.member_id
     JOIN prayer_houses ph ON ph.id = m.prayer_house_id
     WHERE s.period = $1 AND s.standing = 'below_threshold'
     ORDER BY ph.name, s.total_score ASC`, [options.period]);
    const recipients = await resolveRecipients();
    const label = periodLabel(options.period);
    const lines = [
        `${config.org_name} - pastoral follow-up list for ${label}`,
        '',
        `${rows.rows.length} members are below the threshold this period.`,
        '',
        'This list is for a conversation, not a notice. The members below have not',
        'been told they appear on it.',
        '',
    ];
    let currentHouse = '';
    for (const row of rows.rows) {
        if (row.prayer_house !== currentHouse) {
            currentHouse = row.prayer_house;
            lines.push('', currentHouse.toUpperCase());
        }
        lines.push(`  ${row.full_name.padEnd(28)} ${Number(row.total_score).toFixed(1).padStart(5)}` +
            `  (spirituality ${Number(row.spirituality_score).toFixed(1)},` +
            ` financial ${Number(row.financial_score).toFixed(1)})  ${row.mobile_no}`);
    }
    if (rows.rows.length === 0) {
        lines.push('No member is below the threshold this period.');
    }
    lines.push('', config.org_name);
    const text = lines.join('\n');
    let delivered = 0;
    for (const recipient of recipients) {
        const result = await send({
            to: recipient.email,
            toName: recipient.name,
            ...preformattedEmail({
                subject: `${config.org_name} - follow-up list for ${label}`,
                heading: `Follow-up list for ${label}`,
                intro: 'Members currently below the welfare-standing threshold, for pastoral follow-up.',
                body: text,
            }),
        });
        if (result.delivered)
            delivered += 1;
    }
    const summary: DigestResult = {
        period: options.period,
        recipients: recipients.map((r) => r.email),
        below_threshold: rows.rows.length,
        delivered,
    };
    logger.info(summary, 'leadership digest sent');
    return summary;
}
