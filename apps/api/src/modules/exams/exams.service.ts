import type { RecordResultsInput } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { getGradeScale, gradeFor } from "../../lib/grading";

export const listExams = () =>
  prisma.exam.findMany({
    orderBy: { createdAt: "desc" },
    include: { term: { include: { academicYear: { select: { name: true } } } }, _count: { select: { results: true } } },
  });

/** Category must be one of the admin-managed exam types. */
async function assertValidCategory(category: string) {
  const type = await prisma.examType.findUnique({ where: { name: category } });
  if (!type) {
    const types = await prisma.examType.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } });
    throw ApiError.badRequest(`Unknown exam type "${category}". Valid types: ${types.map((t) => t.name).join(", ")}`);
  }
}

export async function createExam(
  input: { name: string; category: string; termId: string; weight: number; startDate?: Date },
  createdBy: string,
) {
  await assertValidCategory(input.category);
  return prisma.exam.create({ data: { ...input, createdBy } });
}

/** Teachers may edit/cancel only assessments they created; admins any. */
async function examForEdit(examId: string, actor: { userId: string; role: string }) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { _count: { select: { results: true } } } });
  if (!exam) throw ApiError.notFound("Exam");
  if (actor.role === "TEACHER" && exam.createdBy !== actor.userId) {
    throw ApiError.forbidden("You can only modify assessments you scheduled yourself");
  }
  return exam;
}

export async function updateExam(
  examId: string,
  input: Partial<{ name: string; category: string; termId: string; weight: number; startDate?: Date }>,
  actor: { userId: string; role: string },
) {
  await examForEdit(examId, actor);
  if (input.category) await assertValidCategory(input.category);
  return prisma.exam.update({ where: { id: examId }, data: input });
}

export async function deleteExam(examId: string, actor: { userId: string; role: string }) {
  const exam = await examForEdit(examId, actor);
  // Cancelling a graded assessment would silently erase recorded marks.
  if (exam._count.results > 0) {
    throw ApiError.badRequest(`"${exam.name}" already has ${exam._count.results} recorded result(s) and cannot be removed`);
  }
  return prisma.exam.delete({ where: { id: examId } });
}

// ==================== exam types (admin-managed) ====================

export const listExamTypes = () => prisma.examType.findMany({ orderBy: { sortOrder: "asc" } });

export async function createExamType(name: string) {
  const count = await prisma.examType.count();
  return prisma.examType.create({ data: { name: name.trim(), sortOrder: count } });
}

export async function deleteExamType(id: string) {
  const type = await prisma.examType.findUnique({ where: { id } });
  if (!type) throw ApiError.notFound("Exam type");
  const inUse = await prisma.exam.count({ where: { category: type.name } });
  if (inUse > 0) throw ApiError.badRequest(`"${type.name}" is used by ${inUse} assessment(s) and cannot be deleted`);
  return prisma.examType.delete({ where: { id } });
}

/** Teacher's assignment for a class × subject, or null. */
async function teacherAssignment(userId: string, classRoomId: string, subjectId: string) {
  return prisma.classSubject.findFirst({
    where: { classRoomId, subjectId, teacher: { is: { userId } } },
  });
}

async function assertCanGrade(actor: { userId: string; role: string }, classRoomId: string, subjectId: string) {
  if (actor.role !== "TEACHER") return; // ADMIN / SUPER_ADMIN pass
  if (!(await teacherAssignment(actor.userId, classRoomId, subjectId))) {
    throw ApiError.forbidden("You can only work with results for the subjects and classes assigned to you");
  }
}

/**
 * Existing marks + lock state for one exam × class × subject — drives the
 * gradebook (teachers see/edit only their own subjects' results).
 */
export async function getResults(
  params: { examId: string; classRoomId: string; subjectId: string },
  actor: { userId: string; role: string },
) {
  await assertCanGrade(actor, params.classRoomId, params.subjectId);
  const [results, submission] = await Promise.all([
    prisma.examResult.findMany({
      where: {
        examId: params.examId,
        subjectId: params.subjectId,
        student: { enrollments: { some: { classRoomId: params.classRoomId } } },
      },
      select: { studentId: true, marks: true, maxMarks: true, grade: true, remark: true },
    }),
    prisma.resultSubmission.findUnique({
      where: { examId_classRoomId_subjectId: { examId: params.examId, classRoomId: params.classRoomId, subjectId: params.subjectId } },
    }),
  ]);
  return {
    results,
    submission, // null = draft, teacher can edit
    locked: submission?.status === "SUBMITTED" || submission?.status === "APPROVED",
  };
}

/**
 * Bulk-record marks for one exam × subject × class. The letter grade is
 * computed server-side from the percentage so grading is consistent.
 *
 * Ownership rule: teachers may only grade the class × subject pairs
 * assigned to them (ClassSubject.teacher). A teacher of two subjects can
 * grade exactly those two — nothing else. Admins/Super Admins may grade
 * anything (e.g. covering for an absent teacher).
 */
export async function recordResults(input: RecordResultsInput, actor: { userId: string; role: string }) {
  const exam = await prisma.exam.findUnique({ where: { id: input.examId } });
  if (!exam) throw ApiError.notFound("Exam");

  await assertCanGrade(actor, input.classRoomId, input.subjectId);

  // Once marks are sent to the registrar (or approved), they are locked.
  const submission = await prisma.resultSubmission.findUnique({
    where: { examId_classRoomId_subjectId: { examId: input.examId, classRoomId: input.classRoomId, subjectId: input.subjectId } },
  });
  if (submission && submission.status !== "REJECTED") {
    throw ApiError.badRequest(
      submission.status === "APPROVED"
        ? "These results were approved by the registrar and can no longer be changed"
        : "These results were sent to the registrar and are locked until reviewed",
    );
  }

  // Only students enrolled in that class can receive a result for it.
  const enrolled = await prisma.enrollment.findMany({
    where: { classRoomId: input.classRoomId, studentId: { in: input.results.map((r) => r.studentId) } },
    select: { studentId: true },
  });
  const enrolledIds = new Set(enrolled.map((e) => e.studentId));
  const notEnrolled = input.results.filter((r) => !enrolledIds.has(r.studentId));
  if (notEnrolled.length > 0) {
    throw ApiError.badRequest(`${notEnrolled.length} student(s) are not enrolled in this class`);
  }

  const invalid = input.results.filter((r) => r.marks > input.maxMarks);
  if (invalid.length > 0) throw ApiError.badRequest(`Marks exceed maxMarks (${input.maxMarks}) for ${invalid.length} student(s)`);

  const scale = await getGradeScale(); // admin-configured (country-specific) bands
  await prisma.$transaction(
    input.results.map((r) => {
      const pct = (r.marks / input.maxMarks) * 100;
      const { letter } = gradeFor(pct, scale);
      return prisma.examResult.upsert({
        where: {
          examId_studentId_subjectId: { examId: input.examId, studentId: r.studentId, subjectId: input.subjectId },
        },
        create: {
          examId: input.examId, studentId: r.studentId, subjectId: input.subjectId,
          marks: r.marks, maxMarks: input.maxMarks, grade: letter, remark: r.remark,
        },
        update: { marks: r.marks, maxMarks: input.maxMarks, grade: letter, remark: r.remark },
      });
    }),
  );
  return { recorded: input.results.length };
}

/**
 * Report card: per-subject weighted average across all exams of a term,
 * with letter grade and GPA.
 */
export async function reportCard(studentId: string, termId: string) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw ApiError.notFound("Student");

  const [results, term, scale, approval, settings] = await Promise.all([
    prisma.examResult.findMany({
      where: { studentId, exam: { termId } },
      include: { exam: true, subject: true },
    }),
    prisma.term.findUnique({ where: { id: termId }, include: { academicYear: true } }),
    getGradeScale(),
    prisma.reportCardApproval.findUnique({ where: { studentId_termId: { studentId, termId } } }),
    prisma.schoolSettings.findUnique({ where: { id: "school" } }),
  ]);
  if (!term) throw ApiError.notFound("Term");

  // Group by subject; weight each exam's percentage by exam.weight.
  const bySubject = new Map<string, { subject: { id: string; code: string; name: string }; weighted: number; totalWeight: number; entries: typeof results }>();
  for (const r of results) {
    const key = r.subjectId;
    const entry = bySubject.get(key) ?? { subject: r.subject, weighted: 0, totalWeight: 0, entries: [] as typeof results };
    entry.weighted += (r.marks / r.maxMarks) * 100 * r.exam.weight;
    entry.totalWeight += r.exam.weight;
    entry.entries.push(r);
    bySubject.set(key, entry);
  }

  const subjects = [...bySubject.values()].map((s) => {
    const pct = s.totalWeight === 0 ? 0 : s.weighted / s.totalWeight;
    const { letter, points } = gradeFor(pct, scale);
    return {
      subject: s.subject,
      percentage: Math.round(pct * 10) / 10,
      grade: letter,
      points,
      exams: s.entries.map((e) => ({ exam: e.exam.name, marks: e.marks, maxMarks: e.maxMarks, grade: e.grade })),
    };
  });

  const gpa = subjects.length === 0 ? null
    : Math.round((subjects.reduce((s, x) => s + x.points, 0) / subjects.length) * 100) / 100;

  const overall = subjects.length === 0 ? null
    : Math.round((subjects.reduce((s, x) => s + x.percentage, 0) / subjects.length) * 10) / 10;

  return {
    school: settings ? { name: settings.schoolName, motto: settings.motto, address: settings.address } : null,
    student: { id: student.id, name: `${student.firstName} ${student.lastName}`, admissionNo: student.admissionNo, gradeLevel: student.gradeLevel },
    term: { id: term.id, name: term.name, academicYear: term.academicYear.name },
    subjects,
    gpa,
    overall,
    overallGrade: overall === null ? null : gradeFor(overall, scale).letter,
    scale,
    approval: approval ? { approvedAt: approval.approvedAt, approvedById: approval.approvedById } : null,
  };
}

// ==================== result submissions (teacher → registrar) ====================

/** Teacher sends a graded exam × class × subject to the registrar; marks lock. */
export async function submitResults(
  params: { examId: string; classRoomId: string; subjectId: string },
  actor: { userId: string; role: string },
) {
  await assertCanGrade(actor, params.classRoomId, params.subjectId);
  const resultCount = await prisma.examResult.count({
    where: {
      examId: params.examId,
      subjectId: params.subjectId,
      student: { enrollments: { some: { classRoomId: params.classRoomId } } },
    },
  });
  if (resultCount === 0) throw ApiError.badRequest("Record at least one result before sending to the registrar");

  const staff = await prisma.staff.findUnique({ where: { userId: actor.userId } });
  const where = { examId_classRoomId_subjectId: params };
  const existing = await prisma.resultSubmission.findUnique({ where });
  if (existing && existing.status !== "REJECTED") {
    throw ApiError.conflict("These results were already sent to the registrar");
  }
  return prisma.resultSubmission.upsert({
    where,
    create: { ...params, teacherId: staff?.id, status: "SUBMITTED" },
    update: { status: "SUBMITTED", submittedAt: new Date(), reviewedAt: null, reviewedById: null, note: null },
  });
}

/** Registrar queue (all) or a teacher's own submission history. */
export async function listSubmissions(actor: { userId: string; role: string }) {
  let teacherFilter = {};
  if (actor.role === "TEACHER") {
    const staffRow = await prisma.staff.findUnique({ where: { userId: actor.userId } });
    teacherFilter = { teacherId: staffRow?.id ?? "-" };
  }
  const submissions = await prisma.resultSubmission.findMany({
    where: teacherFilter,
    orderBy: { submittedAt: "desc" },
    include: { exam: { include: { term: { select: { name: true } } } } },
  });
  // Resolve class/subject/teacher names in one pass.
  const [classRooms, subjects, staff] = await Promise.all([
    prisma.classRoom.findMany({ where: { id: { in: submissions.map((s) => s.classRoomId) } }, select: { id: true, name: true } }),
    prisma.subject.findMany({ where: { id: { in: submissions.map((s) => s.subjectId) } }, select: { id: true, name: true } }),
    prisma.staff.findMany({
      where: { id: { in: submissions.map((s) => s.teacherId).filter((t): t is string => !!t) } },
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const classById = new Map(classRooms.map((c) => [c.id, c.name]));
  const subjectById = new Map(subjects.map((s) => [s.id, s.name]));
  const staffById = new Map(staff.map((s) => [s.id, `${s.user.firstName} ${s.user.lastName}`]));
  return submissions.map((s) => ({
    ...s,
    className: classById.get(s.classRoomId) ?? "?",
    subjectName: subjectById.get(s.subjectId) ?? "?",
    teacherName: s.teacherId ? staffById.get(s.teacherId) ?? "—" : "—",
  }));
}

/** Registrar approves (locks permanently) or rejects (reopens for the teacher). */
export async function reviewSubmission(id: string, action: "APPROVE" | "REJECT", note: string | undefined, reviewedById: string) {
  const submission = await prisma.resultSubmission.findUnique({ where: { id } });
  if (!submission) throw ApiError.notFound("Result submission");
  if (submission.status !== "SUBMITTED") throw ApiError.badRequest(`This submission is already ${submission.status.toLowerCase()}`);
  return prisma.resultSubmission.update({
    where: { id },
    data: {
      status: action === "APPROVE" ? "APPROVED" : "REJECTED",
      note,
      reviewedAt: new Date(),
      reviewedById,
    },
  });
}

/** Registrar/Admin sign-off that releases the report card for printing. */
export async function approveReportCard(studentId: string, termId: string, approvedById: string) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) throw ApiError.notFound("Student");
  return prisma.reportCardApproval.upsert({
    where: { studentId_termId: { studentId, termId } },
    create: { studentId, termId, approvedById },
    update: { approvedById, approvedAt: new Date() },
  });
}
