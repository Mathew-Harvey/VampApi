import nodemailer from 'nodemailer';
import { env } from '../config/env';

type EmailSendResult = {
  sent: boolean;
  id?: string;
  error?: string;
  provider?: 'smtp' | 'resend' | 'sendgrid';
};

export function inviteCodeFromToken(token: string): string {
  return token.replace(/-/g, '').slice(0, 6).toUpperCase();
}

// SMTP transporter (Gmail or any SMTP provider)
let transporter: nodemailer.Transporter | null = null;

if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  console.log(`[EMAIL] SMTP configured: ${env.SMTP_HOST} as ${env.SMTP_USER}`);
} else {
  console.warn('[EMAIL] SMTP not configured.');
}

if (env.RESEND_API_KEY) {
  console.log('[EMAIL] Resend configured.');
}
if (env.SENDGRID_API_KEY) {
  console.log('[EMAIL] SendGrid configured.');
}
if (!transporter && !env.RESEND_API_KEY && !env.SENDGRID_API_KEY) {
  console.warn('[EMAIL] No email provider configured. Configure SMTP, Resend, or SendGrid.');
}

async function sendViaSmtp(to: string, subject: string, html: string): Promise<EmailSendResult> {
  if (!transporter) return { sent: false, error: 'SMTP not configured' };
  try {
    const info = await transporter.sendMail({
      from: `"MarineStream" <${env.EMAIL_FROM}>`,
      to,
      subject,
      html,
    });
    return { sent: true, id: info.messageId, provider: 'smtp' };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

async function sendViaResend(to: string, subject: string, html: string): Promise<EmailSendResult> {
  if (!env.RESEND_API_KEY) return { sent: false, error: 'Resend not configured' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject,
        html,
      }),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { sent: false, error: body?.message || body?.error || `Resend HTTP ${response.status}` };
    }
    return { sent: true, id: body?.id, provider: 'resend' };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

async function sendViaSendGrid(to: string, subject: string, html: string): Promise<EmailSendResult> {
  if (!env.SENDGRID_API_KEY) return { sent: false, error: 'SendGrid not configured' };
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: env.EMAIL_FROM, name: 'MarineStream' },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { sent: false, error: body || `SendGrid HTTP ${response.status}` };
    }
    return { sent: true, id: response.headers.get('x-message-id') || undefined, provider: 'sendgrid' };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<EmailSendResult> {
  const attempts: EmailSendResult[] = [];
  const providers = [sendViaSmtp, sendViaResend, sendViaSendGrid];

  for (const sendWithProvider of providers) {
    const result = await sendWithProvider(to, subject, html);
    if (result.sent) {
      console.log(`[EMAIL] Sent via ${result.provider} to ${to}: "${subject}" (${result.id || 'no-id'})`);
      return result;
    }
    attempts.push(result);
  }

  const attemptErrors = attempts.map((a) => a.error).filter(Boolean).join(' | ');
  console.error(`[EMAIL] Failed to send to ${to}. ${attemptErrors}`);
  return {
    sent: false,
    error: 'No email provider succeeded. Configure SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY or SENDGRID_API_KEY.',
  }
}

// ── Branded HTML templates ──

const brandHeader = `
<div style="background: #0f172a; padding: 24px 32px; text-align: center;">
  <h1 style="margin: 0; color: #0ea5e9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 24px; font-weight: 700;">
    ⚓ MarineStream
  </h1>
  <p style="margin: 4px 0 0; color: #94a3b8; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    Vessel Management &amp; Compliance Platform
  </p>
</div>`;

const brandFooter = `
<div style="background: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
  <p style="margin: 0; color: #94a3b8; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    MarineStream — Vessel Management &amp; Compliance Platform<br>
    This email was sent by MarineStream on behalf of an authorised user.
  </p>
</div>`;

function wrapEmail(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    ${brandHeader}
    <div style="padding: 32px;">
      ${content}
    </div>
    ${brandFooter}
  </div>
</body>
</html>`;
}

export const emailService = {
  async sendWorkOrderInvite(params: {
    toEmail: string;
    inviterName: string;
    workOrderRef: string;
    workOrderTitle: string;
    vesselName: string;
    permission: string;
    isNewUser: boolean;
    actionUrl?: string;
    actionLabel?: string;
    inviteCode?: string;
    inviteUrl?: string;
  }) {
    const permLabel = params.permission === 'ADMIN' ? 'Admin (full access)' :
      params.permission === 'WRITE' ? 'Read & Write' : 'Read Only';

    const actionUrl = params.actionUrl || (params.isNewUser
      ? `${env.APP_URL}/register`
      : `${env.APP_URL}/work-orders`);

    const actionLabel = params.actionLabel || (params.isNewUser
      ? 'Create Your Account'
      : 'View Work Order');

    const html = wrapEmail(`
      <h2 style="margin: 0 0 8px; color: #0f172a; font-size: 20px;">You've been invited to collaborate</h2>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">
        <strong style="color: #0f172a;">${params.inviterName}</strong> has invited you to a work order on MarineStream.
      </p>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px; width: 120px;">Work Order</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 13px; font-weight: 600;">${params.workOrderRef}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Title</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 13px;">${params.workOrderTitle}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Vessel</td>
            <td style="padding: 6px 0; color: #0f172a; font-size: 13px;">${params.vesselName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Your Access</td>
            <td style="padding: 6px 0; font-size: 13px;">
              <span style="background: #0ea5e9; color: white; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                ${permLabel}
              </span>
            </td>
          </tr>
        </table>
      </div>

      ${params.isNewUser ? `
        <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">
          You don't have a MarineStream account yet. Create one with this email address to start collaborating:
        </p>
      ` : `
        <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">
          You can now access this work order in your MarineStream dashboard.
        </p>
      `}

      <div style="text-align: center; margin: 24px 0;">
        <a href="${actionUrl}" style="display: inline-block; background: #0ea5e9; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
          ${actionLabel}
        </a>
      </div>

      ${params.inviteCode ? `
        <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 14px; margin-top: 18px; text-align: center;">
          <p style="margin: 0 0 6px; color: #64748b; font-size: 12px;">Manual join code</p>
          <p style="margin: 0; color: #0f172a; font-size: 20px; letter-spacing: 1px; font-weight: 700;">${params.inviteCode}</p>
        </div>
      ` : ''}

      ${params.inviteUrl ? `
        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px; margin-top: 12px;">
          <p style="margin: 0 0 6px; color: #9a3412; font-size: 12px; font-weight: 600;">
            Manual invite URL
          </p>
          <p style="margin: 0; color: #7c2d12; font-size: 12px; word-break: break-all;">
            ${params.inviteUrl}
          </p>
        </div>
      ` : ''}

      <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; text-align: center;">
        If you didn't expect this invitation, you can safely ignore this email.
      </p>
    `);

    return sendEmail(
      params.toEmail,
      `${params.inviterName} invited you to ${params.workOrderRef} — ${params.workOrderTitle}`,
      html,
    );
  },

  async sendPasswordReset(params: { toEmail: string; resetUrl: string }) {
    const html = wrapEmail(`
      <h2 style="margin: 0 0 8px; color: #0f172a; font-size: 20px;">Reset your password</h2>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">
        We received a request to reset the password for your MarineStream account.
      </p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${params.resetUrl}" style="display: inline-block; background: #0ea5e9; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Reset Password
        </a>
      </div>

      <p style="color: #94a3b8; font-size: 12px; text-align: center;">
        This link expires in 1 hour. If you didn't request this, ignore this email.
      </p>
    `);

    return sendEmail(params.toEmail, 'Reset your MarineStream password', html);
  },
};
