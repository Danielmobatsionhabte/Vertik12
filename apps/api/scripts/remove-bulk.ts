/**
 * Removes everything created by scripts/seed-bulk.ts — and ONLY that.
 * All bulk rows carry markers (VRT-BULK-* numbers, bulk.* emails, "(Bulk)"
 * class names, "Bulk *" titles, "(bulk-seeded)" payroll notes), so real
 * records are never matched. Deletion runs in dependency order because
 * several relations (invoices→students, payslips→staff, messages→users)
 * do not cascade.
 *
 *   DATABASE_URL="file:./dev.db" npx tsx scripts/remove-bulk.ts
 */
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL explicitly, e.g. DATABASE_URL="file:./dev.db" npx tsx scripts/remove-bulk.ts');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const bulkUsers = await prisma.user.findMany({
    where: { email: { startsWith: "bulk." } },
    select: { id: true },
  });
  const bulkUserIds = bulkUsers.map((u) => u.id);
  console.log(`Removing bulk data (${bulkUserIds.length} bulk accounts) from ${process.env.DATABASE_URL} …`);

  // 1. Communication involving bulk accounts (no cascade from User).
  const messages = await prisma.message.deleteMany({
    where: { OR: [{ senderId: { in: bulkUserIds } }, { recipientId: { in: bulkUserIds } }] },
  });
  const announcements = await prisma.announcement.deleteMany({ where: { authorId: { in: bulkUserIds } } });

  // 2. Finance: payments → invoices of bulk students (invoice→student has no cascade).
  const bulkStudentFilter = { student: { is: { admissionNo: { startsWith: "VRT-BULK-" } } } };
  const payments = await prisma.payment.deleteMany({ where: { invoice: { is: bulkStudentFilter } } });
  const invoices = await prisma.invoice.deleteMany({ where: bulkStudentFilter }); // items cascade

  // 3. Bulk exams (results cascade) and assignments in bulk classes (submissions cascade).
  const exams = await prisma.exam.deleteMany({ where: { name: { startsWith: "Bulk " } } });
  const assignments = await prisma.assignment.deleteMany({
    where: { classSubject: { is: { classRoom: { is: { name: { contains: "(Bulk)" } } } } } },
  });

  // 4. Students (cascades enrollments, attendance, remaining results, submissions, guardian links).
  const students = await prisma.student.deleteMany({ where: { admissionNo: { startsWith: "VRT-BULK-" } } });
  const guardians = await prisma.guardian.deleteMany({ where: { email: { startsWith: "bulk.parent" } } });

  // 5. Payroll: bulk staff's payslips in ANY run, then whole bulk-seeded runs.
  await prisma.payslip.deleteMany({ where: { staff: { is: { staffNo: { startsWith: "VRT-BULK-EMP-" } } } } });
  const runs = await prisma.payrollRun.deleteMany({ where: { notes: "(bulk-seeded)" } }); // payslips cascade

  // 6. Academics: bulk classes (classSubjects/timetable cascade), then bulk subjects.
  const classes = await prisma.classRoom.deleteMany({ where: { name: { contains: "(Bulk)" } } });
  const subjects = await prisma.subject.deleteMany({ where: { code: { startsWith: "BLK" } } });

  // 7. Staff (salary structures cascade), visit rows, then the user accounts.
  const staff = await prisma.staff.deleteMany({ where: { staffNo: { startsWith: "VRT-BULK-EMP-" } } });
  await prisma.dailyVisit.deleteMany({ where: { userId: { in: bulkUserIds } } });
  const users = await prisma.user.deleteMany({ where: { id: { in: bulkUserIds } } });

  console.log({
    messages: messages.count,
    announcements: announcements.count,
    payments: payments.count,
    invoices: invoices.count,
    exams: exams.count,
    assignments: assignments.count,
    students: students.count,
    guardians: guardians.count,
    payrollRuns: runs.count,
    classes: classes.count,
    subjects: subjects.count,
    staff: staff.count,
    users: users.count,
  });
  console.log("Done. (Orphaned bulk submission files may remain in .docstore — harmless.)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
