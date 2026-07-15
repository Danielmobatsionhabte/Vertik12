/**
 * Bulk data generator — load-tests the app with a realistically large school.
 *
 * Usage (ALWAYS point DATABASE_URL at a throwaway/test database):
 *
 *   DATABASE_URL="file:/path/to/bulk.db" npx prisma db push
 *   DATABASE_URL="file:/path/to/bulk.db" npx tsx prisma/seed.ts        # base fixtures
 *   DATABASE_URL="file:/path/to/bulk.db" npx tsx scripts/seed-bulk.ts  # + bulk data
 *
 * Sizes are tunable: BULK_STUDENTS=5000 BULK_ATTENDANCE_DAYS=90 …
 * The script APPENDS to the active academic year created by the base seed.
 * It refuses to run when DATABASE_URL is not explicitly set, so it can
 * never silently target the dev database from .env.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error(
    "Refusing to run: set DATABASE_URL explicitly to a test database, e.g.\n" +
    '  DATABASE_URL="file:./bulk.db" npx tsx scripts/seed-bulk.ts',
  );
  process.exit(1);
}

const prisma = new PrismaClient();

const N_STUDENTS = Number(process.env.BULK_STUDENTS ?? 3000);
const N_TEACHERS = Number(process.env.BULK_TEACHERS ?? 80);
const ATTENDANCE_DAYS = Number(process.env.BULK_ATTENDANCE_DAYS ?? 60);
const N_MESSAGES = Number(process.env.BULK_MESSAGES ?? 5000);
const N_ANNOUNCEMENTS = Number(process.env.BULK_ANNOUNCEMENTS ?? 300);
const SECTIONS_PER_GRADE = Number(process.env.BULK_SECTIONS ?? 4);

const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const FIRST = ["Liam", "Olivia", "Noah", "Emma", "Kai", "Sofia", "Mateo", "Amara", "Yuki", "Zara", "Omar", "Lena", "Ravi", "Nia", "Hugo", "Mei", "Tariq", "Ines", "Dmitri", "Aisha", "Felix", "Rosa", "Jonas", "Priya", "Samuel", "Hana", "Diego", "Fatou", "Ethan", "Chloe"];
const LAST = ["Kim", "Garcia", "Okafor", "Smith", "Tanaka", "Muller", "Rossi", "Hassan", "Ivanov", "Nguyen", "Diallo", "Costa", "Novak", "Ali", "Berg", "Sato", "Lopez", "Mensah", "Weber", "Chen", "Silva", "Haile", "Osei", "Khan", "Dubois", "Traore", "Yamada", "Petrov", "Abebe", "Moreau"];

const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]!;
const rand = (n: number) => Math.floor(Math.random() * n);
const uid = () => crypto.randomUUID();

/** createMany in chunks so SQLite's bind-variable limit is never hit. */
async function chunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

async function main() {
  const started = Date.now();
  const year = await prisma.academicYear.findFirst({ where: { isActive: true }, include: { terms: true } });
  if (!year) {
    console.error("No active academic year — run the base seed first (npx tsx prisma/seed.ts).");
    process.exit(1);
  }
  const term = year.terms[0];
  if (!term) {
    console.error("The active year has no terms — run the base seed first.");
    process.exit(1);
  }

  // Never double-insert: the first bulk teacher account is the marker.
  const marker = await prisma.user.findUnique({ where: { email: "bulk.teacher1@vertik12.school" } });
  if (marker) {
    console.error("Bulk data is already present in this database. Run scripts/remove-bulk.ts first to re-seed.");
    process.exit(1);
  }

  console.log(`Bulk-seeding ${N_STUDENTS} students into "${year.name}" @ ${process.env.DATABASE_URL}`);
  console.log("(existing rows are never modified — the bulk data only appends)");
  const passwordHash = await bcrypt.hash("Vertik12!demo", 10);

  // ---- teachers -------------------------------------------------------
  console.time("teachers");
  const teacherUsers = Array.from({ length: N_TEACHERS }, (_, i) => ({
    id: uid(),
    email: `bulk.teacher${i + 1}@vertik12.school`,
    passwordHash,
    firstName: pick(FIRST, i),
    lastName: pick(LAST, i * 7 + 3),
    role: "TEACHER",
  }));
  await chunked(teacherUsers, (c) => prisma.user.createMany({ data: c }));
  const teacherStaff = teacherUsers.map((u, i) => ({
    id: uid(),
    staffNo: `VRT-BULK-EMP-${String(i + 1).padStart(4, "0")}`,
    userId: u.id,
    staffType: "TEACHING",
    designation: "Teacher",
    joinDate: new Date(2024, 7, 15),
  }));
  await chunked(teacherStaff, (c) => prisma.staff.createMany({ data: c }));
  // Non-teaching staff too (librarian, nurse, drivers, admin office…).
  const NON_TEACHING = ["Librarian", "School Nurse", "Bus Driver", "Secretary", "IT Support", "Cleaner", "Security Officer", "Cook", "Lab Assistant", "Counselor", "Store Keeper", "Electrician", "Gardener", "Receptionist", "Archivist"];
  const supportUsers = NON_TEACHING.map((designation, i) => ({
    id: uid(),
    email: `bulk.staff${i + 1}@vertik12.school`,
    passwordHash,
    firstName: pick(FIRST, i * 11 + 5),
    lastName: pick(LAST, i * 3 + 9),
    role: "TEACHER", // least-privileged staff role; they rarely sign in
  }));
  await chunked(supportUsers, (c) => prisma.user.createMany({ data: c }));
  const supportStaff = supportUsers.map((u, i) => ({
    id: uid(),
    staffNo: `VRT-BULK-EMP-${String(N_TEACHERS + i + 1).padStart(4, "0")}`,
    userId: u.id,
    staffType: "NON_TEACHING",
    designation: NON_TEACHING[i]!,
    joinDate: new Date(2023, 2, 1),
  }));
  await chunked(supportStaff, (c) => prisma.staff.createMany({ data: c }));
  const allBulkStaff = [...teacherStaff, ...supportStaff];
  await chunked(
    allBulkStaff.map((s) => ({
      staffId: s.id,
      basicSalary: 250_000 + rand(150_000),
      allowances: JSON.stringify([{ name: "Transport", amount: 20_000 }]),
      deductions: JSON.stringify([{ name: "Income Tax", amount: 30_000 }]),
    })),
    (c) => prisma.salaryStructure.createMany({ data: c }),
  );
  console.timeEnd("teachers");

  // ---- subjects + classes + class-subjects ----------------------------
  console.time("classes");
  const subjects = Array.from({ length: 6 }, (_, i) => ({
    id: uid(),
    code: `BLK${i + 1}`,
    name: ["Mathematics II", "English II", "Science II", "History II", "Art II", "PE II"][i]!,
  }));
  await prisma.subject.createMany({ data: subjects });

  const classes = GRADES.flatMap((grade, gi) =>
    Array.from({ length: SECTIONS_PER_GRADE }, (_, s) => ({
      id: uid(),
      name: `${grade === "K" ? "KG" : `Grade ${grade}`} — S${s + 1} (Bulk)`,
      gradeLevel: grade,
      section: `S${s + 1}`,
      capacity: Math.ceil(N_STUDENTS / GRADES.length / SECTIONS_PER_GRADE) + 20,
      academicYearId: year.id,
      homeroomTeacherId: teacherStaff[(gi * SECTIONS_PER_GRADE + s) % teacherStaff.length]!.id,
    })),
  );
  await chunked(classes, (c) => prisma.classRoom.createMany({ data: c }));

  const classSubjects = classes.flatMap((cls, ci) =>
    subjects.map((sub, si) => ({
      id: uid(),
      classRoomId: cls.id,
      subjectId: sub.id,
      teacherId: teacherStaff[(ci * subjects.length + si) % teacherStaff.length]!.id,
    })),
  );
  await chunked(classSubjects, (c) => prisma.classSubject.createMany({ data: c }));
  console.timeEnd("classes");

  // ---- students + guardians + enrollments -----------------------------
  console.time("students");
  const students = Array.from({ length: N_STUDENTS }, (_, i) => ({
    id: uid(),
    admissionNo: `VRT-BULK-${String(i + 1).padStart(5, "0")}`,
    firstName: pick(FIRST, i * 3 + 1),
    lastName: pick(LAST, i),
    dateOfBirth: new Date(2010 + rand(12), rand(12), 1 + rand(28)),
    gender: i % 2 === 0 ? "FEMALE" : "MALE",
    gradeLevel: pick(GRADES, i),
  }));
  await chunked(students, (c) => prisma.student.createMany({ data: c }));

  const guardians = students.map((s, i) => ({
    id: uid(),
    firstName: pick(FIRST, i * 5 + 2),
    lastName: s.lastName,
    phone: `+1-555-${String(1000 + (i % 9000)).padStart(4, "0")}`,
    email: `bulk.parent${i + 1}@example.com`,
  }));
  await chunked(guardians, (c) => prisma.guardian.createMany({ data: c }));
  await chunked(
    students.map((s, i) => ({ studentId: s.id, guardianId: guardians[i]!.id, relation: i % 2 ? "Father" : "Mother", isPrimary: true })),
    (c) => prisma.studentGuardian.createMany({ data: c }),
  );

  // A slice of guardians get portal logins (bulk.parentuser1@… / demo pwd).
  const portalParents = guardians.slice(0, 300).map((g, i) => ({
    id: uid(),
    email: `bulk.parentuser${i + 1}@vertik12.school`,
    passwordHash,
    firstName: g.firstName,
    lastName: g.lastName,
    role: "PARENT",
  }));
  await chunked(portalParents, (c) => prisma.user.createMany({ data: c }));
  for (let i = 0; i < portalParents.length; i++) {
    await prisma.guardian.update({ where: { id: guardians[i]!.id }, data: { userId: portalParents[i]!.id } });
  }

  const classByGrade = new Map<string, typeof classes>();
  for (const c of classes) {
    classByGrade.set(c.gradeLevel, [...(classByGrade.get(c.gradeLevel) ?? []), c]);
  }
  const gradeCounters = new Map<string, number>();
  const enrollments = students.map((s) => {
    const options = classByGrade.get(s.gradeLevel)!;
    const n = gradeCounters.get(s.gradeLevel) ?? 0;
    gradeCounters.set(s.gradeLevel, n + 1);
    return { studentId: s.id, classRoomId: options[n % options.length]!.id, academicYearId: year.id };
  });
  await chunked(enrollments, (c) => prisma.enrollment.createMany({ data: c }));
  const classOf = new Map(enrollments.map((e) => [e.studentId, e.classRoomId]));
  console.timeEnd("students");

  // ---- attendance (weekdays, most recent N school days) ----------------
  console.time("attendance");
  const days: Date[] = [];
  for (let d = 0; days.length < ATTENDANCE_DAYS; d++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - d);
    date.setUTCHours(0, 0, 0, 0);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) days.push(new Date(date));
  }
  const attendanceRows = students.flatMap((s) =>
    days.map((date) => {
      const r = Math.random();
      const status = r < 0.92 ? "PRESENT" : r < 0.96 ? "LATE" : r < 0.99 ? "ABSENT" : "EXCUSED";
      return { studentId: s.id, classRoomId: classOf.get(s.id)!, date, status };
    }),
  );
  await chunked(attendanceRows, (c) => prisma.attendanceRecord.createMany({ data: c }), 2000);
  console.timeEnd("attendance");
  console.log(`  ${attendanceRows.length.toLocaleString()} attendance records`);

  // ---- exams + results -------------------------------------------------
  console.time("results");
  const exams = await Promise.all(
    ["Bulk Weekly Test", "Bulk Term Exam", "Bulk Final Exam"].map((name, i) =>
      prisma.exam.create({ data: { name, category: "OTHER", termId: term.id, weight: [20, 30, 50][i]! } }),
    ),
  );
  const resultRows = students.flatMap((s) =>
    exams.flatMap((exam) =>
      subjects.slice(0, 3).map((sub) => {
        const marks = 40 + rand(60);
        const letter = marks >= 90 ? "A" : marks >= 80 ? "B" : marks >= 70 ? "C" : marks >= 60 ? "D" : "F";
        return { examId: exam.id, studentId: s.id, subjectId: sub.id, marks, maxMarks: 100, grade: letter };
      }),
    ),
  );
  await chunked(resultRows, (c) => prisma.examResult.createMany({ data: c }), 2000);
  console.timeEnd("results");
  console.log(`  ${resultRows.length.toLocaleString()} exam results`);

  // ---- invoices + items + payments ------------------------------------
  console.time("finance");
  const months = [8, 9, 10]; // Sep, Oct, Nov
  const invoices: Array<{ id: string; number: string; studentId: string; dueDate: Date; status: string; issueDate: Date }> = [];
  const items: Array<{ invoiceId: string; description: string; amount: number }> = [];
  const payments: Array<{ invoiceId: string; amount: number; method: string; status: string; provider: string; paidAt: Date }> = [];
  let inv = 0;
  for (const s of students) {
    for (const m of months) {
      const id = uid();
      const amount = 85_000;
      const roll = Math.random();
      const status = roll < 0.65 ? "PAID" : roll < 0.8 ? "PARTIALLY_PAID" : "OVERDUE";
      invoices.push({
        id,
        number: `INV-BULK-${String(++inv).padStart(6, "0")}`,
        studentId: s.id,
        issueDate: new Date(Date.UTC(2026, m, 1)),
        dueDate: new Date(Date.UTC(2026, m, 20)),
        status,
      });
      items.push({ invoiceId: id, description: `Tuition Fee — month ${m + 1}`, amount });
      if (status === "PAID") {
        payments.push({ invoiceId: id, amount, method: Math.random() < 0.4 ? "CARD" : "CASH", status: "SUCCEEDED", provider: "MANUAL", paidAt: new Date(Date.UTC(2026, m, 5 + rand(14))) });
      } else if (status === "PARTIALLY_PAID") {
        payments.push({ invoiceId: id, amount: Math.floor(amount / 2), method: "CASH", status: "SUCCEEDED", provider: "MANUAL", paidAt: new Date(Date.UTC(2026, m, 5 + rand(14))) });
      }
    }
  }
  await chunked(invoices, (c) => prisma.invoice.createMany({ data: c }), 2000);
  await chunked(items, (c) => prisma.invoiceItem.createMany({ data: c }), 2000);
  await chunked(payments, (c) => prisma.payment.createMany({ data: c }), 2000);
  console.timeEnd("finance");
  console.log(`  ${invoices.length.toLocaleString()} invoices, ${payments.length.toLocaleString()} payments`);

  // ---- payroll history: PAID runs for months that have none -------------
  console.time("payroll");
  const existingRuns = await prisma.payrollRun.findMany({ select: { month: true, year: true } });
  const structures = await prisma.salaryStructure.findMany();
  let runsCreated = 0;
  for (let month = 1; month <= 6; month++) {
    if (existingRuns.some((r) => r.month === month && r.year === 2026)) continue;
    const paidAt = new Date(Date.UTC(2026, month - 1, 28));
    await prisma.payrollRun.create({
      data: {
        month,
        year: 2026,
        status: "PAID",
        notes: "(bulk-seeded)",
        approvedAt: paidAt,
        paidAt,
        payslips: {
          create: structures.map((s) => {
            const allowances = JSON.parse(s.allowances) as Array<{ amount: number }>;
            const deductions = JSON.parse(s.deductions) as Array<{ amount: number }>;
            const gross = s.basicSalary + allowances.reduce((a, c) => a + c.amount, 0);
            const totalDeductions = deductions.reduce((a, c) => a + c.amount, 0);
            return {
              staffId: s.staffId,
              basicSalary: s.basicSalary,
              allowances: s.allowances,
              deductions: s.deductions,
              gross,
              totalDeductions,
              net: gross - totalDeductions,
              currency: s.currency,
              status: "PAID",
              paidAt,
            };
          }),
        },
      },
    });
    runsCreated++;
  }
  console.timeEnd("payroll");
  console.log(`  ${runsCreated} payroll runs × ${structures.length} payslips`);

  // ---- assignments + submissions ----------------------------------------
  console.time("assignments");
  const dueBase = Date.now();
  const assignmentRows = classSubjects.slice(0, 100).flatMap((cs, ci) =>
    Array.from({ length: 3 }, (_, k) => ({
      id: uid(),
      classSubjectId: cs.id,
      title: `Bulk homework ${ci + 1}.${k + 1}`,
      instructions: "Complete the exercises on the attached worksheet and hand in before the due date.",
      dueDate: new Date(dueBase + (k - 1) * 7 * 86_400_000),
      createdById: teacherUsers[ci % teacherUsers.length]!.id,
    })),
  );
  await chunked(assignmentRows, (c) => prisma.assignment.createMany({ data: c }));

  // Submissions for the first assignment of the first 20 classes (~15 each).
  const { documentStore } = await import("../src/lib/document-store");
  const enrollmentsByClass = new Map<string, string[]>();
  for (const e of enrollments) {
    enrollmentsByClass.set(e.classRoomId, [...(enrollmentsByClass.get(e.classRoomId) ?? []), e.studentId]);
  }
  const submissionRows: Array<{ assignmentId: string; studentId: string; submittedById: string; contentRef: string }> = [];
  for (let ci = 0; ci < 20; ci++) {
    const cs = classSubjects[ci * subjects.length]!; // first subject of each class
    const assignment = assignmentRows.find((a) => a.classSubjectId === cs.id);
    const studentIds = (enrollmentsByClass.get(cs.classRoomId) ?? []).slice(0, 15);
    if (!assignment) continue;
    for (const studentId of studentIds) {
      const contentRef = await documentStore.put("assignment-submissions", {
        assignmentId: assignment.id,
        studentId,
        content: "Bulk-seeded practice submission.",
        submittedAt: new Date().toISOString(),
      });
      submissionRows.push({ assignmentId: assignment.id, studentId, submittedById: portalParents[0]!.id, contentRef });
    }
  }
  await chunked(submissionRows, (c) => prisma.assignmentSubmission.createMany({ data: c }));
  console.timeEnd("assignments");
  console.log(`  ${assignmentRows.length} assignments, ${submissionRows.length} submissions`);

  // ---- messages + announcements ----------------------------------------
  console.time("comms");
  const staffUsers = teacherUsers.map((t) => t.id);
  const messageRows = Array.from({ length: N_MESSAGES }, (_, i) => ({
    senderId: pick(staffUsers, i),
    recipientId: pick(staffUsers, i * 13 + 7),
    subject: `Bulk message ${i + 1}`,
    body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(1 + (i % 5)),
    readAt: i % 3 === 0 ? null : new Date(),
  })).filter((m) => m.senderId !== m.recipientId);
  await chunked(messageRows, (c) => prisma.message.createMany({ data: c }));

  const audiences = ["ALL", "STAFF", "STUDENTS", "PARENTS"];
  await chunked(
    Array.from({ length: N_ANNOUNCEMENTS }, (_, i) => ({
      title: `Bulk announcement ${i + 1}`,
      body: "School notice body text. ".repeat(3 + (i % 10)),
      audience: pick(audiences, i),
      authorId: teacherUsers[0]!.id,
      createdAt: new Date(Date.now() - rand(90) * 86_400_000),
    })),
    (c) => prisma.announcement.createMany({ data: c }),
  );
  console.timeEnd("comms");

  const counts = {
    users: await prisma.user.count(),
    students: await prisma.student.count(),
    staff: await prisma.staff.count(),
    classes: await prisma.classRoom.count(),
    attendance: await prisma.attendanceRecord.count(),
    examResults: await prisma.examResult.count(),
    invoices: await prisma.invoice.count(),
    payments: await prisma.payment.count(),
    payslips: await prisma.payslip.count(),
    assignments: await prisma.assignment.count(),
    messages: await prisma.message.count(),
    announcements: await prisma.announcement.count(),
  };
  console.log("Totals now in DB:", counts);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
