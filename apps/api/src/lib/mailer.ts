import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { prisma } from "./prisma";
import { decryptSecret } from "./secret-box";

/**
 * Outbound email.
 *
 * Vertik12 is shipped to many schools, each sending from its own domain, so
 * the mail server is configured *in the app* (Administration › Email) rather
 * than baked into the deployment. Three sources are tried in order:
 *
 *   1. **database** — MailSettings, edited by the Super Admin. Wins whenever
 *      it is enabled and has a host.
 *   2. **environment** — the classic SMTP_* variables. Keeps existing
 *      installations working and is handy for a shared staging relay.
 *   3. **simulated** — neither configured: the message is logged and the
 *      caller is told delivery was simulated, so local development and a
 *      brand-new install work with zero setup.
 *
 * The transporter is pooled (welcome emails and payroll blasts reuse a few
 * TLS connections) and cached against a fingerprint of the configuration, so
 * saving new settings in the UI takes effect on the very next send without
 * a restart — and without rebuilding the pool on every message.
 */

export type MailSource = "database" | "environment" | "none";

interface ResolvedConfig {
  source: MailSource;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  /** Set when the row is configured but unusable — surfaced to the admin. */
  problem?: string;
}

/** Reads the singleton row, tolerating a database that predates the table. */
async function dbSettings() {
  try {
    return await prisma.mailSettings.findUnique({ where: { id: "mail" } });
  } catch {
    // Table not migrated yet — behave exactly as if it were unconfigured.
    return null;
  }
}

/**
 * Which mail server a send would actually use right now. Exported so the
 * admin screen can show the effective source instead of making the operator
 * guess whether their settings took effect.
 */
export async function resolveMailConfig(): Promise<ResolvedConfig | null> {
  const row = await dbSettings();

  if (row?.enabled && row.host) {
    // A saved password that won't decrypt (key rotated, row tampered with)
    // must not silently downgrade to an unauthenticated connection — most
    // servers would reject it and the admin would be left guessing.
    const password = row.passwordEnc ? decryptSecret(row.passwordEnc) : null;
    const problem =
      row.passwordEnc && password === null
        ? "The saved SMTP password could not be decrypted (the encryption key changed) — re-enter it in Administration › Email."
        : undefined;

    return {
      source: "database",
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      password,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      replyTo: row.replyTo,
      problem,
    };
  }

  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    return {
      source: "environment",
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      username: process.env.SMTP_USER ?? null,
      password: process.env.SMTP_PASS ?? null,
      fromName: null,
      fromEmail: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? null,
      replyTo: null,
    };
  }

  return null;
}

// The pool is rebuilt only when the configuration actually changes.
let cached: { fingerprint: string; transporter: Transporter } | null = null;

const fingerprintOf = (c: ResolvedConfig) =>
  [c.source, c.host, c.port, c.secure, c.username ?? "", c.password ?? ""].join("|");

function transporterFor(config: ResolvedConfig): Transporter {
  const fingerprint = fingerprintOf(config);
  if (cached?.fingerprint === fingerprint) return cached.transporter;

  cached?.transporter.close(); // drop the old pool's sockets
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password ?? undefined } : undefined,
    pool: true,
    maxConnections: 3,
  });
  cached = { fingerprint, transporter };
  return transporter;
}

/** Drop the cached pool — called after the admin saves new settings. */
export function resetMailer() {
  cached?.transporter.close();
  cached = null;
}

/** Envelope sender, in the form nodemailer expects. */
function fromAddress(config: ResolvedConfig): string | { name: string; address: string } | undefined {
  const address = config.fromEmail ?? config.username;
  if (!address) return undefined;
  return config.fromName ? { name: config.fromName, address } : address;
}

export interface MailResult {
  sent: boolean;
  simulated: boolean;
  message: string;
  source?: MailSource;
}

export async function sendMail(options: { to: string; subject: string; html: string }): Promise<MailResult> {
  const config = await resolveMailConfig();

  if (!config) {
    console.info(`[mailer] no mail server configured — simulated send to ${options.to}: "${options.subject}"`);
    return {
      sent: false,
      simulated: true,
      message:
        `Email delivery is simulated — no mail server is configured. ` +
        `Set one up in Administration › Email to send for real. Would have emailed ${options.to}.`,
      source: "none",
    };
  }
  if (config.problem) {
    return { sent: false, simulated: false, message: config.problem, source: config.source };
  }

  await transporterFor(config).sendMail({
    from: fromAddress(config),
    to: options.to,
    subject: options.subject,
    html: options.html,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
  });
  return { sent: true, simulated: false, message: `Emailed ${options.to}`, source: config.source };
}

/**
 * Handshake with the mail server without sending anything: DNS, TCP, TLS and
 * (when credentials are given) AUTH. Used by the admin's "test connection"
 * so a typo in the host or password is caught at configuration time.
 */
export async function verifyMailConfig(config: ResolvedConfig): Promise<void> {
  await transporterFor(config).verify();
}
