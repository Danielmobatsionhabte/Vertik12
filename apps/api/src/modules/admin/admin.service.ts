import crypto from "node:crypto";
import type { PaginationQuery, SchoolSettingsInput } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { hashPassword } from "../../lib/auth-tokens";
import { sendMail } from "../../lib/mailer";
import { accountCreatedEmail, passwordResetEmail } from "../../lib/email-templates";
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
  // Disabling access or changing role kills existing sessions.
  if (input.isActive === false || input.role) {
    await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  return user;
}

/** Reset a user's password to a generated temporary one and revoke sessions. */
export async function resetPassword(id: string) {
  const tempPassword = `Vrt-${crypto.randomBytes(6).toString("base64url")}`;
  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true },
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
