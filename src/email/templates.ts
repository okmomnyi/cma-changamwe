import { env } from '../config/env.js';

const NAVY = '#17324f';
const NAVY_DARK = '#12293f';
const BRASS = '#8c5e12';
const BRASS_LIGHT = '#f5e9d2';
const INK = '#1a1815';
const MUTED = '#6b645b';
const BORDER = '#e0dbd3';
const BG = '#f2efe9';
const CARD = '#ffffff';

function orgName(): string {
  return env.BREVO_SENDER_NAME || 'CMA Changamwe';
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

interface LayoutParts {
  heading: string;
  intro?: string;
  code?: string;
  codeCaption?: string;
  action?: { label: string; url: string };
  paragraphs?: string[];
  callout?: { text: string; tone?: 'info' | 'warn' };
  signoff?: string;
  bodyHtml?: string;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${html}</p>`;
}

function renderHtml(parts: LayoutParts): string {
  const intro = parts.intro
    ? paragraph(escape(parts.intro))
    : '';

  const code = parts.code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
         <tr><td align="center">
           <div style="display:inline-block;background:${BRASS_LIGHT};border:1px solid ${BORDER};border-radius:10px;padding:16px 28px;">
             <div style="font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${NAVY_DARK};">${escape(parts.code)}</div>
           </div>
           ${parts.codeCaption ? `<div style="margin-top:10px;font-size:13px;color:${MUTED};">${escape(parts.codeCaption)}</div>` : ''}
         </td></tr>
       </table>`
    : '';

  const action = parts.action
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
         <tr><td align="center">
           <a href="${escape(parts.action.url)}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 30px;border-radius:8px;font-family:Helvetica,Arial,sans-serif;">${escape(parts.action.label)}</a>
         </td></tr>
         <tr><td align="center" style="padding-top:14px;">
           <div style="font-size:12px;color:${MUTED};line-height:1.6;">Or paste this into your browser:</div>
           <div style="font-size:12px;color:${NAVY};word-break:break-all;line-height:1.6;">${escape(parts.action.url)}</div>
         </td></tr>
       </table>`
    : '';

  const body = (parts.paragraphs ?? []).map((p) => paragraph(escape(p))).join('')
    + (parts.bodyHtml ?? '');

  const callout = parts.callout
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;">
         <tr><td style="background:${parts.callout.tone === 'warn' ? '#fbeee0' : '#eef4fa'};border-left:3px solid ${parts.callout.tone === 'warn' ? BRASS : NAVY};border-radius:6px;padding:12px 16px;font-size:14px;line-height:1.55;color:${INK};">
           ${escape(parts.callout.text)}
         </td></tr>
       </table>`
    : '';

  const signoff = parts.signoff
    ? paragraph(escape(parts.signoff))
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(parts.heading)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;">
        <tr><td style="background:${NAVY};border-radius:12px 12px 0 0;padding:22px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:12px;">
              <div style="width:34px;height:34px;background:${NAVY_DARK};border-radius:7px;position:relative;text-align:center;line-height:34px;font-size:20px;color:${BRASS_LIGHT};font-family:Georgia,serif;">&#10013;</div>
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:17px;font-weight:600;color:#ffffff;font-family:Helvetica,Arial,sans-serif;">${escape(orgName())}</div>
              <div style="font-size:12px;color:#dbe6f1;font-family:Helvetica,Arial,sans-serif;">Catholic Men Association</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background:${CARD};border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};padding:28px 28px 8px;font-family:Helvetica,Arial,sans-serif;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${NAVY_DARK};font-family:Helvetica,Arial,sans-serif;">${escape(parts.heading)}</h1>
          ${intro}${code}${action}${callout}${body}${signoff}
        </td></tr>
        <tr><td style="background:${CARD};border:1px solid ${BORDER};border-top:0;border-radius:0 0 12px 12px;padding:18px 28px 24px;font-family:Helvetica,Arial,sans-serif;">
          <div style="border-top:1px solid ${BORDER};padding-top:16px;font-size:12px;line-height:1.6;color:${MUTED};">
            This message was sent by ${escape(orgName())}. If it was not meant for you, you can safely ignore it.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function otpEmail(opts: {
  subject: string;
  heading: string;
  intro: string;
  code: string;
  ttlMinutes: number;
  footer?: string;
}): EmailContent {
  const text = [
    opts.intro,
    '',
    `    ${opts.code}`,
    '',
    `This code expires in ${opts.ttlMinutes} minutes.`,
    opts.footer ?? 'If you did not request it, ignore this message.',
  ].join('\n');

  return {
    subject: opts.subject,
    text,
    html: renderHtml({
      heading: opts.heading,
      intro: opts.intro,
      code: opts.code,
      codeCaption: `Expires in ${opts.ttlMinutes} minutes`,
      paragraphs: [opts.footer ?? 'If you did not request this, you can ignore this message.'],
    }),
  };
}

export function noticeEmail(opts: {
  subject: string;
  heading: string;
  paragraphs: string[];
  callout?: { text: string; tone?: 'info' | 'warn' };
  signoff?: string;
  bodyHtml?: string;
}): EmailContent {
  const text = [...opts.paragraphs, opts.callout ? `\n${opts.callout.text}` : '', opts.signoff ?? '']
    .filter(Boolean).join('\n\n');
  return {
    subject: opts.subject,
    text,
    html: renderHtml({
      heading: opts.heading,
      paragraphs: opts.paragraphs,
      callout: opts.callout,
      signoff: opts.signoff,
    }),
  };
}

/** A message whose point is a single link, such as a password reset. */
export function actionEmail(opts: {
  subject: string;
  heading: string;
  intro: string;
  actionLabel: string;
  url: string;
  ttlMinutes: number;
  footer?: string;
}): EmailContent {
  const footer = opts.footer
    ?? 'If you did not ask for this, ignore this message. Nothing has changed on your account.';
  const text = [
    opts.intro,
    '',
    opts.url,
    '',
    `This link expires in ${opts.ttlMinutes} minutes and can be used once.`,
    footer,
  ].join('\n');

  return {
    subject: opts.subject,
    text,
    html: renderHtml({
      heading: opts.heading,
      intro: opts.intro,
      action: { label: opts.actionLabel, url: opts.url },
      callout: { text: `This link expires in ${opts.ttlMinutes} minutes and can be used once.` },
      paragraphs: [footer],
    }),
  };
}

/** Wraps already-rendered plain text (reports, digests) in the branded shell. */
export function preformattedEmail(opts: {
  subject: string;
  heading: string;
  intro?: string;
  body: string;
}): EmailContent {
  const pre = `<pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:13px;line-height:1.5;color:${INK};white-space:pre-wrap;word-break:break-word;">${escape(opts.body)}</pre>`;
  return {
    subject: opts.subject,
    text: opts.intro ? `${opts.intro}

${opts.body}` : opts.body,
    html: renderHtml({ heading: opts.heading, intro: opts.intro, bodyHtml: pre }),
  };
}
