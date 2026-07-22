import type { BulkEnrollInput, CreateStudentInput, PaginationQuery } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { hashPassword } from "../../lib/auth-tokens";
import { sendMail } from "../../lib/mailer";
import { parentPortalEmail, studentWelcomeEmail } from "../../lib/email-templates";
import { paginate, toSkipTake } from "../../lib/pagination";
import { assertGradeExists } from "../academics/academics.service";
import { yearFilterRange } from "../finance/finance.service";
import { documentStore } from "../../lib/document-store";

const PHOTOS = "student-photos"; // document-store collection

/** Sequential, human-readable admission numbers: VRT-2026-0001 */
async function nextAdmissionNo(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.student.count({ where: { admissionNo: { startsWith: `VRT-${year}-` } } });
  return `VRT-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function listStudents(
  q: PaginationQuery & { gradeLevel?: string; status?: string; classRoomId?: string; academicYearId?: string; sort?: string },
) {
  // Class and academic-year filters both go through the enrollment relation
  // and must land in ONE `some` clause so they apply to the same enrollment.
  // The year filter is what makes past years browsable after a rollover.
  const enrollmentFilter: Prisma.EnrollmentWhereInput = {
    ...(q.classRoomId ? { classRoomId: q.classRoomId } : {}),
    ...(q.academicYearId ? { academicYearId: q.academicYearId } : {}),
  };
  const where: Prisma.StudentWhereInput = {
    ...(q.gradeLevel ? { gradeLevel: q.gradeLevel } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.classRoomId || q.academicYearId ? { enrollments: { some: enrollmentFilter } } : {}),
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
  // Most recently registered first is the default; name/grade stay available.
  const orderBy: Prisma.StudentOrderByWithRelationInput[] =
    q.sort === "name"
      ? [{ lastName: "asc" }, { firstName: "asc" }]
      : q.sort === "grade"
        ? [{ gradeLevel: "asc" }, { lastName: "asc" }]
        : [{ admittedAt: "desc" }, { createdAt: "desc" }];
  const [items, total] = await Promise.all([
    prisma.student.findMany({
      where,
      ...toSkipTake(q),
      orderBy,
      include: {
        enrollments: {
          // Show the class of the year being viewed (active year by default).
          where: q.academicYearId ? { academicYearId: q.academicYearId } : { academicYear: { isActive: true } },
          include: { classRoom: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.student.count({ where }),
  ]);
  return paginate(items, total, q);
}

/**
 * Per-academic-year student report for the admin/registrar: every student
 * enrolled in the chosen year with the class they were in THAT year, plus
 * summary counts. After a new-year rollover the previous years stay fully
 * reportable — pick the year, generate, print or export.
 */
export async function studentsYearReport(
  academicYearId: string,
  filters: { gradeLevel?: string; status?: string },
) {
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) throw ApiError.notFound("Academic year");

  const enrollments = await prisma.enrollment.findMany({
    where: {
      academicYearId,
      // Grade means the grade of the class in that year, not the student's
      // current grade (which advances with every rollover).
      ...(filters.gradeLevel ? { classRoom: { is: { gradeLevel: filters.gradeLevel } } } : {}),
      ...(filters.status ? { student: { is: { status: filters.status } } } : {}),
    },
    include: {
      student: {
        select: {
          id: true, admissionNo: true, firstName: true, lastName: true,
          gender: true, status: true, admittedAt: true,
        },
      },
      classRoom: { select: { name: true, gradeLevel: true } },
    },
    orderBy: [{ classRoom: { gradeLevel: "asc" } }, { classRoom: { name: "asc" } }, { student: { lastName: "asc" } }],
  });

  const rows = enrollments.map((e) => ({
    studentId: e.student.id,
    admissionNo: e.student.admissionNo,
    firstName: e.student.firstName,
    lastName: e.student.lastName,
    gender: e.student.gender,
    status: e.student.status,
    admittedAt: e.student.admittedAt,
    gradeLevel: e.classRoom.gradeLevel,
    className: e.classRoom.name,
    enrollmentStatus: e.status,
  }));

  const countBy = (key: (r: (typeof rows)[number]) => string) => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
    return [...map.entries()].map(([label, count]) => ({ label, count }));
  };

  return {
    year: { id: year.id, name: year.name, startDate: year.startDate, endDate: year.endDate, isActive: year.isActive },
    rows,
    totals: {
      students: rows.length,
      // Students admitted while this year was running = that year's intake.
      newAdmissions: rows.filter((r) => r.admittedAt >= year.startDate && r.admittedAt <= year.endDate).length,
      byGrade: countBy((r) => r.gradeLevel).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
      byGender: countBy((r) => r.gender),
      byStatus: countBy((r) => r.status),
      byClass: countBy((r) => r.className),
    },
  };
}

/**
 * 360° profile, scoped to what the viewer's role may see:
 *  - TEACHER: no finance data (fees are not a teacher's business)
 *  - ACCOUNTANT: no exam results (grades are not an accountant's business)
 *
 * Billing is year-scoped: invoices (and the finance summary computed from
 * them) show the requested academic year, defaulting to the admin's active
 * year — so after a rollover the profile shows THIS year's billing, and
 * previous years stay reachable by passing their id.
 */
export async function getStudent(id: string, viewerRole: string, academicYearId?: string) {
  const canSeeFinance = viewerRole !== "TEACHER";
  const canSeeResults = viewerRole !== "ACCOUNTANT";

  const financeYear = academicYearId
    ? await prisma.academicYear.findUnique({ where: { id: academicYearId } })
    : await prisma.academicYear.findFirst({ where: { isActive: true } });
  if (academicYearId && !financeYear) throw ApiError.notFound("Academic year");
  // Same window rule as the finance module: the active year is open-ended
  // around its term dates so a payment collected out of term (e.g. summer
  // registration) still shows on the profile — otherwise a just-collected
  // invoice would be missing from this student's Invoices/Transactions.
  const issued = financeYear ? await yearFilterRange(financeYear.id) : undefined;

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      guardians: { include: { guardian: true } },
      enrollments: { include: { classRoom: true, academicYear: true }, orderBy: { createdAt: "desc" } },
      ...(canSeeFinance
        ? {
            invoices: {
              ...(issued ? { where: { issueDate: issued } } : {}),
              include: { items: true, payments: true },
              orderBy: { issueDate: "desc" as const },
              take: 30,
            },
          }
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

  const [totalDays, presentDays, settings] = await Promise.all([
    prisma.attendanceRecord.count({ where: { studentId: id } }),
    prisma.attendanceRecord.count({ where: { studentId: id, status: { in: ["PRESENT", "LATE"] } } }),
    prisma.schoolSettings.findUnique({ where: { id: "school" }, select: { currency: true } }),
  ]);

  const invoices = (student as unknown as {
    invoices?: Array<{
      id: string;
      number: string;
      currency: string;
      status: string;
      issueDate: Date;
      items: { amount: number }[];
      payments: Array<{
        id: string;
        amount: number;
        method: string;
        status: string;
        provider: string;
        providerRef: string | null;
        note: string | null;
        paidAt: Date | null;
        createdAt: Date;
      }>;
    }>;
  }).invoices;
  const invoiced = (invoices ?? [])
    .filter((i) => i.status !== "VOID")
    .reduce((sum, i) => sum + i.items.reduce((s, it) => s + it.amount, 0), 0);
  const paid = (invoices ?? [])
    .flatMap((i) => i.payments)
    .filter((p) => p.status === "SUCCEEDED")
    .reduce((sum, p) => sum + p.amount, 0);

  // Flat transaction history for this student (every payment across their
  // invoices for the viewed year), newest first — drives the profile's
  // Transactions card so a collection is visible against the student at once.
  const transactions = canSeeFinance
    ? (invoices ?? [])
        .flatMap((inv) =>
          inv.payments.map((p) => ({
            id: p.id,
            amount: p.amount,
            method: p.method,
            status: p.status,
            provider: p.provider,
            providerRef: p.providerRef,
            note: p.note,
            paidAt: p.paidAt,
            createdAt: p.createdAt,
            invoice: { id: inv.id, number: inv.number, currency: inv.currency },
          })),
        )
        .sort(
          (a, b) =>
            new Date(b.paidAt ?? b.createdAt).getTime() - new Date(a.paidAt ?? a.createdAt).getTime(),
        )
    : null;

  return {
    ...student,
    invoices: invoices ?? null,
    transactions,
    examResults: (student as { examResults?: unknown[] }).examResults ?? null,
    attendanceRate: totalDays === 0 ? null : Math.round((presentDays / totalDays) * 1000) / 10,
    financeSummary: canSeeFinance ? { invoiced, paid, outstanding: invoiced - paid } : null,
    // The school's configured billing currency, so every money value on the
    // profile follows Administration → School settings rather than a default.
    currency: settings?.currency ?? "USD",
    // Which year the invoices/summary cover, so the UI can label and switch it.
    financeYear: financeYear
      ? { id: financeYear.id, name: financeYear.name, isActive: financeYear.isActive }
      : null,
  };
}

export async function createStudent(input: CreateStudentInput) {
  const { guardians, classRoomId, ...data } = input;
  await assertGradeExists(input.gradeLevel); // ladder is admin-configured

  const { student, className } = await prisma.$transaction(async (tx) => {
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
    let className: string | undefined;
    if (classRoomId) {
      const classRoom = await tx.classRoom.findUnique({ where: { id: classRoomId } });
      if (!classRoom) throw ApiError.notFound("Class room");
      if (classRoom.gradeLevel !== student.gradeLevel) {
        throw ApiError.badRequest(
          `${classRoom.name} is a grade ${classRoom.gradeLevel} section but this student is in grade ${student.gradeLevel} — ` +
          `pick a section of grade ${student.gradeLevel}`,
        );
      }
      // Withdrawn enrollments are not occupants — see occupancyOf().
      const taken = await tx.enrollment.count({ where: { classRoomId, status: { not: "WITHDRAWN" } } });
      if (taken >= classRoom.capacity) {
        throw ApiError.badRequest(
          `${classRoom.name} is full (${taken}/${classRoom.capacity} students) — pick another section or raise its capacity`,
        );
      }
      await tx.enrollment.create({
        data: { studentId: student.id, classRoomId, academicYearId: classRoom.academicYearId },
      });
      className = classRoom.name;
    }
    return { student, className };
  });

  // EMAIL PATH: student registration → admission confirmation, sent to the
  // student's own email and the primary guardian's (whichever exist).
  // Fire-and-forget: a mail outage must never fail the registration itself.
  const primaryGuardianEmail = (guardians.find((g) => g.isPrimary) ?? guardians[0])?.email;
  const recipients = [...new Set([student.email, primaryGuardianEmail].filter((e): e is string => !!e))];
  if (recipients.length > 0) {
    const html = studentWelcomeEmail({
      firstName: student.firstName,
      lastName: student.lastName,
      admissionNo: student.admissionNo,
      gradeLevel: student.gradeLevel,
      className,
    });
    for (const to of recipients) {
      void sendMail({ to, subject: `Welcome to Vertik12 — admission confirmed`, html })
        .catch((err) => console.error("[mailer] student welcome email failed:", err));
    }
  }

  return student;
}

/**
 * Seats actually taken in a class. Withdrawn enrollments are not occupants —
 * counting them would make a class look full while empty desks sit in it.
 */
const occupancyOf = (classRoomId: string) =>
  prisma.enrollment.count({ where: { classRoomId, status: { not: "WITHDRAWN" } } });

/**
 * Move a student into a class — the registrar's "change this student's
 * section" (Grade 5 — A → Grade 5 — B), and the same path used when a
 * student is admitted straight into a class.
 *
 * A student holds one enrollment per academic year (enforced by a unique
 * index), so switching section UPDATES that row rather than adding another:
 * the child is never in two sections of the same year at once.
 */
export async function placeStudentInClass(studentId: string, classRoomId: string, gradeLevel: string) {
  const classRoom = await prisma.classRoom.findUnique({ where: { id: classRoomId } });
  if (!classRoom) throw ApiError.notFound("Class room");

  // A Grade 5 pupil does not belong in a Grade 7 section. Grade and class
  // are edited on the same form, so the fix is one dropdown away — say which
  // two values disagree rather than silently filing the mismatch.
  if (classRoom.gradeLevel !== gradeLevel) {
    throw ApiError.badRequest(
      `${classRoom.name} is a grade ${classRoom.gradeLevel} section but this student is in grade ${gradeLevel} — ` +
      `change the grade level too, or pick a section of grade ${gradeLevel}`,
    );
  }

  const current = await prisma.enrollment.findUnique({
    where: { studentId_academicYearId: { studentId, academicYearId: classRoom.academicYearId } },
    include: { classRoom: { select: { id: true, name: true } } },
  });
  if (current?.classRoomId === classRoomId) {
    return { moved: false, from: current.classRoom.name, to: classRoom.name };
  }

  // Only a genuine arrival consumes a seat; a student already in this class
  // is excluded above, so any move here is a net +1 for the target.
  const taken = await occupancyOf(classRoomId);
  if (taken >= classRoom.capacity) {
    throw ApiError.badRequest(
      `${classRoom.name} is full (${taken}/${classRoom.capacity} students) — pick another section or raise its capacity`,
    );
  }

  await prisma.enrollment.upsert({
    where: { studentId_academicYearId: { studentId, academicYearId: classRoom.academicYearId } },
    create: { studentId, classRoomId, academicYearId: classRoom.academicYearId },
    // The roll number belonged to the old section's register, so it is
    // cleared on the way out instead of following the student and colliding.
    update: { classRoomId, rollNo: null },
  });
  return { moved: true, from: current?.classRoom.name ?? null, to: classRoom.name };
}

export async function updateStudent(id: string, input: Record<string, unknown>) {
  const { classRoomId, ...data } = input as { classRoomId?: string } & Record<string, unknown>;
  const student = await prisma.student.update({ where: { id }, data });

  if (classRoomId) {
    // Validated against the grade the student now has, so changing grade and
    // section in one save is a single consistent move.
    await placeStudentInClass(id, classRoomId, student.gradeLevel);
  }
  return student;
}

/** Soft delete: mark WITHDRAWN. Historical records (grades, invoices) stay intact. */
export async function withdrawStudent(id: string) {
  return prisma.student.update({ where: { id }, data: { status: "WITHDRAWN" } });
}

// ==================== student photo ====================

/**
 * Registrar/Admin uploads or captures the student's picture (optional,
 * replaceable any time). The image body lives in the document store; the
 * SQL row keeps only the reference.
 */
export async function setStudentPhoto(id: string, photo: { name: string; type: string; dataBase64: string }) {
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw ApiError.notFound("Student");
  const photoRef = await documentStore.put(PHOTOS, { name: photo.name, type: photo.type, data: photo.dataBase64 });
  await prisma.student.update({ where: { id }, data: { photoRef, photoType: photo.type } });
  return { photoRef };
}

export async function removeStudentPhoto(id: string) {
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw ApiError.notFound("Student");
  return prisma.student.update({ where: { id }, data: { photoRef: null, photoType: null } });
}

/**
 * Streams the stored photo. Staff may view any student; a parent only
 * their own children (the portal shows the child's picture too).
 */
export async function getStudentPhoto(id: string, viewer: { userId: string; role: string }) {
  const student = await prisma.student.findUnique({ where: { id }, select: { photoRef: true, photoType: true } });
  if (!student?.photoRef) throw ApiError.notFound("Photo");
  if (viewer.role === "PARENT") {
    const link = await prisma.studentGuardian.findFirst({
      where: { studentId: id, guardian: { is: { userId: viewer.userId } } },
    });
    if (!link) throw ApiError.forbidden("You do not have access to this student's records");
  } else if (viewer.role === "STUDENT") {
    const self = await prisma.student.findFirst({ where: { id, userId: viewer.userId } });
    if (!self) throw ApiError.forbidden("You can only view your own photo");
  }
  const doc = await documentStore.get(PHOTOS, student.photoRef);
  if (!doc) throw ApiError.notFound("Photo");
  return {
    type: (doc.type as string) ?? student.photoType ?? "image/jpeg",
    buffer: Buffer.from((doc.data as string) ?? "", "base64"),
  };
}

// ==================== student documents ====================

const DOCUMENTS = "student-documents"; // document-store collection

/**
 * Paperwork on the student's file (guardian ID, birth certificate…),
 * captured by webcam or uploaded. Registrar/Admin manage; staff can read.
 */
export async function addStudentDocument(
  studentId: string,
  input: { label: string; attachment: { name: string; type: string; dataBase64: string } },
  uploadedById: string,
) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw ApiError.notFound("Student");
  const fileRef = await documentStore.put(DOCUMENTS, {
    name: input.attachment.name,
    type: input.attachment.type,
    data: input.attachment.dataBase64,
  });
  return prisma.studentDocument.create({
    data: {
      studentId,
      label: input.label,
      fileRef,
      fileName: input.attachment.name,
      fileType: input.attachment.type,
      uploadedById,
    },
  });
}

export const listStudentDocuments = (studentId: string) =>
  prisma.studentDocument.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, fileName: true, fileType: true, createdAt: true },
  });

export async function getStudentDocument(studentId: string, docId: string) {
  const doc = await prisma.studentDocument.findFirst({ where: { id: docId, studentId } });
  if (!doc) throw ApiError.notFound("Document");
  const stored = await documentStore.get(DOCUMENTS, doc.fileRef);
  if (!stored) throw ApiError.notFound("Document");
  return {
    name: doc.fileName,
    type: doc.fileType,
    buffer: Buffer.from((stored.data as string) ?? "", "base64"),
  };
}

export async function removeStudentDocument(studentId: string, docId: string) {
  const doc = await prisma.studentDocument.findFirst({ where: { id: docId, studentId } });
  if (!doc) throw ApiError.notFound("Document");
  return prisma.studentDocument.delete({ where: { id: docId } });
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
  const classRoom = await prisma.classRoom.findUnique({ where: { id: input.classRoomId } });
  if (!classRoom) throw ApiError.notFound("Class room");

  const students = await prisma.student.findMany({
    where: { id: { in: input.studentIds }, status: "ACTIVE" },
    select: { id: true, gradeLevel: true },
  });
  if (students.length !== input.studentIds.length) {
    throw ApiError.badRequest("One or more selected students are not active");
  }
  const wrongGrade = students.filter((s) => s.gradeLevel !== classRoom.gradeLevel);
  if (wrongGrade.length > 0) {
    throw ApiError.badRequest(
      `${classRoom.name} is a grade ${classRoom.gradeLevel} section, but ${wrongGrade.length} selected ` +
      `student(s) are in another grade — move them to a section of their own grade`,
    );
  }

  // Only students not already sitting in this class take a new seat, so
  // re-running a partly-done assignment doesn't report a phantom overflow.
  const alreadyHere = await prisma.enrollment.findMany({
    where: { classRoomId: classRoom.id, studentId: { in: input.studentIds } },
    select: { studentId: true },
  });
  const newSeats = input.studentIds.length - alreadyHere.length;
  const taken = await occupancyOf(classRoom.id);
  if (taken + newSeats > classRoom.capacity) {
    throw ApiError.badRequest(
      `${classRoom.name} has ${Math.max(0, classRoom.capacity - taken)} free seat(s) — cannot add ${newSeats} student(s)`,
    );
  }

  await prisma.$transaction(
    input.studentIds.map((studentId) =>
      prisma.enrollment.upsert({
        where: { studentId_academicYearId: { studentId, academicYearId: classRoom.academicYearId } },
        create: { studentId, classRoomId: classRoom.id, academicYearId: classRoom.academicYearId },
        // Moving between sections invalidates the old register position.
        update: { classRoomId: classRoom.id, rollNo: null },
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

  // EMAIL PATH: parent portal registration → sign-in details (incl. the
  // temporary password) to the new portal account's address. Fire-and-forget.
  void sendMail({
    to: user.email,
    subject: `Your Vertik12 parent portal access`,
    html: parentPortalEmail({ firstName: link.guardian.firstName, email: user.email, temporaryPassword: tempPassword }),
  }).catch((err) => console.error("[mailer] parent portal email failed:", err));

  return { email: user.email, temporaryPassword: tempPassword };
}
