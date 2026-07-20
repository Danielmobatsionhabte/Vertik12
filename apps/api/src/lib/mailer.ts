import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/**
 * Outbound email. Configured through SMTP_* environment variables:
 *
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Without SMTP_HOST the mailer runs in "simulated" mode: the message is
 * logged instead of sent and callers are told delivery was simulated —
 * the dev experience keeps working with zero configuration.
 */

let transporter: Transporter | null = null;

function smtpConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

function getTransporter(): Transporter {
  // Pooled: welcome emails and payroll blasts reuse a few TLS connections
  // instead of opening one per message (many shared hosts also cap
  // concurrent SMTP sessions).
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    pool: true,
    maxConnections: 3,
  });
  return transporter;
}

export interface MailResult {
  sent: boolean;
  simulated: boolean;
  message: string;
}

export async function sendMail(options: { to: string; subject: string; html: string }): Promise<MailResult> {
  if (!smtpConfigured()) {
    console.info(`[mailer] SMTP not configured — simulated send to ${options.to}: "${options.subject}"`);
    return {
      sent: false,
      simulated: true,
      message: `Email delivery is simulated (configure SMTP_HOST to send for real). Would have emailed ${options.to}.`,
    };
  }
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });
  return { sent: true, simulated: false, message: `Emailed ${options.to}` };
}
