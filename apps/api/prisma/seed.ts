/**
 * Demo seed: a small but complete school so every screen has data.
 *
 *   npm run db:seed
 *
 * Logins (password for all: Vertik12!demo)
 *   admin@vertik12.school       SUPER_ADMIN
 *   registrar@vertik12.school   REGISTRAR
 *   accounts@vertik12.school    ACCOUNTANT
 *   teacher1@vertik12.school…   TEACHER
 *   parent1@vertik12.school…    PARENT   (parent1 has two children)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PASSWORD = "Vertik12!demo";

const FIRST = ["Amara", "Liam", "Sofia", "Noah", "Yuki", "Omar", "Elena", "Kwame", "Priya", "Lucas", "Mei", "Daniel", "Zara", "Mateo", "Aisha", "Ethan", "Nia", "Hassan", "Ingrid", "Ravi"];
const LAST = ["Bekele", "Chen", "Garcia", "Johnson", "Kim", "Mensah", "Novak", "Okafor", "Patel", "Rossi", "Sato", "Schmidt", "Silva", "Tesfaye", "Yilmaz"];
const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]!;

async function main() {
  console.log("Seeding Vertik12 demo data…");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ---- wipe (idempotent seed) ----
  const tables = [
    "payslip", "payrollRun", "salaryStructure", "payment", "invoiceItem", "invoice", "feeStructure",
    "assignmentSubmission", "assignment", "resultSubmission", "examType",
    "examResult", "exam", "attendanceRecord", "scheduleChangeRequest", "timetableSlot",
    "calendarEvent", "classSubject", "enrollment",
    "announcement", "studentGuardian", "guardian", "student", "classRoom", "term", "subject",
    "academicYear", "staff", "refreshToken", "auditLog", "schoolSettings", "mailSettings",
    "message", "gradeBand", "reportCardApproval", "user",
  ] as const;
  for (const t of tables) {
    // @ts-expect-error dynamic model access
    await prisma[t].deleteMany();
  }

  // ---- users: admin + accountant ----
  const admin = await prisma.user.create({
    data: { email: "admin@vertik12.school", passwordHash, firstName: "Ada", lastName: "Okonkwo", role: "SUPER_ADMIN" },
  });
  const accountantUser = await prisma.user.create({
    data: { email: "accounts@vertik12.school", passwordHash, firstName: "Carlos", lastName: "Mendes", role: "ACCOUNTANT" },
  });

  // ---- staff ----
  const designations = ["Mathematics Teacher", "English Teacher", "Science Teacher", "History Teacher", "Arts & PE Teacher"];
  const teachers = [];
  for (let i = 0; i < 5; i++) {
    const user = await prisma.user.create({
      data: {
        email: `teacher${i + 1}@vertik12.school`, passwordHash,
        firstName: pick(FIRST, i + 3), lastName: pick(LAST, i + 5), role: "TEACHER",
      },
    });
    teachers.push(
      await prisma.staff.create({
        data: {
          staffNo: `VRT-EMP-${String(i + 1).padStart(4, "0")}`, userId: user.id,
          staffType: "TEACHING", designation: designations[i]!, department: "Academics",
          phone: `+1-555-01${i}0`, joinDate: new Date(2023, 7, 15), qualifications: "B.Ed",
        },
      }),
    );
  }
  const accountantStaff = await prisma.staff.create({
    data: {
      staffNo: "VRT-EMP-0006", userId: accountantUser.id, staffType: "NON_TEACHING",
      designation: "School Accountant", department: "Finance", joinDate: new Date(2022, 0, 10),
    },
  });

  // Registrar: student records, admissions, attendance reports, transcripts.
  const registrarUser = await prisma.user.create({
    data: { email: "registrar@vertik12.school", passwordHash, firstName: "Fatima", lastName: "Diallo", role: "REGISTRAR" },
  });
  const registrarStaff = await prisma.staff.create({
    data: {
      staffNo: "VRT-EMP-0007", userId: registrarUser.id, staffType: "NON_TEACHING",
      designation: "School Registrar", department: "Administration", joinDate: new Date(2021, 7, 1),
    },
  });

  // School settings singleton (Super Admin › School Configuration).
  // yearlyDiscountPercent: families paying the year at once get 10% off.
  await prisma.schoolSettings.create({
    data: {
      id: "school", schoolName: "Vertik12 International Academy",
      motto: "Learning without borders", address: "1 Education Way, Springfield, USA",
      phone: "+1-555-0100", email: "office@vertik12.school",
      currency: "USD", timezone: "America/New_York",
      yearlyDiscountPercent: 10,
    },
  });

  // Grading scale (Super Admin › Grading) — the registrar generates grades
  // from these bands; admins adjust them to their country's rules.
  const gradeBands = [
    { letter: "A+", minPercent: 97, points: 4.0 },
    { letter: "A", minPercent: 93, points: 4.0 },
    { letter: "A-", minPercent: 90, points: 3.7 },
    { letter: "B+", minPercent: 87, points: 3.3 },
    { letter: "B", minPercent: 83, points: 3.0 },
    { letter: "B-", minPercent: 80, points: 2.7 },
    { letter: "C+", minPercent: 77, points: 2.3 },
    { letter: "C", minPercent: 73, points: 2.0 },
    { letter: "C-", minPercent: 70, points: 1.7 },
    { letter: "D", minPercent: 60, points: 1.0 },
    { letter: "F", minPercent: 0, points: 0.0 },
  ];
  await prisma.gradeBand.createMany({ data: gradeBands.map((b, i) => ({ ...b, sortOrder: i })) });

  // ---- academic year, terms ----
  const year = await prisma.academicYear.create({
    data: { name: "2026-2027", startDate: new Date(2026, 8, 1), endDate: new Date(2027, 5, 30), isActive: true },
  });
  const term1 = await prisma.term.create({
    data: { name: "Term 1", academicYearId: year.id, startDate: new Date(2026, 8, 1), endDate: new Date(2026, 11, 18) },
  });
  await prisma.term.create({
    data: { name: "Term 2", academicYearId: year.id, startDate: new Date(2027, 0, 6), endDate: new Date(2027, 2, 26) },
  });
  await prisma.term.create({
    data: { name: "Term 3", academicYearId: year.id, startDate: new Date(2027, 3, 6), endDate: new Date(2027, 5, 30) },
  });

  // ---- subjects (created by SUPER_ADMIN; grade-scoped where relevant) ----
  const subjectDefs: Array<[string, string, string | null]> = [
    ["MATH", "Mathematics", null], ["ENG", "English Language", null], ["SCI", "Science", null],
    ["HIST", "History & Social Studies", null], ["ART", "Visual Arts", null], ["PE", "Physical Education", null],
    ["ICT", "Computing & ICT", null], ["MUS", "Music", null],
    ["CALC", "Calculus", "12"], // grade-specific examples
    ["PHON", "Phonics & Early Reading", "K"],
  ];
  const subjects = [];
  for (const [code, name, gradeLevel] of subjectDefs) {
    subjects.push(await prisma.subject.create({ data: { code, name, gradeLevel } }));
  }

  // ---- class rooms: one section per grade K-12 ----
  // Annotated because the timetable block below reads the array from inside
  // a closure, where TypeScript's evolving-any inference doesn't reach.
  const classRooms: Array<Awaited<ReturnType<typeof prisma.classRoom.create>>> = [];
  for (let i = 0; i < GRADES.length; i++) {
    const grade = GRADES[i]!;
    classRooms.push(
      await prisma.classRoom.create({
        data: {
          name: grade === "K" ? "Kindergarten — A" : `Grade ${grade} — A`,
          gradeLevel: grade, section: "A", capacity: 30,
          academicYearId: year.id, homeroomTeacherId: pick(teachers, i).id,
        },
      }),
    );
  }

  // assign core subjects to each class
  for (const room of classRooms) {
    for (const subj of subjects.slice(0, 4)) {
      await prisma.classSubject.create({
        data: { classRoomId: room.id, subjectId: subj.id, teacherId: pick(teachers, subjects.indexOf(subj)).id },
      });
    }
  }
  // teacher1 teaches TWO subjects: Mathematics (all classes, above) and
  // Visual Arts in Grade 10 — they can grade both, and only those.
  const grade10Room = classRooms[GRADES.indexOf("10")]!;
  await prisma.classSubject.create({
    data: { classRoomId: grade10Room.id, subjectId: subjects[4]!.id, teacherId: teachers[0]!.id },
  });
  // grade-scoped subjects attached to their grade's class
  await prisma.classSubject.create({
    data: { classRoomId: classRooms[GRADES.indexOf("12")]!.id, subjectId: subjects[8]!.id, teacherId: teachers[0]!.id },
  });
  await prisma.classSubject.create({
    data: { classRoomId: classRooms[GRADES.indexOf("K")]!.id, subjectId: subjects[9]!.id, teacherId: teachers[1]!.id },
  });

  // ---- students: 4 per grade (52 total), each with a guardian, enrolled ----
  const students = [];
  const guardians = [];
  let admission = 1;
  for (let g = 0; g < GRADES.length; g++) {
    const grade = GRADES[g]!;
    const room = classRooms[g]!;
    for (let s = 0; s < 4; s++) {
      const idx = g * 4 + s;
      const birthYear = 2021 - g; // K ≈ age 5
      const student = await prisma.student.create({
        data: {
          admissionNo: `VRT-2026-${String(admission++).padStart(4, "0")}`,
          firstName: pick(FIRST, idx), lastName: pick(LAST, idx),
          dateOfBirth: new Date(birthYear, (idx % 12), 10 + (idx % 15)),
          gender: idx % 2 === 0 ? "FEMALE" : "MALE",
          gradeLevel: grade, city: "Springfield", country: "USA", nationality: "American",
        },
      });
      const guardian = await prisma.guardian.create({
        data: {
          firstName: pick(FIRST, idx + 7), lastName: student.lastName,
          phone: `+1-555-2${String(idx).padStart(3, "0")}`, email: `parent${idx}@example.com`,
          occupation: "Engineer",
        },
      });
      await prisma.studentGuardian.create({
        data: { studentId: student.id, guardianId: guardian.id, relation: idx % 2 === 0 ? "Mother" : "Father", isPrimary: true },
      });
      await prisma.enrollment.create({
        data: { studentId: student.id, classRoomId: room.id, academicYearId: year.id, rollNo: s + 1 },
      });
      students.push(student);
      guardians.push(guardian);
    }
  }

  // ---- parent portal accounts: guardians of the first 3 students can log in ----
  for (let i = 0; i < 3; i++) {
    const guardian = guardians[i]!;
    const user = await prisma.user.create({
      data: {
        email: `parent${i + 1}@vertik12.school`, passwordHash,
        firstName: guardian.firstName, lastName: guardian.lastName, role: "PARENT",
      },
    });
    await prisma.guardian.update({ where: { id: guardian.id }, data: { userId: user.id } });
  }
  // Multi-child support: parent1 is also the guardian of a Grade 1 student.
  await prisma.studentGuardian.create({
    data: { studentId: students[4]!.id, guardianId: guardians[0]!.id, relation: "Mother", isPrimary: false },
  });

  // Three transfer students not yet assigned to a class — they appear in
  // Students › "Assign to academic year" for the registrar to place.
  for (let i = 0; i < 3; i++) {
    await prisma.student.create({
      data: {
        admissionNo: `VRT-2026-${String(admission++).padStart(4, "0")}`,
        firstName: pick(FIRST, i + 11), lastName: pick(LAST, i + 9),
        dateOfBirth: new Date(2015 - i, i + 2, 5),
        gender: i % 2 === 0 ? "FEMALE" : "MALE",
        gradeLevel: String(6 + i),
        city: "Springfield", country: "USA", nationality: "American",
      },
    });
  }

  // ---- attendance for today (all classes) ----
  // "Today" = the LOCAL calendar day pinned at midnight UTC (the app's
  // date-only convention). Using getUTC*() here put records on tomorrow's
  // date for anyone west of UTC seeding in the evening.
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  for (let i = 0; i < students.length; i++) {
    const student = students[i]!;
    const room = classRooms[GRADES.indexOf(student.gradeLevel)]!;
    await prisma.attendanceRecord.create({
      data: {
        studentId: student.id, classRoomId: room.id, date: today,
        status: i % 11 === 0 ? "ABSENT" : i % 7 === 0 ? "LATE" : "PRESENT",
        markedById: admin.id,
      },
    });
  }

  // ---- an exam with results for Grade 10 ----
  // Admin-managed exam types (Admin › Exams can add more, e.g. "Mid Term").
  const examTypeNames = ["ASSIGNMENT", "WEEKLY_TEST", "TERM_EXAM", "FINAL_EXAM", "OTHER"];
  await prisma.examType.createMany({ data: examTypeNames.map((name, i) => ({ name, sortOrder: i })) });

  const exam = await prisma.exam.create({
    data: { name: "Midterm Exam", category: "TERM_EXAM", termId: term1.id, weight: 40, startDate: new Date(2026, 9, 20), createdBy: admin.id },
  });
  await prisma.exam.create({
    data: { name: "Weekly Test 1", category: "WEEKLY_TEST", termId: term1.id, weight: 10, createdBy: admin.id },
  });
  await prisma.exam.create({
    data: { name: "Homework Portfolio", category: "ASSIGNMENT", termId: term1.id, weight: 15, createdBy: admin.id },
  });
  const grade10 = students.filter((s) => s.gradeLevel === "10");
  const math = subjects[0]!;
  for (let i = 0; i < grade10.length; i++) {
    const marks = 62 + i * 9;
    const pct = marks; // maxMarks 100
    const letter = pct >= 90 ? "A-" : pct >= 80 ? "B" : pct >= 70 ? "C" : "D";
    await prisma.examResult.create({
      data: { examId: exam.id, studentId: grade10[i]!.id, subjectId: math.id, marks, maxMarks: 100, grade: letter },
    });
  }

  // ---- finance: fee structures, invoices, some payments ----
  // Monthly tuition powers the registrar's monthly/yearly collection flow.
  await prisma.feeStructure.create({
    data: { name: "Tuition Fee", amount: 85_000, frequency: "MONTHLY", academicYearId: year.id, description: "Monthly tuition, all grades" },
  });
  const tuition = await prisma.feeStructure.create({
    data: { name: "Tuition Fee — Term 1", amount: 250_000, frequency: "TERMLY", academicYearId: year.id, description: "Termly tuition, all grades" },
  });
  const transport = await prisma.feeStructure.create({
    data: { name: "Transport (optional)", amount: 45_000, frequency: "TERMLY", academicYearId: year.id },
  });
  await prisma.feeStructure.create({
    data: { name: "Lab Fee — High School", gradeLevel: "9", amount: 30_000, frequency: "ANNUAL", academicYearId: year.id },
  });

  let invNo = 1;
  for (let i = 0; i < students.length; i++) {
    const student = students[i]!;
    const withTransport = i % 3 === 0;
    const invoice = await prisma.invoice.create({
      data: {
        number: `INV-2026-${String(invNo++).padStart(6, "0")}`,
        studentId: student.id, currency: "USD",
        issueDate: new Date(2026, 8, 5), dueDate: new Date(2026, 9, 5),
        status: "ISSUED",
        items: {
          create: [
            { description: tuition.name, amount: tuition.amount, feeStructureId: tuition.id },
            ...(withTransport ? [{ description: transport.name, amount: transport.amount, feeStructureId: transport.id }] : []),
          ],
        },
      },
      include: { items: true },
    });
    const total = invoice.items.reduce((s, it) => s + it.amount, 0);
    // ~half fully paid, a quarter partial, rest unpaid/overdue
    if (i % 2 === 0) {
      await prisma.payment.create({
        data: { invoiceId: invoice.id, amount: total, method: i % 4 === 0 ? "CARD" : "BANK_TRANSFER", status: "SUCCEEDED", provider: "MANUAL", paidAt: new Date(2026, 8, 20), recordedBy: accountantUser.id },
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
    } else if (i % 4 === 1) {
      await prisma.payment.create({
        data: { invoiceId: invoice.id, amount: Math.floor(total / 2), method: "CASH", status: "SUCCEEDED", provider: "MANUAL", paidAt: new Date(2026, 9, 1), recordedBy: accountantUser.id },
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PARTIALLY_PAID" } });
    } else {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "OVERDUE" } });
    }
  }

  // ---- payroll: salary structures + one paid run ----
  const allStaff = [...teachers, accountantStaff, registrarStaff];
  for (let i = 0; i < allStaff.length; i++) {
    await prisma.salaryStructure.create({
      data: {
        staffId: allStaff[i]!.id,
        basicSalary: 320_000 + i * 15_000, // $3,200+ per month
        currency: "USD",
        allowances: JSON.stringify([{ name: "Housing Allowance", amount: 60_000 }, { name: "Transport Allowance", amount: 20_000 }]),
        deductions: JSON.stringify([{ name: "Income Tax", amount: 48_000 }, { name: "Pension (5%)", amount: 16_000 }]),
      },
    });
  }
  const structures = await prisma.salaryStructure.findMany();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  await prisma.payrollRun.create({
    data: {
      month: lastMonth.getMonth() + 1, year: lastMonth.getFullYear(),
      status: "PAID", createdBy: admin.id, approvedAt: new Date(), paidAt: new Date(),
      payslips: {
        create: structures.map((s) => {
          const allowances = JSON.parse(s.allowances) as { amount: number }[];
          const deductions = JSON.parse(s.deductions) as { amount: number }[];
          const gross = s.basicSalary + allowances.reduce((a, c) => a + c.amount, 0);
          const totalDeductions = deductions.reduce((a, c) => a + c.amount, 0);
          return {
            staffId: s.staffId, basicSalary: s.basicSalary,
            allowances: s.allowances, deductions: s.deductions,
            gross, totalDeductions, net: gross - totalDeductions,
            currency: s.currency, status: "PAID" as const, paidAt: new Date(),
          };
        }),
      },
    },
  });

  // ---- a homework assignment for Kindergarten English (parent1's child's class) ----
  const teacher2User = await prisma.user.findUniqueOrThrow({ where: { email: "teacher2@vertik12.school" } });
  const kEnglish = await prisma.classSubject.findFirstOrThrow({
    where: { classRoom: { gradeLevel: "K" }, subject: { code: "ENG" } },
  });
  await prisma.assignment.create({
    data: {
      classSubjectId: kEnglish.id,
      title: "Reading practice — 'The Very Hungry Caterpillar'",
      instructions: "Read the story together twice this week. Ask your child to retell it in their own words, then write (or dictate) three sentences about their favourite part. Submit the sentences in the portal.",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdById: teacher2User.id,
    },
  });

  // ---- staff messaging (registrar ↔ teachers ↔ admin) ----
  const teacher1User = await prisma.user.findUniqueOrThrow({ where: { email: "teacher1@vertik12.school" } });
  await prisma.message.create({
    data: {
      senderId: registrarUser.id, recipientId: teacher1User.id,
      subject: "Grade 10 midterm results — deadline Friday",
      body: "Hello,\n\nPlease submit any outstanding Grade 10 midterm marks by Friday so report cards can be generated and approved before the parent conferences.\n\nThank you,\nFatima — Registrar's Office",
    },
  });
  await prisma.message.create({
    data: {
      senderId: teacher1User.id, recipientId: registrarUser.id,
      subject: "Re: Grade 10 midterm results — deadline Friday",
      body: "Hi Fatima,\n\nAll Mathematics marks are in the system. Two students were absent — I'll arrange make-up tests next week and update their entries.\n\nBest,\nLiam",
    },
  });
  await prisma.message.create({
    data: {
      senderId: admin.id, recipientId: registrarUser.id,
      subject: "Yearly payment discount now 10%",
      body: "FYI — the board approved a 10% discount for families paying the full year in advance. It is configured in School settings and applies automatically when you collect a yearly payment.",
    },
  });

  // ---- weekly timetable for the four senior classes ----
  //
  // Each subject has a single teacher across every class (teacher i teaches
  // subject i), so a naive grid would double-book them instantly. The
  // rotation below is a Latin square: on day d, class k takes subject
  // (k + d + p) mod 4 in period p. At any moment the four classes are on
  // four different subjects — four different teachers — so the demo data
  // satisfies the very conflict rules the scheduler enforces.
  const seniorRooms = ["9", "10", "11", "12"].map((g) => classRooms[GRADES.indexOf(g)]!);
  const coreSubjects = subjects.slice(0, 4);
  // 40-minute periods with a 5-minute changeover, starting at 08:00.
  const periodTime = (p: number) => {
    const startMinutes = 8 * 60 + p * 45;
    const hhmm = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    return { startTime: hhmm(startMinutes), endTime: hhmm(startMinutes + 40) };
  };
  const weekdays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"];
  for (let d = 0; d < weekdays.length; d++) {
    for (let k = 0; k < seniorRooms.length; k++) {
      for (let p = 0; p < coreSubjects.length; p++) {
        const subject = coreSubjects[(k + d + p) % coreSubjects.length]!;
        await prisma.timetableSlot.create({
          data: {
            classRoomId: seniorRooms[k]!.id,
            subjectId: subject.id,
            teacherId: pick(teachers, subjects.indexOf(subject)).id,
            dayOfWeek: weekdays[d]!,
            ...periodTime(p),
            room: `Room ${9 + k}`,
            createdById: registrarUser.id,
          },
        });
      }
    }
  }
  // Friday: the two elective periods. Both belong to teacher1, so they are
  // deliberately placed in different periods — the same rule, by hand.
  await prisma.timetableSlot.create({
    data: {
      classRoomId: grade10Room.id, subjectId: subjects[4]!.id, teacherId: teachers[0]!.id,
      dayOfWeek: "FRIDAY", ...periodTime(0), room: "Art Studio", createdById: registrarUser.id,
      note: "Bring sketchbooks",
    },
  });
  const grade12Room = classRooms[GRADES.indexOf("12")]!;
  await prisma.timetableSlot.create({
    data: {
      classRoomId: grade12Room.id, subjectId: subjects[8]!.id, teacherId: teachers[0]!.id,
      dayOfWeek: "FRIDAY", ...periodTime(1), room: "Room 12", createdById: registrarUser.id,
    },
  });

  // ---- an open schedule change request waiting in the registrar's inbox ----
  const mondayFirstPeriod = await prisma.timetableSlot.findFirstOrThrow({
    where: { dayOfWeek: "MONDAY", teacherId: teachers[0]!.id },
    orderBy: { startTime: "asc" },
  });
  await prisma.scheduleChangeRequest.create({
    data: {
      slotId: mondayFirstPeriod.id,
      staffId: teachers[0]!.id,
      requestedById: teacher1User.id,
      kind: "CHANGE",
      reason:
        "I have a standing departmental meeting first thing on Monday this term and keep arriving late to this period. " +
        "Friday mid-morning is clear for me — could it move there?",
      // Deliberately a slot that is genuinely free: the core teachers are
      // fully booked Monday–Thursday, so Friday is the only workable answer.
      proposedDayOfWeek: "FRIDAY",
      proposedStartTime: "09:30",
      proposedEndTime: "10:10",
    },
  });

  // ---- school calendar: term dates, holidays, exams, meetings ----
  const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  await prisma.calendarEvent.createMany({
    data: [
      {
        title: "Term 1 begins", category: "TERM", audience: "ALL",
        startDate: day(2026, 9, 1), endDate: day(2026, 9, 1),
        description: "First day of the 2026-2027 academic year.",
        academicYearId: year.id, createdById: admin.id,
      },
      {
        title: "New family orientation", category: "MEETING", audience: "PARENTS",
        startDate: day(2026, 9, 3), endDate: day(2026, 9, 3),
        allDay: false, startTime: "09:00", endTime: "11:00", location: "Main hall",
        description: "Tour of the school, meet the homeroom teachers, and collect the family handbook.",
        academicYearId: year.id, createdById: admin.id,
      },
      {
        title: "Mid-term break", category: "HOLIDAY", audience: "ALL",
        startDate: day(2026, 10, 26), endDate: day(2026, 10, 30),
        description: "School closed. Boarding students travel home on the 25th.",
        academicYearId: year.id, createdById: admin.id,
      },
      {
        title: "Midterm examinations", category: "EXAM", audience: "ALL",
        startDate: day(2026, 10, 20), endDate: day(2026, 10, 23),
        description: "Timetables are published on each class noticeboard a week in advance.",
        academicYearId: year.id, createdById: admin.id,
      },
      {
        title: "Parent–teacher conferences", category: "MEETING", audience: "PARENTS",
        startDate: day(2026, 11, 13), endDate: day(2026, 11, 13),
        allDay: false, startTime: "14:00", endTime: "18:00", location: "Classrooms",
        description: "Book a fifteen-minute slot with your child's teachers through the portal.",
        academicYearId: year.id, createdById: admin.id,
      },
      {
        title: "Staff curriculum review", category: "TRAINING", audience: "STAFF",
        startDate: day(2026, 11, 20), endDate: day(2026, 11, 20),
        allDay: false, startTime: "15:00", endTime: "17:00", location: "Room 12",
        academicYearId: year.id, createdById: admin.id,
      },
      {
        title: "Inter-house sports day", category: "SPORTS", audience: "ALL",
        startDate: day(2026, 12, 4), endDate: day(2026, 12, 4),
        location: "Sports field", description: "Families welcome. Refreshments sold in aid of the library fund.",
        academicYearId: year.id, createdById: admin.id,
      },
      {
        title: "Term 1 ends", category: "TERM", audience: "ALL",
        startDate: day(2026, 12, 18), endDate: day(2026, 12, 18),
        academicYearId: year.id, createdById: admin.id,
      },
      // A teacher's proposal still waiting for the administration — shows
      // the review queue with something in it on a fresh install.
      {
        title: "Grade 10 science museum trip", category: "ACTIVITY", audience: "ALL",
        startDate: day(2026, 11, 6), endDate: day(2026, 11, 6),
        allDay: false, startTime: "08:30", endTime: "15:00", location: "National Science Museum",
        description: "Full-day trip tied to the Term 1 physics unit. Coach booked, two staff chaperones needed.",
        status: "PENDING", academicYearId: year.id, createdById: teacher1User.id,
      },
    ],
  });

  // ---- announcements ----
  await prisma.announcement.create({
    data: { title: "Welcome to the 2026-2027 Academic Year!", body: "We are delighted to welcome all students and families back. Orientation for new families is on Sept 3rd in the main hall.", audience: "ALL", pinned: true, authorId: admin.id },
  });
  await prisma.announcement.create({
    data: { title: "Term 1 fee invoices issued", body: "Term 1 invoices have been sent. Payment is due by October 5th. Pay online from the parent portal or at the accounts office.", audience: "PARENTS", authorId: accountantUser.id },
  });
  await prisma.announcement.create({
    data: { title: "Staff meeting — Friday 3pm", body: "All teaching staff: curriculum review meeting in Room 12.", audience: "STAFF", authorId: admin.id },
  });

  console.log(`Seed complete:
  ${students.length} students, ${allStaff.length} staff, ${classRooms.length} classes
  Login: admin@vertik12.school / ${PASSWORD}       (Super Admin)
         registrar@vertik12.school / ${PASSWORD}   (Registrar)
         accounts@vertik12.school / ${PASSWORD}    (Accountant)
         teacher1@vertik12.school / ${PASSWORD}    (Teacher)
         parent1@vertik12.school / ${PASSWORD}     (Parent — two children)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
