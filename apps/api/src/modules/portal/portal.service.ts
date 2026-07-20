import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { getGradeScale, gradeFor } from "../../lib/grading";
import * as attendance from "../attendance/attendance.service";
import * as finance from "../finance/finance.service";

/**
 * Parent Portal — everything is scoped to the children linked to the
 * signed-in guardian account. Every child-specific call goes through
 * `assertOwnChild` so a parent can never read another family's data.
 */

async function guardianFor(userId: string) {
  const guardian = await prisma.guardian.findUnique({ where: { userId } });
  if (!guardian) throw ApiError.forbidden("This account is not linked to any student");
  return guardian;
}

async function assertOwnChild(userId: string, studentId: string) {
  const guardian = await guardianFor(userId);
  const link = await prisma.studentGuardian.findUnique({
    where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
  });
  if (!link) throw ApiError.forbidden("You do not have access to this student's records");
}

/**
 * Billing shown to parents follows the admin's active academic year: after
 * a rollover the portal shows THIS year's invoices and balance, not old
 * ones. Returns undefined (no filter) only while no year is active.
 */
async function activeYearIssueRange() {
  const year = await prisma.academicYear.findFirst({ where: { isActive: true } });
  return year ? { gte: year.startDate, lte: year.endDate } : undefined;
}

/** Multi-child support: dashboard cards for every linked child. */
export async function myChildren(userId: string) {
  const guardian = await guardianFor(userId);
  const issued = await activeYearIssueRange();
  const links = await prisma.studentGuardian.findMany({
    where: { guardianId: guardian.id },
    include: {
      student: {
        include: {
          enrollments: {
            where: { academicYear: { isActive: true } },
            include: {
              classRoom: {
                include: { homeroomTeacher: { include: { user: { select: { firstName: true, lastName: true } } } } },
              },
            },
          },
          invoices: {
            where: { status: { notIn: ["VOID", "DRAFT"] }, ...(issued ? { issueDate: issued } : {}) },
            include: { items: true, payments: true },
          },
        },
      },
    },
  });

  return Promise.all(
    links.map(async ({ student, relation }) => {
      const summary = await attendance.studentSummary(student.id);
      const invoiced = student.invoices.reduce((s, i) => s + i.items.reduce((a, it) => a + it.amount, 0), 0);
      const paid = student.invoices
        .flatMap((i) => i.payments)
        .filter((p) => p.status === "SUCCEEDED")
        .reduce((s, p) => s + p.amount, 0);
      const enrollment = student.enrollments[0];
      return {
        id: student.id,
        admissionNo: student.admissionNo,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
        photoUrl: student.photoUrl,
        relation,
        className: enrollment?.classRoom.name ?? null,
        homeroomTeacher: enrollment?.classRoom.homeroomTeacher
          ? `${enrollment.classRoom.homeroomTeacher.user.firstName} ${enrollment.classRoom.homeroomTeacher.user.lastName}`
          : null,
        attendanceRate: summary.rate,
        outstandingBalance: invoiced - paid,
      };
    }),
  );
}

/** One child's detail: profile, schedule, grades, attendance, invoices. */
export async function childOverview(userId: string, studentId: string) {
  await assertOwnChild(userId, studentId);
  const issued = await activeYearIssueRange();

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      enrollments: {
        where: { academicYear: { isActive: true } },
        include: {
          classRoom: {
            include: {
              timetableSlots: { include: { subject: true } },
              homeroomTeacher: { include: { user: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      },
      examResults: {
        include: { exam: { include: { term: true } }, subject: true },
        orderBy: { id: "desc" },
        take: 30,
      },
      invoices: {
        where: { status: { not: "DRAFT" }, ...(issued ? { issueDate: issued } : {}) },
        include: { items: true, payments: true },
        orderBy: { issueDate: "desc" },
      },
      attendance: { orderBy: { date: "desc" }, take: 20 },
    },
  });
  if (!student) throw ApiError.notFound("Student");

  const [summary, scale] = await Promise.all([attendance.studentSummary(studentId), getGradeScale()]);

  // Per-subject academic performance: every exam entry grouped by subject,
  // with the weighted average and the letter grade from the school's scale —
  // parents see exactly how their child is doing in each subject.
  const bySubject = new Map<string, {
    subject: { id: string; code: string; name: string };
    weighted: number;
    totalWeight: number;
    exams: Array<{ exam: string; term: string; marks: number; maxMarks: number; grade: string; remark: string | null }>;
  }>();
  for (const r of student.examResults) {
    const entry = bySubject.get(r.subjectId) ?? {
      subject: { id: r.subject.id, code: r.subject.code, name: r.subject.name },
      weighted: 0,
      totalWeight: 0,
      exams: [],
    };
    entry.weighted += (r.marks / r.maxMarks) * 100 * r.exam.weight;
    entry.totalWeight += r.exam.weight;
    entry.exams.push({
      exam: r.exam.name, term: r.exam.term.name,
      marks: r.marks, maxMarks: r.maxMarks, grade: r.grade, remark: r.remark,
    });
    bySubject.set(r.subjectId, entry);
  }
  const resultsBySubject = [...bySubject.values()].map((s) => {
    const pct = s.totalWeight === 0 ? 0 : s.weighted / s.totalWeight;
    const band = gradeFor(pct, scale);
    return {
      subject: s.subject,
      average: Math.round(pct * 10) / 10,
      grade: band.letter,
      points: band.points,
      exams: s.exams,
    };
  }).sort((a, b) => a.subject.name.localeCompare(b.subject.name));

  const invoices = student.invoices.map((inv) => {
    const total = inv.items.reduce((s, i) => s + i.amount, 0);
    const paid = inv.payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amount, 0);
    return {
      id: inv.id, number: inv.number, status: inv.status, dueDate: inv.dueDate,
      currency: inv.currency, total, paid, balance: total - paid,
      items: inv.items.map((i) => ({ description: i.description, amount: i.amount })),
    };
  });

  return {
    student: {
      id: student.id, admissionNo: student.admissionNo,
      firstName: student.firstName, lastName: student.lastName,
      gradeLevel: student.gradeLevel, photoUrl: student.photoUrl,
      bloodGroup: student.bloodGroup, medicalNotes: student.medicalNotes,
    },
    classRoom: student.enrollments[0]?.classRoom ?? null,
    attendance: { ...summary, recent: student.attendance },
    resultsBySubject,
    invoices,
  };
}

/** Parent-initiated online payment — only for invoices of their own child. */
export async function payInvoice(userId: string, invoiceId: string, urls: { successUrl?: string; cancelUrl?: string }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw ApiError.notFound("Invoice");
  await assertOwnChild(userId, invoice.studentId);
  return finance.createCheckout(invoiceId, urls);
}
