import type { CreateAssignmentInput, SubmitAssignmentInput } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { documentStore } from "../../lib/document-store";

const SUBMISSIONS = "assignment-submissions"; // document-store collection

type Actor = { userId: string; role: string };

/** Teachers may only touch assignments on their own class × subject. */
async function assertOwnClassSubject(actor: Actor, classSubjectId: string) {
  const classSubject = await prisma.classSubject.findUnique({
    where: { id: classSubjectId },
    include: { teacher: { select: { userId: true } } },
  });
  if (!classSubject) throw ApiError.notFound("Class subject");
  if (actor.role === "TEACHER" && classSubject.teacher?.userId !== actor.userId) {
    throw ApiError.forbidden("You can only manage assignments for the subjects and classes assigned to you");
  }
  return classSubject;
}

// ============================ teacher side ============================

export async function listMine(actor: Actor) {
  const where =
    actor.role === "TEACHER"
      ? { classSubject: { teacher: { is: { userId: actor.userId } } } }
      : {};
  return prisma.assignment.findMany({
    where,
    orderBy: { dueDate: "desc" },
    include: {
      classSubject: {
        include: {
          subject: { select: { name: true, code: true } },
          classRoom: { select: { id: true, name: true, _count: { select: { enrollments: true } } } },
        },
      },
      _count: { select: { submissions: true } },
    },
  });
}

export async function createAssignment(input: CreateAssignmentInput, actor: Actor) {
  await assertOwnClassSubject(actor, input.classSubjectId);
  return prisma.assignment.create({ data: { ...input, createdById: actor.userId } });
}

/** Submissions for one assignment, with bodies pulled from the document store. */
export async function submissionsFor(assignmentId: string, actor: Actor) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      classSubject: { include: { subject: true, classRoom: true, teacher: { select: { userId: true } } } },
      submissions: {
        include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
        orderBy: { submittedAt: "asc" },
      },
    },
  });
  if (!assignment) throw ApiError.notFound("Assignment");
  if (actor.role === "TEACHER" && assignment.classSubject.teacher?.userId !== actor.userId) {
    throw ApiError.forbidden("This assignment belongs to another teacher");
  }
  const submissions = await Promise.all(
    assignment.submissions.map(async (s) => ({
      ...s,
      content: ((await documentStore.get(SUBMISSIONS, s.contentRef))?.content as string | undefined) ?? "(content unavailable)",
    })),
  );
  return { ...assignment, submissions };
}

export async function giveFeedback(submissionId: string, input: { feedback: string; grade?: string }, actor: Actor) {
  const submission = await prisma.assignmentSubmission.findUnique({
    where: { id: submissionId },
    include: { assignment: { include: { classSubject: { include: { teacher: { select: { userId: true } } } } } } },
  });
  if (!submission) throw ApiError.notFound("Submission");
  if (actor.role === "TEACHER" && submission.assignment.classSubject.teacher?.userId !== actor.userId) {
    throw ApiError.forbidden("This submission belongs to another teacher's assignment");
  }
  return prisma.assignmentSubmission.update({ where: { id: submissionId }, data: input });
}

// ============================ parent side ============================

async function assertParentOfStudent(parentUserId: string, studentId: string) {
  const link = await prisma.studentGuardian.findFirst({
    where: { studentId, guardian: { is: { userId: parentUserId } } },
  });
  if (!link) throw ApiError.forbidden("You do not have access to this student's records");
}

/** The child's assignments (through their class), with their own submission state. */
export async function assignmentsForChild(parentUserId: string, studentId: string) {
  await assertParentOfStudent(parentUserId, studentId);
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, academicYear: { isActive: true } },
    select: { classRoomId: true },
  });
  if (!enrollment) return [];
  const assignments = await prisma.assignment.findMany({
    where: { classSubject: { classRoomId: enrollment.classRoomId } },
    orderBy: { dueDate: "desc" },
    include: {
      classSubject: {
        include: {
          subject: { select: { name: true } },
          teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
        },
      },
      submissions: { where: { studentId }, select: { id: true, submittedAt: true, feedback: true, grade: true, linkUrl: true } },
    },
  });
  return assignments.map((a) => ({
    id: a.id,
    title: a.title,
    instructions: a.instructions,
    dueDate: a.dueDate,
    subject: a.classSubject.subject.name,
    teacher: a.classSubject.teacher
      ? `${a.classSubject.teacher.user.firstName} ${a.classSubject.teacher.user.lastName}`
      : null,
    mySubmission: a.submissions[0] ?? null,
    overdue: !a.submissions[0] && a.dueDate < new Date(),
  }));
}

/** Parent submits on their child's behalf; the body goes to the document store. */
export async function submitForChild(input: SubmitAssignmentInput, parentUserId: string) {
  await assertParentOfStudent(parentUserId, input.studentId);
  const assignment = await prisma.assignment.findUnique({
    where: { id: input.assignmentId },
    include: { classSubject: { select: { classRoomId: true } } },
  });
  if (!assignment) throw ApiError.notFound("Assignment");
  const enrolled = await prisma.enrollment.findFirst({
    where: { studentId: input.studentId, classRoomId: assignment.classSubject.classRoomId },
  });
  if (!enrolled) throw ApiError.badRequest("This assignment is not for your child's class");

  const existing = await prisma.assignmentSubmission.findUnique({
    where: { assignmentId_studentId: { assignmentId: input.assignmentId, studentId: input.studentId } },
  });
  if (existing?.feedback) {
    throw ApiError.badRequest("The teacher has already reviewed this submission — it can no longer be changed");
  }

  const contentRef = await documentStore.put(SUBMISSIONS, {
    assignmentId: input.assignmentId,
    studentId: input.studentId,
    content: input.content,
    submittedBy: parentUserId,
    submittedAt: new Date().toISOString(),
  });

  return prisma.assignmentSubmission.upsert({
    where: { assignmentId_studentId: { assignmentId: input.assignmentId, studentId: input.studentId } },
    create: {
      assignmentId: input.assignmentId,
      studentId: input.studentId,
      submittedById: parentUserId,
      contentRef,
      linkUrl: input.linkUrl || null,
    },
    update: { contentRef, linkUrl: input.linkUrl || null, submittedAt: new Date() },
  });
}
