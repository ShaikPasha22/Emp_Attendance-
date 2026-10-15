import { env } from '../config/env';
import { logger } from './logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function parseFrom(from: string) {
  const m = from.match(/^(.*)<(.+)>$/);
  return m ? { name: m[1]!.trim(), email: m[2]!.trim() } : { name: '', email: from.trim() };
}

/**
 * Sends email through an HTTP API (Render's free tier blocks SMTP ports).
 * Failures are logged, never thrown — email must not break the main action.
 */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  try {
    if (env.EMAIL_PROVIDER === 'console') {
      logger.info({ to: msg.to, subject: msg.subject }, `[email:console]\n${msg.text}`);
      return true;
    }
    const from = parseFrom(env.EMAIL_FROM);
    const res =
      env.EMAIL_PROVIDER === 'brevo'
        ? await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: { 'api-key': env.EMAIL_API_KEY, 'content-type': 'application/json' },
            body: JSON.stringify({
              sender: { name: from.name || undefined, email: from.email },
              to: [{ email: msg.to }],
              subject: msg.subject,
              htmlContent: msg.html,
              textContent: msg.text,
            }),
          })
        : await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
          });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, 'Email provider rejected message');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Failed to send email');
    return false;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Simple, accessible transactional email layout. */
export function actionEmail(opts: { to: string; subject: string; heading: string; body: string; actionLabel: string; actionUrl: string; footer?: string }): EmailMessage {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td><h1 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(opts.heading)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">${escapeHtml(opts.body)}</p>
<a href="${escapeHtml(opts.actionUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">${escapeHtml(opts.actionLabel)}</a>
<p style="margin:24px 0 0;font-size:13px;color:#6b7280">If the button doesn't work, copy this link:<br><span style="word-break:break-all">${escapeHtml(opts.actionUrl)}</span></p>
${opts.footer ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">${escapeHtml(opts.footer)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.actionLabel}: ${opts.actionUrl}\n${opts.footer ? `\n${opts.footer}\n` : ''}`;
  return { to: opts.to, subject: opts.subject, html, text };
}
