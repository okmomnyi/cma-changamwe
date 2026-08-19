import { pool, query, queryOne } from '../db/pool.js';
import { env } from '../config/env.js';
import { logger } from '../util/logger.js';
import { loadMatrixConfig } from '../matrix/config.js';
import { renderReportText, reportSubject, periodLabel, type SnapshotForReport } from './report.js';
import { preformattedEmail } from '../email/templates.js';
import { sendEmail as defaultSend, type EmailMessage, type SendResult } from '../email/mailer.js';
export interface BatchResult {
    period: string;
    attempted: number;
    sent: number;
    failed: number;
    remaining: number;
    limit: number;
}
type Sender = (message: EmailMessage) => Promise<SendResult>;
interface PendingRow {
    id: string;
    member_id: string;
    period: string;
    full_name: string;
    email: string;
    spirituality_score: string;
    financial_score: string;
    total_score: string;
    attainable_total: string;
    standing: string;
    breakdown_json: SnapshotForReport['breakdown'];
}
export async function sendPendingReports(options: {
    period: string;
    limit?: number;
    send?: Sender;
}): Promise<BatchResult> {
    const limit = options.limit ?? env.EMAIL_DAILY_BATCH_SIZE;
    const send = options.send ?? defaultSend;
    const config = await loadMatrixConfig();
    let attempted = 0;
    let sent = 0;
    let failed = 0;
    while (attempted < limit) {
        const client = await pool.connect();
        let handled = false;
        try {
            await client.query('BEGIN');
            const claimed = await client.query<PendingRow>(`SELECT s.id, s.member_id, s.period, m.full_name, u.email,
                s.spirituality_score::text, s.financial_score::text, s.total_score::text,
                s.attainable_total::text, s.standing, s.breakdown_json
         FROM matrix_scores s
         JOIN members m ON m.id = s.member_id
         JOIN users u ON u.member_id = m.id
         WHERE s.period = $1 AND s.email_status = 'pending'
         ORDER BY s.id
         FOR UPDATE OF s SKIP LOCKED
         LIMIT 1`, [options.period]);
            const row = claimed.rows[0];
            if (!row) {
                await client.query('COMMIT');
                break;
            }
            handled = true;
            attempted += 1;
            const snapshot: SnapshotForReport = {
                member_name: row.full_name,
                period: row.period,
                spirituality_score: Number(row.spirituality_score),
                financial_score: Number(row.financial_score),
                total_score: Number(row.total_score),
                attainable_total: Number(row.attainable_total),
                standing: row.standing,
                breakdown: row.breakdown_json ?? {},
                org_name: config.org_name,
            };
            const result = await send({
                to: row.email,
                toName: row.full_name,
                ...preformattedEmail({
                    subject: reportSubject(snapshot),
                    heading: `Your Matrix report for ${periodLabel(snapshot.period)}`,
                    intro: 'Here is your participation summary for the period.',
                    body: renderReportText(snapshot),
                }),
            });
            if (result.delivered) {
                sent += 1;
                await client.query(`UPDATE matrix_scores SET email_status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
            }
            else {
                failed += 1;
                await client.query(`UPDATE matrix_scores SET email_status = 'failed' WHERE id = $1`, [row.id]);
                logger.warn({ memberId: row.member_id, reason: result.reason }, 'report send failed');
            }
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            logger.error({ err }, 'batch send aborted; remaining reports stay pending');
            throw err;
        }
        finally {
            client.release();
        }
        if (!handled)
            break;
    }
    const remaining = await queryOne<{
        n: string;
    }>(`SELECT count(*)::text AS n FROM matrix_scores
     WHERE period = $1 AND email_status = 'pending'`, [options.period]);
    const result: BatchResult = {
        period: options.period,
        attempted, sent, failed,
        remaining: Number(remaining?.n ?? 0),
        limit,
    };
    logger.info(result, 'report batch complete');
    return result;
}
export async function requeueFailed(period: string): Promise<number> {
    const result = await query(`UPDATE matrix_scores SET email_status = 'pending'
     WHERE period = $1 AND email_status = 'failed'`, [period]);
    return result.rowCount ?? 0;
}
