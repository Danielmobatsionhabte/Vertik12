import type { MarkAttendanceInput } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";

/** Normalize any timestamp to midnight UTC so one record == one school day. */
function toDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

type Actor = { userId: string; role: string };

/**
 * Attendance is classified per subject/period:
 *  - Teachers MUST mark for a subject, and only one they teach in that class.
 *  - Admin/Registrar may mark a subject period or general (homeroom)
 *    attendance (no subject).
 */
async function assertCanMark(actor: Actor, classRoomId: string, subjectId?: string) {
  if (actor.role !== "TEACHER") return;
  if (!subjectId) {
    throw ApiError.badRequest("Teachers mark attendance per subject — choose the subject you teach");
  }
  const assignment = await prisma.classSubject.findFirst({
    where: { classRoomId, subjectId, teacher: { is: { userId: actor.userId } } },
  });
  if (!assignment) {
    throw ApiError.forbidden("You can only mark attendance for the subjects and classes assigned to you");
  }
}

/**
 * Bulk-upsert a register for one day (per subject, or general). Re-submitting
 * the same day/subject overwrites earlier statuses, so mistakes are fixable.
 */
export async function markAttendance(input: MarkAttendanceInput, actor: Actor) {
  await assertCanMark(actor, input.classRoomId, input.subjectId);
  const date = toDay(input.date);
  const subjectId = input.subjectId ?? null;

  // subjectId is nullable, so the compound unique can't drive an upsert —
  // resolve existing rows first, then update/create in one transaction.
  const existing = await prisma.attendanceRecord.findMany({
    where: { date, subjectId, studentId: { in: input.records.map((r) => r.studentId) } },
    select: { id: true, studentId: true },
  });
  const existingByStudent = new Map(existing.map((e) => [e.studentId, e.id]));

  await prisma.$transaction(
    input.records.map((r) => {
      const existingId = existingByStudent.get(r.studentId);
      return existingId
        ? prisma.attendanceRecord.update({
            where: { id: existingId },
            data: { status: r.status, note: r.note, markedById: actor.userId, classRoomId: input.classRoomId },
          })
        : prisma.attendanceRecord.create({
            data: {
              studentId: r.studentId, classRoomId: input.classRoomId, subjectId, date,
              status: r.status, note: r.note, markedById: actor.userId,
            },
          });
    }),
  );
  return { marked: input.records.length, date, subjectId };
}

/** The register for a class on a given day (per subject or general), including unmarked students. */
export async function classRegister(classRoomId: string, date: Date, subjectId?: string) {
  const day = toDay(date);
  const [enrollments, records] = await Promise.all([
    prisma.enrollment.findMany({
      where: { classRoomId, status: "ENROLLED" },
      include: { student: { select: { id: true, admissionNo: true, firstName: true, lastName: true, photoUrl: true } } },
      orderBy: { rollNo: "asc" },
    }),
    prisma.attendanceRecord.findMany({ where: { classRoomId, date: day, subjectId: subjectId ?? null } }),
  ]);
  const byStudent = new Map(records.map((r) => [r.studentId, r]));
  return enrollments.map((e) => ({
    student: e.student,
    rollNo: e.rollNo,
    status: byStudent.get(e.studentId)?.status ?? null,
    note: byStudent.get(e.studentId)?.note ?? null,
  }));
}

/** Per-student attendance summary between two dates (all subjects combined). */
export async function studentSummary(studentId: string, from?: Date, to?: Date) {
  const where = {
    studentId,
    ...(from || to ? { date: { ...(from ? { gte: toDay(from) } : {}), ...(to ? { lte: toDay(to) } : {}) } } : {}),
  };
  const records = await prisma.attendanceRecord.groupBy({ by: ["status"], where, _count: true });
  const counts = Object.fromEntries(records.map((r) => [r.status, r._count]));
  const total = records.reduce((s, r) => s + r._count, 0);
  const present = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);
  return { counts, total, rate: total === 0 ? null : Math.round((present / total) * 1000) / 10 };
}

/**
 * Printable attendance report between two dates: one row per student, one
 * column per school day, cells = status initials. Filter by class and/or a
 * single student; teachers are limited to classes where they teach.
 */
export async function attendanceReport(
  params: { classRoomId: string; studentId?: string; subjectId?: string; from: Date; to: Date },
  actor: Actor,
) {
  if (actor.role === "TEACHER") {
    const teaches = await prisma.classSubject.findFirst({
      where: { classRoomId: params.classRoomId, teacher: { is: { userId: actor.userId } } },
    });
    if (!teaches) throw ApiError.forbidden("You can only report on classes you teach");
  }

  const from = toDay(params.from);
  const to = toDay(params.to);
  if (from > to) throw ApiError.badRequest("'from' must be before 'to'");
  if ((to.getTime() - from.getTime()) / 86_400_000 > 92) {
    throw ApiError.badRequest("Reports cover at most ~3 months at a time");
  }

  const [classRoom, enrollments, records] = await Promise.all([
    prisma.classRoom.findUnique({ where: { id: params.classRoomId }, select: { name: true, gradeLevel: true } }),
    prisma.enrollment.findMany({
      where: {
        classRoomId: params.classRoomId,
        status: "ENROLLED",
        ...(params.studentId ? { studentId: params.studentId } : {}),
      },
      include: { student: { select: { id: true, admissionNo: true, firstName: true, lastName: true } } },
      orderBy: { rollNo: "asc" },
    }),
    prisma.attendanceRecord.findMany({
      where: {
        classRoomId: params.classRoomId,
        date: { gte: from, lte: to },
        ...(params.studentId ? { studentId: params.studentId } : {}),
        ...(params.subjectId ? { subjectId: params.subjectId } : {}),
      },
      select: { studentId: true, date: true, status: true },
    }),
  ]);
  if (!classRoom) throw ApiError.notFound("Class room");

  // Only days where at least one record exists (school days).
  const dayKeys = [...new Set(records.map((r) => r.date.toISOString().slice(0, 10)))].sort();
  const byStudentDay = new Map<string, string>();
  for (const r of records) byStudentDay.set(`${r.studentId}|${r.date.toISOString().slice(0, 10)}`, r.status);

  const rows = enrollments.map((e) => {
    const cells = dayKeys.map((d) => byStudentDay.get(`${e.student.id}|${d}`) ?? null);
    const present = cells.filter((c) => c === "PRESENT" || c === "LATE").length;
    const markedDays = cells.filter(Boolean).length;
    return {
      student: e.student,
      cells,
      presentDays: present,
      absentDays: cells.filter((c) => c === "ABSENT").length,
      rate: markedDays === 0 ? null : Math.round((present / markedDays) * 1000) / 10,
    };
  });

  return { classRoom, from, to, days: dayKeys, rows };
}
