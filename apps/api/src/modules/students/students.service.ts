import type { BulkEnrollInput, CreateStudentInput, PaginationQuery } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { hashPassword } from "../../lib/auth-tokens";
import { paginate, toSkipTake } from "../../lib/pagination";
import { assertGradeExists } from "../academics/academics.service";
import { documentStore } from "../../lib/document-store";

const PHOTOS = "student-photos"; // document-store collection

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
  await assertGradeExists(input.gradeLevel); // ladder is admin-configured

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
      const classRoom = await tx.classRoom.findUnique({
        where: { id: classRoomId },
        include: { _count: { select: { enrollments: true } } },
      });
      if (!classRoom) throw ApiError.notFound("Class room");
      if (classRoom._count.enrollments >= classRoom.capacity) {
        throw ApiError.badRequest(
          `${classRoom.name} is full (${classRoom._count.enrollments}/${classRoom.capacity} students) — pick another section or raise its capacity`,
        );
      }
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
    const classRoom = await prisma.classRoom.findUnique({
      where: { id: classRoomId },
      include: { _count: { select: { enrollments: true } } },
    });
    if (!classRoom) throw ApiError.notFound("Class room");
    const alreadyHere = await prisma.enrollment.findFirst({ where: { studentId: id, classRoomId } });
    if (!alreadyHere && classRoom._count.enrollments >= classRoom.capacity) {
      throw ApiError.badRequest(
        `${classRoom.name} is full (${classRoom._count.enrollments}/${classRoom.capacity} students) — pick another section or raise its capacity`,
      );
    }
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
