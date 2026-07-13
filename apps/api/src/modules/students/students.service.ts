import type { BulkEnrollInput, CreateStudentInput, PaginationQuery } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { hashPassword } from "../../lib/auth-tokens";
import { paginate, toSkipTake } from "../../lib/pagination";

/** Sequential, human-readable admission numbers: VRT-2026-0001 */
async function nextAdmissionNo(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.student.count({ where: { admissionNo: { startsWith: `VRT-${year}-` } } });
  return `VRT-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function listStudents(q: PaginationQuery & { gradeLevel?: string; status?: string; classRoomId?: string }) {
  const where: Prisma.StudentWhereInput = {
    ...(q.gradeLevel ? { gradeLevel: q.gradeLevel } : {}),
    ...(q.status ? { status: q.status } : {}),
    // Filter by section/class (via the student's enrollment).
    ...(q.classRoomId ? { enrollments: { some: { classRoomId: q.classRoomId } } } : {}),
    ...(q.search
      ? {
          OR: [
            { firstName: { contains: q.search } },
            { lastName: { contains: q.search } },
            { admissionNo: { contains: q.search } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.student.findMany({
      where,
      ...toSkipTake(q),
      orderBy: [{ gradeLevel: "asc" }, { lastName: "asc" }],
      include: {
        enrollments: {
          where: { academicYear: { isActive: true } },
          include: { classRoom: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.student.count({ where }),
  ]);
  return paginate(items, total, q);
}

/**
 * 360° profile, scoped to what the viewer's role may see:
 *  - TEACHER: no finance data (fees are not a teacher's business)
 *  - ACCOUNTANT: no exam results (grades are not an accountant's business)
 */
export async function getStudent(id: string, viewerRole: string) {
  const canSeeFinance = viewerRole !== "TEACHER";
  const canSeeResults = viewerRole !== "ACCOUNTANT";

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      guardians: { include: { guardian: true } },
      enrollments: { include: { classRoom: true, academicYear: true }, orderBy: { createdAt: "desc" } },
      ...(canSeeFinance
        ? { invoices: { include: { items: true, payments: true }, orderBy: { issueDate: "desc" }, take: 10 } }
        : {}),
      ...(canSeeResults
        ? {
            examResults: {
              include: { exam: { include: { term: true } }, subject: true },
              orderBy: { id: "desc" },
              take: 30,
            },
          }
        : {}),
    },
  });
  if (!student) throw ApiError.notFound("Student");

  const [totalDays, presentDays] = await Promise.all([
    prisma.attendanceRecord.count({ where: { studentId: id } }),
    prisma.attendanceRecord.count({ where: { studentId: id, status: { in: ["PRESENT", "LATE"] } } }),
  ]);

  const invoices = (student as unknown as { invoices?: Array<{ status: string; items: { amount: number }[]; payments: { status: string; amount: number }[] }> }).invoices;
  const invoiced = (invoices ?? [])
    .filter((i) => i.status !== "VOID")
    .reduce((sum, i) => sum + i.items.reduce((s, it) => s + it.amount, 0), 0);
  const paid = (invoices ?? [])
    .flatMap((i) => i.payments)
    .filter((p) => p.status === "SUCCEEDED")
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    ...student,
    invoices: invoices ?? null,
    examResults: (student as { examResults?: unknown[] }).examResults ?? null,
    attendanceRate: totalDays === 0 ? null : Math.round((presentDays / totalDays) * 1000) / 10,
    financeSummary: canSeeFinance ? { invoiced, paid, outstanding: invoiced - paid } : null,
  };
}

export async function createStudent(input: CreateStudentInput) {
  const { guardians, classRoomId, ...data } = input;

  return prisma.$transaction(async (tx) => {
    const student = await tx.student.create({
      data: {
        ...data,
        email: data.email || null,
        photoUrl: data.photoUrl || null,
        admissionNo: await nextAdmissionNo(),
      },
    });

    for (const g of guardians) {
      const { relation, isPrimary, ...guardianData } = g;
      const guardian = await tx.guardian.create({ data: { ...guardianData, email: guardianData.email || null } });
      await tx.studentGuardian.create({
        data: { studentId: student.id, guardianId: guardian.id, relation, isPrimary },
      });
    }

    // Enroll into a class for the active academic year, if requested.
    if (classRoomId) {
      const classRoom = await tx.classRoom.findUnique({ where: { id: classRoomId } });
      if (!classRoom) throw ApiError.notFound("Class room");
      await tx.enrollment.create({
        data: { studentId: student.id, classRoomId, academicYearId: classRoom.academicYearId },
      });
    }
    return student;
  });
}

export async function updateStudent(id: string, input: Record<string, unknown>) {
  const { classRoomId, ...data } = input as { classRoomId?: string } & Record<string, unknown>;
  const student = await prisma.student.update({ where: { id }, data });

  if (classRoomId) {
    const classRoom = await prisma.classRoom.findUnique({ where: { id: classRoomId } });
    if (!classRoom) throw ApiError.notFound("Class room");
    await prisma.enrollment.upsert({
      where: { studentId_academicYearId: { studentId: id, academicYearId: classRoom.academicYearId } },
      create: { studentId: id, classRoomId, academicYearId: classRoom.academicYearId },
      update: { classRoomId },
    });
  }
  return student;
}

/** Soft delete: mark WITHDRAWN. Historical records (grades, invoices) stay intact. */
export async function withdrawStudent(id: string) {
  return prisma.student.update({ where: { id }, data: { status: "WITHDRAWN" } });
}

// ==================== academic-year enrollment (rollover) ====================

/** Active students not yet enrolled in the given academic year. */
export async function unassignedStudents(academicYearId: string, gradeLevel?: string) {
  return prisma.student.findMany({
    where: {
      status: "ACTIVE",
      ...(gradeLevel ? { gradeLevel } : {}),
      enrollments: { none: { academicYearId } },
    },
    orderBy: [{ gradeLevel: "asc" }, { lastName: "asc" }],
    select: { id: true, admissionNo: true, firstName: true, lastName: true, gradeLevel: true },
  });
}

/**
 * Enrol existing students into a class (new-year rollover / late assignment).
 * The class's academic year is the enrollment year; students already in
 * that year are simply moved to this class.
 */
export async function bulkEnroll(input: BulkEnrollInput) {
  const classRoom = await prisma.classRoom.findUnique({
    where: { id: input.classRoomId },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!classRoom) throw ApiError.notFound("Class room");

  const newSeats = input.studentIds.length;
  if (classRoom._count.enrollments + newSeats > classRoom.capacity) {
    throw ApiError.badRequest(
      `${classRoom.name} has ${classRoom.capacity - classRoom._count.enrollments} free seat(s) — cannot add ${newSeats} student(s)`,
    );
  }

  const students = await prisma.student.findMany({
    where: { id: { in: input.studentIds }, status: "ACTIVE" },
    select: { id: true },
  });
  if (students.length !== input.studentIds.length) {
    throw ApiError.badRequest("One or more selected students are not active");
  }

  await prisma.$transaction(
    input.studentIds.map((studentId) =>
      prisma.enrollment.upsert({
        where: { studentId_academicYearId: { studentId, academicYearId: classRoom.academicYearId } },
        create: { studentId, classRoomId: classRoom.id, academicYearId: classRoom.academicYearId },
        update: { classRoomId: classRoom.id },
      }),
    ),
  );
  return { enrolled: input.studentIds.length, classRoom: classRoom.name };
}

// ==================== guardian management ====================

/** Add another parent/guardian to an existing student. */
export async function addGuardian(
  studentId: string,
  input: { firstName: string; lastName: string; relation: string; phone: string; email?: string; occupation?: string; isPrimary: boolean },
) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw ApiError.notFound("Student");
  const { relation, isPrimary, ...data } = input;
  return prisma.$transaction(async (tx) => {
    const guardian = await tx.guardian.create({ data: { ...data, email: data.email || null } });
    await tx.studentGuardian.create({ data: { studentId, guardianId: guardian.id, relation, isPrimary } });
    return guardian;
  });
}

/**
 * Edit a guardian's information. If they already have a portal login and
 * the email changes, the login email changes with it.
 */
export async function updateGuardian(
  studentId: string,
  guardianId: string,
  input: { firstName?: string; lastName?: string; relation?: string; phone?: string; email?: string; occupation?: string; isPrimary?: boolean },
) {
  const link = await prisma.studentGuardian.findUnique({
    where: { studentId_guardianId: { studentId, guardianId } },
    include: { guardian: true },
  });
  if (!link) throw ApiError.notFound("Guardian for this student");

  const { relation, isPrimary, email, ...data } = input;
  return prisma.$transaction(async (tx) => {
    const guardian = await tx.guardian.update({
      where: { id: guardianId },
      data: { ...data, ...(email !== undefined ? { email: email || null } : {}) },
    });
    if (relation !== undefined || isPrimary !== undefined) {
      await tx.studentGuardian.update({
        where: { studentId_guardianId: { studentId, guardianId } },
        data: { ...(relation !== undefined ? { relation } : {}), ...(isPrimary !== undefined ? { isPrimary } : {}) },
      });
    }
    // Keep the portal login in sync with the guardian's contact details.
    if (link.guardian.userId && (email || data.firstName || data.lastName)) {
      await tx.user.update({
        where: { id: link.guardian.userId },
        data: {
          ...(email ? { email: email.toLowerCase() } : {}),
          ...(data.firstName ? { firstName: data.firstName } : {}),
          ...(data.lastName ? { lastName: data.lastName } : {}),
        },
      });
    }
    return guardian;
  });
}

// ==================== parent portal registration ====================

/**
 * Turns a guardian record into a parent web-portal login. The temporary
 * password is returned once so the registrar can hand it to the family;
 * the parent then sees exactly their own children in the portal.
 */
export async function createGuardianPortalAccount(studentId: string, guardianId: string, email: string) {
  const link = await prisma.studentGuardian.findUnique({
    where: { studentId_guardianId: { studentId, guardianId } },
    include: { guardian: true },
  });
  if (!link) throw ApiError.notFound("Guardian for this student");
  if (link.guardian.userId) throw ApiError.conflict("This guardian already has a portal account");

  const tempPassword = `Vrt-${crypto.randomBytes(6).toString("base64url")}`;
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash: await hashPassword(tempPassword),
        firstName: link.guardian.firstName,
        lastName: link.guardian.lastName,
        role: "PARENT",
        // The registrar hands over this temporary password — force a change.
        mustChangePassword: true,
      },
    });
    await tx.guardian.update({
      where: { id: guardianId },
      data: { userId: created.id, email: email.toLowerCase() },
    });
    return created;
  });

  return { email: user.email, temporaryPassword: tempPassword };
}
