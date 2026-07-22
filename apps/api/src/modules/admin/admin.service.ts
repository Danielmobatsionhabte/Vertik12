import crypto from "node:crypto";
import { BRAND, type MailSettingsInput, type PaginationQuery, type SchoolSettingsInput } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { hashPassword } from "../../lib/auth-tokens";
import { sendMail, resolveMailConfig, resetMailer, verifyMailConfig } from "../../lib/mailer";
import { encryptSecret, usingDedicatedKey } from "../../lib/secret-box";
import { accountCreatedEmail, passwordResetEmail, testEmail } from "../../lib/email-templates";
import { paginate, toSkipTake } from "../../lib/pagination";

// ============================ user management ============================
// Super Admin › User Management: create/edit/deactivate accounts, reset
// passwords, assign roles, enable/disable access.

export async function listUsers(q: PaginationQuery & { role?: string }) {
  const where: Prisma.UserWhereInput = {
    ...(q.role ? { role: q.role } : {}),
    ...(q.search
      ? {
          OR: [
            { email: { contains: q.search } },
            { firstName: { contains: q.search } },
            { lastName: { contains: q.search } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      ...toSkipTake(q),
      orderBy: { createdAt: "desc" },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        isActive: true, createdAt: true,
        staff: { select: { staffNo: true, designation: true } },
        guardian: { select: { id: true } },
        student: { select: { admissionNo: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return paginate(items, total, q);
}

export async function createUser(input: { email: string; password: string; firstName: string; lastName: string; role: string }) {
  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      // The admin knows this initial password — treat it as temporary.
      mustChangePassword: true,
    },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  });

  // EMAIL PATH: admin creates a user → account notice (the admin-chosen
  // initial password is deliberately NOT emailed). Fire-and-forget.
  void sendMail({
    to: user.email,
    subject: `Your Vertik12 account was created`,
    html: accountCreatedEmail({ firstName: user.firstName, role: user.role, email: user.email }),
  }).catch((err) => console.error("[mailer] account-created email failed:", err));

  return user;
}

export async function updateUser(id: string, input: { role?: string; isActive?: boolean; firstName?: string; lastName?: string }, actingUserId: string) {
  if (id === actingUserId && input.isActive === false) {
    throw ApiError.badRequest("You cannot deactivate your own account");
  }
  const user = await prisma.user.update({
    where: { id },
    data: input,
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  });
  // Disabling access or changing role kills existing sessions. The stamp
  // invalidates access tokens already issued, not just the refresh tokens —
  // the same immediate sign-out a password reset performs.
  if (input.isActive === false || input.role) {
    await prisma.$transaction([
      prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.user.update({ where: { id }, data: { sessionsRevokedAt: new Date() } }),
    ]);
  }
  return user;
}

/**
 * Reset a user's password to a generated temporary one and end every open
 * session immediately.
 *
 * Revoking refresh tokens alone is not enough: the access token already in
 * the user's browser stays valid until it expires. Stamping
 * `sessionsRevokedAt` makes the auth middleware reject those tokens too, so
 * the portal signs the user out within seconds of the reset — which is what
 * an administrator resetting a compromised account expects.
 */
export async function resetPassword(id: string) {
  const tempPassword = `Vrt-${crypto.randomBytes(6).toString("base64url")}`;
  const user = await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      sessionsRevokedAt: new Date(),
    },
    select: { email: true, firstName: true },
  });
  await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });

  // EMAIL PATH: password reset → the temporary password goes to the account
  // owner directly (the admin still sees it in the UI as a fallback).
  void sendMail({
    to: user.email,
    subject: `Your Vertik12 password was reset`,
    html: passwordResetEmail({ firstName: user.firstName, email: user.email, temporaryPassword: tempPassword }),
  }).catch((err) => console.error("[mailer] password-reset email failed:", err));

  return { temporaryPassword: tempPassword };
}

// ============================ visitors ============================
// Administration › Visitors: one row per user per day, with the IP, country
// and browser/device captured from that day's first authenticated request.

export async function listVisits(q: PaginationQuery & { date?: string }) {
  const where: Prisma.DailyVisitWhereInput = {
    ...(q.date ? { date: new Date(`${q.date}T00:00:00.000Z`) } : {}),
    ...(q.search
      ? {
          user: {
            is: {
              OR: [
                { email: { contains: q.search } },
                { firstName: { contains: q.search } },
                { lastName: { contains: q.search } },
              ],
            },
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.dailyVisit.findMany({
      where,
      ...toSkipTake(q),
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
    }),
    prisma.dailyVisit.count({ where }),
  ]);
  return paginate(items, total, q);
}

// ============================ audit logs ============================

export async function listAuditLogs(q: PaginationQuery & { userId?: string }) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.search ? { OR: [{ action: { contains: q.search } }, { userEmail: { contains: q.search } }, { path: { contains: q.search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, ...toSkipTake(q), orderBy: { createdAt: "desc" } }),
    prisma.auditLog.count({ where }),
  ]);
  return paginate(items, total, q);
}

// ============================ school settings ============================
// Singleton row (id = "school"); created on first read with defaults.

export async function getSettings() {
  return prisma.schoolSettings.upsert({
    where: { id: "school" },
    create: { id: "school" },
    update: {},
  });
}

export async function updateSettings(input: SchoolSettingsInput) {
  const data = {
    ...input,
    motto: input.motto || null,
    logoUrl: input.logoUrl || null,
    address: input.address || null,
    phone: input.phone || null,
    email: input.email || null,
  };
  return prisma.schoolSettings.upsert({
    where: { id: "school" },
    create: { id: "school", ...data },
    update: data,
  });
}

// ============================ mail server ============================
// Singleton row (id = "mail"). Each school runs Vertik12 on its own domain
// and sends from its own mail server, so SMTP is configured here rather
// than through deployment environment variables.

/** The stored row, minus the password, plus what is actually in effect. */
export async function getMailSettings() {
  const row = await prisma.mailSettings.upsert({
    where: { id: "mail" },
    create: { id: "mail" },
    update: {},
  });
  const effective = await resolveMailConfig();

  // The password is write-only: the client is told whether one exists, never
  // what it is. `passwordEnc` must not appear in the response at all.
  const { passwordEnc, ...safe } = row;
  return {
    ...safe,
    hasPassword: !!passwordEnc,
    /** Where a send would go right now: this row, SMTP_* env vars, or nowhere. */
    effectiveSource: effective?.source ?? "none",
    /** Set when the row is configured but unusable (e.g. undecryptable password). */
    problem: effective?.problem ?? null,
    /** False = secrets are keyed off JWT_ACCESS_SECRET; see lib/secret-box.ts. */
    dedicatedEncryptionKey: usingDedicatedKey(),
  };
}

export async function updateMailSettings(input: MailSettingsInput) {
  const existing = await prisma.mailSettings.findUnique({ where: { id: "mail" } });

  // Password rules: a new value replaces, `clearPassword` removes, and
  // omitting it keeps what is stored — so changing the port doesn't force
  // the admin to retype a password the browser never received.
  const passwordEnc =
    input.password ? encryptSecret(input.password)
    : input.clearPassword ? null
    : existing?.passwordEnc ?? null;

  const data = {
    enabled: input.enabled,
    host: input.host?.trim() || null,
    port: input.port,
    secure: input.secure,
    username: input.username?.trim() || null,
    passwordEnc,
    fromName: input.fromName?.trim() || null,
    fromEmail: input.fromEmail?.trim() || null,
    replyTo: input.replyTo?.trim() || null,
  };

  await prisma.mailSettings.upsert({
    where: { id: "mail" },
    create: { id: "mail", ...data },
    update: data,
  });
  // The pooled transporter is keyed on the old configuration — drop it so
  // the next email uses the new server without waiting for a restart.
  resetMailer();
  return getMailSettings();
}

/**
 * Prove the configuration works: handshake with the server (DNS, TLS, AUTH)
 * and then actually deliver a message. The outcome is recorded on the row so
 * the admin screen can show whether email is known-good.
 */
export async function sendTestMail(to: string, actor: { name: string; email: string }) {
  const config = await resolveMailConfig();
  if (!config) {
    throw ApiError.badRequest(
      "No mail server is configured. Enter your SMTP details and save them before sending a test.",
    );
  }
  if (config.problem) throw ApiError.badRequest(config.problem);

  const record = (ok: boolean, error: string | null) =>
    prisma.mailSettings
      .upsert({
        where: { id: "mail" },
        create: { id: "mail", lastTestAt: new Date(), lastTestOk: ok, lastTestError: error },
        update: { lastTestAt: new Date(), lastTestOk: ok, lastTestError: error },
      })
      .catch(() => undefined); // recording the result must never mask the result itself

  try {
    // verify() first so a bad host or password reports the real SMTP error
    // rather than a generic send failure.
    await verifyMailConfig(config);
    const result = await sendMail({
      to,
      subject: `${BRAND.appName} — test email`,
      html: testEmail({ requestedBy: actor.name, host: config.host, source: config.source }),
    });
    await record(true, null);
    return { ...result, source: config.source, host: config.host };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown mail server error";
    await record(false, message);
    // The admin needs the server's own words to fix a typo or a bad app
    // password; this route is SUPER_ADMIN-only, so it is safe to relay.
    throw ApiError.badRequest(`The mail server rejected the connection: ${message}`);
  }
}
