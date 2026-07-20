import type { CreateStaffInput, PaginationQuery } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { hashPassword } from "../../lib/auth-tokens";
import { sendMail } from "../../lib/mailer";
import { staffWelcomeEmail } from "../../lib/email-templates";
import { paginate, toSkipTake } from "../../lib/pagination";

async function nextStaffNo(): Promise<string> {
  const count = await prisma.staff.count();
  return `VRT-EMP-${String(count + 1).padStart(4, "0")}`;
}

export async function listStaff(
  q: PaginationQuery & { staffType?: string; status?: string; role?: string; department?: string; academicYearId?: string; sort?: string },
) {
  // Academic-year filter: everyone on the roster during that year, i.e.
  // who had joined by the year's end. (Exact leave dates aren't recorded,
  // so a leaver may still appear in later years — their status shows it.)
  let joinedBy: Date | undefined;
  if (q.academicYearId) {
    const year = await prisma.academicYear.findUnique({ where: { id: q.academicYearId } });
    if (!year) throw ApiError.notFound("Academic year");
    joinedBy = year.endDate;
  }
  // HR search covers the whole employee record: staff number, name, email,
  // designation and department; the dropdown filters narrow by type,
  // employment status, portal role and department.
  const where: Prisma.StaffWhereInput = {
    ...(q.staffType ? { staffType: q.staffType } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(joinedBy ? { joinDate: { lte: joinedBy } } : {}),
    ...(q.role ? { user: { is: { role: q.role } } } : {}),
    ...(q.department ? { department: { contains: q.department } } : {}),
    ...(q.search
      ? {
          OR: [
            { staffNo: { contains: q.search } },
            { designation: { contains: q.search } },
            { department: { contains: q.search } },
            {
              user: {
                is: {
                  OR: [
                    { firstName: { contains: q.search } },
                    { lastName: { contains: q.search } },
                    { email: { contains: q.search } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.staff.findMany({
      where,
      ...toSkipTake(q),
      orderBy: q.sort === "recent" ? [{ joinDate: "desc" as const }, { staffNo: "desc" as const }] : { staffNo: "asc" },
      include: {
        user: { select: { email: true, firstName: true, lastName: true, role: true, isActive: true } },
        salaryStructure: { select: { basicSalary: true, currency: true } },
      },
    }),
    prisma.staff.count({ where }),
  ]);
  return paginate(items, total, q);
}

/**
 * Per-academic-year HR report: the roster during the chosen year (everyone
 * who had joined by the year's end) with hires made during that year
 * flagged and counted, plus type/department/status/role summaries. Past
 * years stay reportable after the school moves to a new year.
 */
export async function staffYearReport(
  academicYearId: string,
  filters: { staffType?: string; status?: string; department?: string },
) {
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) throw ApiError.notFound("Academic year");

  const roster = await prisma.staff.findMany({
    where: {
      joinDate: { lte: year.endDate },
      ...(filters.staffType ? { staffType: filters.staffType } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.department ? { department: { contains: filters.department } } : {}),
    },
    orderBy: { staffNo: "asc" },
    include: {
      user: { select: { email: true, firstName: true, lastName: true, role: true, isActive: true } },
    },
  });

  const rows = roster.map((s) => ({
    id: s.id,
    staffNo: s.staffNo,
    firstName: s.user.firstName,
    lastName: s.user.lastName,
    email: s.user.email,
    role: s.user.role,
    staffType: s.staffType,
    designation: s.designation,
    department: s.department,
    status: s.status,
    joinDate: s.joinDate,
    joinedThisYear: s.joinDate >= year.startDate && s.joinDate <= year.endDate,
  }));

  const countBy = (key: (r: (typeof rows)[number]) => string) => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
    return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };

  return {
    year: { id: year.id, name: year.name, startDate: year.startDate, endDate: year.endDate, isActive: year.isActive },
    rows,
    totals: {
      staff: rows.length,
      newHires: rows.filter((r) => r.joinedThisYear).length,
      byType: countBy((r) => r.staffType),
      byDepartment: countBy((r) => r.department ?? "Unassigned"),
      byStatus: countBy((r) => r.status),
      byRole: countBy((r) => r.role),
    },
  };
}

export async function getStaff(id: string) {
  const staff = await prisma.staff.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, firstName: true, lastName: true, role: true, isActive: true } },
      salaryStructure: true,
      classSubjects: { include: { classRoom: true, subject: true } },
      homeroomOf: true,
      payslips: { include: { run: true }, orderBy: { id: "desc" }, take: 12 },
    },
  });
  if (!staff) throw ApiError.notFound("Staff member");
  return staff;
}

/**
 * Creates the login account and the staff profile together.
 * Returns a generated temporary password when none was supplied so the
 * admin can hand it to the new hire (they change it on first login).
 */
export async function createStaff(input: CreateStaffInput) {
  const tempPassword = input.password ?? `Vrt-${crypto.randomBytes(6).toString("base64url")}`;
  const { password: _password, email, role, firstName, lastName, ...profile } = input;

  const staff = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: await hashPassword(tempPassword),
        firstName,
        lastName,
        role,
        // First sign-in uses a password someone else has seen — force a change.
        mustChangePassword: true,
      },
    });
    return tx.staff.create({
      data: { ...profile, userId: user.id, staffNo: await nextStaffNo() },
      include: { user: { select: { email: true, firstName: true, lastName: true, role: true } } },
    });
  });

  // EMAIL PATH: staff registration → welcome email with sign-in details.
  // Fire-and-forget: a mail outage must never fail the registration itself.
  // The generated temporary password is included; an admin-chosen one is not
  // (the admin hands that over personally).
  void sendMail({
    to: staff.user.email,
    subject: `Welcome to Vertik12 — your staff account`,
    html: staffWelcomeEmail({
      firstName: staff.user.firstName,
      staffNo: staff.staffNo,
      role: staff.user.role,
      designation: staff.designation,
      email: staff.user.email,
      temporaryPassword: input.password ? undefined : tempPassword,
    }),
  }).catch((err) => console.error("[mailer] staff welcome email failed:", err));

  return { staff, temporaryPassword: input.password ? undefined : tempPassword };
}

export async function updateStaff(id: string, input: Record<string, unknown>) {
  const { firstName, lastName, ...profile } = input as { firstName?: string; lastName?: string } & Record<string, unknown>;
  const staff = await prisma.staff.update({ where: { id }, data: profile });
  if (firstName || lastName) {
    await prisma.user.update({
      where: { id: staff.userId },
      data: { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) },
    });
  }
  return getStaff(id);
}

/** Off-boarding: profile marked TERMINATED/RESIGNED and the login disabled. */
export async function deactivateStaff(id: string, status: "TERMINATED" | "RESIGNED") {
  const staff = await prisma.staff.update({ where: { id }, data: { status } });
  await prisma.user.update({ where: { id: staff.userId }, data: { isActive: false } });
  return staff;
}

/**
 * HR status management: ACTIVE / ON_LEAVE / TERMINATED / RESIGNED.
 * Login access follows the employment status automatically:
 *  - TERMINATED / RESIGNED → portal access revoked, open sessions killed.
 *  - ACTIVE (re-hire / return) → portal access restored.
 *  - ON_LEAVE → access left as-is (still employed).
 * Terminating a registrar (which cuts their login) stays Super-Admin-only,
 * mirroring the web-access rule.
 */
export async function setStaffStatus(id: string, status: string, actorRole: string) {
  const staff = await prisma.staff.findUnique({ where: { id }, include: { user: true } });
  if (!staff) throw ApiError.notFound("Staff member");
  const cutsAccess = status === "TERMINATED" || status === "RESIGNED";
  if (cutsAccess && actorRole !== "SUPER_ADMIN" && ["REGISTRAR", "SUPER_ADMIN"].includes(staff.user.role)) {
    throw ApiError.forbidden("Only the Super Admin can terminate the registrar (it revokes their web access)");
  }

  await prisma.staff.update({ where: { id }, data: { status } });
  if (cutsAccess) {
    await prisma.user.update({ where: { id: staff.userId }, data: { isActive: false } });
    await prisma.refreshToken.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  } else if (status === "ACTIVE" && !staff.user.isActive) {
    await prisma.user.update({ where: { id: staff.userId }, data: { isActive: true } });
  }
  return getStaff(id);
}

/**
 * Grant/revoke a staff member's web access (their login) without changing
 * employment status. Admins cannot revoke the registrar's access — only the
 * Super Admin can (via Administration › Users).
 */
export async function setWebAccess(id: string, isActive: boolean, actorRole: string) {
  const staff = await prisma.staff.findUnique({ where: { id }, include: { user: true } });
  if (!staff) throw ApiError.notFound("Staff member");
  if (actorRole !== "SUPER_ADMIN" && ["REGISTRAR", "SUPER_ADMIN"].includes(staff.user.role) && !isActive) {
    throw ApiError.forbidden("Only the Super Admin can revoke the registrar's web access");
  }
  await prisma.user.update({ where: { id: staff.userId }, data: { isActive } });
  if (!isActive) {
    await prisma.refreshToken.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  return getStaff(id);
}
