/**
 * Wipe ALL school data so the system can be tested from a clean slate.
 *
 *   npm run db:wipe            (from the repo root or apps/api)
 *
 * Keeps:
 *  - Super Admin login(s) — email and password stay exactly as they are
 *  - School settings, the grading scale and the exam-type catalogue
 *    (configuration, not data — grading/report cards need them)
 *
 * Deletes everything else: students, guardians and their portal logins,
 * staff and their logins, classes, academic years/terms, subjects,
 * attendance, exams & results, assignments, invoices & payments, payroll,
 * announcements, messages, audit logs and every open session.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma";

async function main() {
  const keep = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { id: true, email: true },
  });
  if (keep.length === 0) {
    throw new Error("Refusing to wipe: no SUPER_ADMIN account exists — you would be locked out.");
  }

  // Children before parents (FK-safe order).
  const steps: Array<[string, () => Promise<{ count: number }>]> = [
    ["sessions (everyone signs in again)", () => prisma.refreshToken.deleteMany()],
    ["audit logs", () => prisma.auditLog.deleteMany()],
    ["messages", () => prisma.message.deleteMany()],
    ["announcements", () => prisma.announcement.deleteMany()],
    ["assignment submissions", () => prisma.assignmentSubmission.deleteMany()],
    ["assignments", () => prisma.assignment.deleteMany()],
    ["result submissions", () => prisma.resultSubmission.deleteMany()],
    ["exam results", () => prisma.examResult.deleteMany()],
    ["exams", () => prisma.exam.deleteMany()],
    ["report-card approvals", () => prisma.reportCardApproval.deleteMany()],
    ["attendance records", () => prisma.attendanceRecord.deleteMany()],
    ["timetable slots", () => prisma.timetableSlot.deleteMany()],
    ["class-subject assignments", () => prisma.classSubject.deleteMany()],
    ["subjects", () => prisma.subject.deleteMany()],
    ["payments", () => prisma.payment.deleteMany()],
    ["invoice items", () => prisma.invoiceItem.deleteMany()],
    ["invoices", () => prisma.invoice.deleteMany()],
    ["fee structures", () => prisma.feeStructure.deleteMany()],
    ["payslips", () => prisma.payslip.deleteMany()],
    ["payroll runs", () => prisma.payrollRun.deleteMany()],
    ["salary structures", () => prisma.salaryStructure.deleteMany()],
    ["enrollments", () => prisma.enrollment.deleteMany()],
    ["student-guardian links", () => prisma.studentGuardian.deleteMany()],
    ["guardians", () => prisma.guardian.deleteMany()],
    ["students", () => prisma.student.deleteMany()],
    ["class rooms", () => prisma.classRoom.deleteMany()],
    ["terms", () => prisma.term.deleteMany()],
    ["academic years", () => prisma.academicYear.deleteMany()],
    ["staff profiles", () => prisma.staff.deleteMany()],
    ["user accounts (except Super Admin)", () => prisma.user.deleteMany({ where: { role: { not: "SUPER_ADMIN" } } })],
  ];

  console.log("Wiping all school data…\n");
  for (const [label, run] of steps) {
    const { count } = await run();
    if (count > 0) console.log(`  ✔ removed ${count} ${label}`);
  }

  // Local document store (assignment submission bodies) — now orphaned.
  const docstore = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.docstore");
  await rm(docstore, { recursive: true, force: true });

  console.log("\nDone. Kept:");
  for (const u of keep) console.log(`  • Super Admin login: ${u.email} (password unchanged)`);
  console.log("  • School settings, grading scale and exam types (configuration)");
  console.log("\nSign in as the Super Admin and build the school up from scratch.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
