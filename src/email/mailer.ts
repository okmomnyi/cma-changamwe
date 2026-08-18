import { env, isProduction } from '../config/env.js';
import { logger } from '../util/logger.js';
export interface EmailMessage {
    to: string;
    toName?: string;
    subject: string;
    text: string;
    html?: string;
}
export interface SendResult {
    delivered: boolean;
    messageId?: string;
    reason?: string;
}
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
        const reason = 'BREVO_API_KEY or BREVO_SENDER_EMAIL is not configured';
        if (isProduction) {
            logger.error({ to: message.to, subject: message.subject }, `email not sent: ${reason}`);
            return { delivered: false, reason };
        }
        logger.warn({ to: message.to, subject: message.subject, body: message.text }, 'email not configured - message logged instead of sent');
        return { delivered: false, reason };
    }
    try {
        const res = await fetch(BREVO_ENDPOINT, {
            method: 'POST',
            headers: {
                'api-key': env.BREVO_API_KEY,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify({
                sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
                to: [{ email: message.to, ...(message.toName ? { name: message.toName } : {}) }],
                subject: message.subject,
                textContent: message.text,
                ...(message.html ? { htmlContent: message.html } : {}),
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            logger.error({ status: res.status, body: body.slice(0, 500) }, 'Brevo rejected the message');
            return { delivered: false, reason: `Brevo responded ${res.status}` };
        }
        const body = (await res.json().catch(() => ({}))) as {
            messageId?: string;
        };
        return { delivered: true, messageId: body.messageId };
    }
    catch (err) {
        logger.error({ err }, 'Brevo request failed');
        return { delivered: false, reason: err instanceof Error ? err.message : 'network error' };
    }
}
