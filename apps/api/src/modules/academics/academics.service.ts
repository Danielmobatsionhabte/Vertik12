import { GRADE_LEVELS } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";

// ---------- grade levels (admin-configured ladder) ----------

/**
 * Grade naming varies by country (KG1, Year 7, Form 2…), so the school
 * defines its own ladder. An empty table is auto-seeded with the classic
 * K-12 defaults so existing installations keep working untouched.
 */
export async function listGrades() {
  const count = await prisma.gradeLevelDef.count();
  if (count === 0) {
    await prisma.gradeLevelDef.createMany({
      data: GRADE_LEVELS.map((code, i) => ({
        code,
        name: code === "K" ? "Kindergarten" : `Grade ${code}`,
        sortOrder: i,
      })),
    });
  }
  return prisma.gradeLevelDef.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
}

export async function createGrade(input: { code: string; name: string; sortOrder: number }) {
  const existing = await prisma.gradeLevelDef.findUnique({ where: { code: input.code } });
  if (existing) throw ApiError.conflict(`A grade with code "${input.code}" already exists`);
  return prisma.gradeLevelDef.create({ data: input });
}

export async function updateGrade(id: string, input: { name?: string; sortOrder?: number }) {
  // The code itself is immutable — student/class rows reference it by value.
  const grade = await prisma.gradeLevelDef.findUnique({ where: { id } });
  if (!grade) throw ApiError.notFound("Grade level");
  return prisma.gradeLevelDef.update({ where: { id }, data: input });
}

/** Remove a grade — only while nothing references its code. */
export async function deleteGrade(id: string) {
  const grade = await prisma.gradeLevelDef.findUnique({ where: { id } });
  if (!grade) throw ApiError.notFound("Grade level");
  const [students, classes, subjects, fees] = await Promise.all([
    prisma.student.count({ where: { gradeLevel: grade.code } }),
    prisma.classRoom.count({ where: { gradeLevel: grade.code } }),
    prisma.subject.count({ where: { gradeLevel: grade.code } }),
    prisma.feeStructure.count({ where: { gradeLevel: grade.code } }),
  ]);
  const used = students + classes + subjects + fees;
  if (used > 0) {
    throw ApiError.badRequest(
      `"${grade.name}" is still used by ${students} student(s), ${classes} class(es), ${subjects} subject(s) and ${fees} fee preset(s) — reassign them first`,
    );
  }
  return prisma.gradeLevelDef.delete({ where: { id } });
}

/** Services call this before storing a grade code (admission, class create…). */
export async function assertGradeExists(code: string) {
  await listGrades(); // seeds defaults on first touch
  const grade = await prisma.gradeLevelDef.findUnique({ where: { code } });
  if (!grade) {
    throw ApiError.badRequest(`Grade "${code}" is not configured — an administrator must add it under Classes › Grade levels first`);
  }
  return grade;
}

// ---------- academic years & terms ----------

export const listAcademicYears = () =>
  prisma.academicYear.findMany({ orderBy: { startDate: "desc" }, include: { terms: { orderBy: { startDate: "asc" } } } });

export async function createAcademicYear(input: { name: string; startDate: Date; endDate: Date; isActive: boolean }) {
  // Only one year can be active — the "current" year used across the app.
  if (input.isActive) {
    await prisma.academicYear.updateMany({ data: { isActive: false } });
  }
  return prisma.academicYear.create({ data: input });
}

export async function activateAcademicYear(id: string) {
  await prisma.academicYear.updateMany({ data: { isActive: false } });
  return prisma.academicYear.update({ where: { id }, data: { isActive: true } });
}

/**
 * Remove an academic year — only while no data lives in it. Classes,
 * enrollments, fee presets and exams (via the year's terms) all block the
 * deletion, so school history can never be cascade-deleted by accident;
 * empty terms are just calendar setup and are removed with the year.
 * The active year can't be removed — another year must be activated first.
 */
export async function deleteAcademicYear(id: string) {
  const year = await prisma.academicYear.findUnique({ where: { id } });
  if (!year) throw ApiError.notFound("Academic year");
  if (year.isActive) {
    throw ApiError.badRequest(`${year.name} is the active year — make another year active before removing it`);
  }
  const [classes, enrollments, fees, exams] = await Promise.all([
    prisma.classRoom.count({ where: { academicYearId: id } }),
    prisma.enrollment.count({ where: { academicYearId: id } }),
    prisma.feeStructure.count({ where: { academicYearId: id } }),
    prisma.exam.count({ where: { term: { is: { academicYearId: id } } } }),
  ]);
  if (classes + enrollments + fees + exams > 0) {
    throw ApiError.badRequest(
      `${year.name} still has ${classes} class(es), ${enrollments} enrollment(s), ${fees} fee preset(s) and ` +
      `${exams} exam(s) — remove or move them first`,
    );
  }
  return prisma.academicYear.delete({ where: { id } });
}

export const createTerm = (input: { name: string; academicYearId: string; startDate: Date; endDate: Date }) =>
  prisma.term.create({ data: input });

/** The active academic year, required by several modules. */
export async function activeYear() {
  const year = await prisma.academicYear.findFirst({ where: { isActive: true } });
  if (!year) throw ApiError.badRequest("No active academic year. Create one and mark it active first.");
  return year;
}

// ---------- class rooms ----------

export const listClassRooms = (academicYearId?: string) =>
  prisma.classRoom.findMany({
    where: academicYearId ? { academicYearId } : { academicYear: { isActive: true } },
    orderBy: [{ gradeLevel: "asc" }, { section: "asc" }],
    include: {
      homeroomTeacher: { include: { user: { select: { firstName: true, lastName: true } } } },
      academicYear: { select: { name: true } },
      _count: { select: { enrollments: true } },
    },
  });

export async function getClassRoom(id: string) {
  const classRoom = await prisma.classRoom.findUnique({
    where: { id },
    include: {
      homeroomTeacher: { include: { user: { select: { firstName: true, lastName: true } } } },
      enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } },
      classSubjects: { include: { subject: true, teacher: { include: { user: { select: { firstName: true, lastName: true } } } } } },
      timetableSlots: { include: { subject: true } },
    },
  });
  if (!classRoom) throw ApiError.notFound("Class room");
  return classRoom;
}

export const createClassRoom = async (input: {
  name: string; gradeLevel: string; section: string; branch?: string; capacity: number;
  academicYearId: string; homeroomTeacherId?: string;
}) => {
  await assertGradeExists(input.gradeLevel); // grades are set up by the admin first
  return prisma.classRoom.create({ data: { ...input, branch: input.branch || null } });
};

/**
 * New-year rollover helper: copy every class of one academic year into
 * another so the admin doesn't re-create each section by hand. Copies the
 * structure (name, grade, section, branch, capacity, homeroom teacher) and
 * each class's subject/teacher assignments. Classes whose name already
 * exists in the target year are skipped, so re-running tops up a partial
 * manual setup instead of failing. Enrollments, attendance and timetables
 * are NOT copied — students move via "Assign students to an academic year".
 */
export async function copyClassRooms(fromAcademicYearId: string, toAcademicYearId: string) {
  if (fromAcademicYearId === toAcademicYearId) {
    throw ApiError.badRequest("Pick two different academic years — the source and the destination");
  }
  const [from, to] = await Promise.all([
    prisma.academicYear.findUnique({ where: { id: fromAcademicYearId } }),
    prisma.academicYear.findUnique({ where: { id: toAcademicYearId } }),
  ]);
  if (!from) throw ApiError.notFound("Source academic year");
  if (!to) throw ApiError.notFound("Destination academic year");

  const [source, existing] = await Promise.all([
    prisma.classRoom.findMany({
      where: { academicYearId: fromAcademicYearId },
      include: { classSubjects: { select: { subjectId: true, teacherId: true } } },
      orderBy: [{ gradeLevel: "asc" }, { section: "asc" }],
    }),
    prisma.classRoom.findMany({ where: { academicYearId: toAcademicYearId }, select: { name: true } }),
  ]);
  if (source.length === 0) {
    throw ApiError.badRequest(`${from.name} has no classes to copy`);
  }

  const taken = new Set(existing.map((c) => c.name));
  const toCopy = source.filter((c) => !taken.has(c.name));

  await prisma.$transaction(
    toCopy.map((c) =>
      prisma.classRoom.create({
        data: {
          name: c.name,
          gradeLevel: c.gradeLevel,
          section: c.section,
          branch: c.branch,
          capacity: c.capacity,
          academicYearId: toAcademicYearId,
          homeroomTeacherId: c.homeroomTeacherId,
          classSubjects: {
            create: c.classSubjects.map((cs) => ({ subjectId: cs.subjectId, teacherId: cs.teacherId })),
          },
        },
      }),
    ),
  );

  return { copied: toCopy.length, skipped: source.length - toCopy.length, from: from.name, to: to.name };
}

/**
 * Class updates split by responsibility:
 *  - name/section/branch/capacity → SUPER_ADMIN only
 *  - homeroom teacher → ADMIN / REGISTRAR too
 */
export async function updateClassRoom(
  id: string,
  input: { name?: string; section?: string; branch?: string; capacity?: number; homeroomTeacherId?: string | null },
  actorRole: string,
) {
  const structural = ["name", "section", "branch", "capacity"].some((k) => (input as Record<string, unknown>)[k] !== undefined);
  if (structural && actorRole !== "SUPER_ADMIN") {
    throw ApiError.forbidden("Only the Super Admin can rename or restructure classes");
  }
  return prisma.classRoom.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.section !== undefined ? { section: input.section } : {}),
      ...(input.branch !== undefined ? { branch: input.branch || null } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.homeroomTeacherId !== undefined ? { homeroomTeacherId: input.homeroomTeacherId || null } : {}),
    },
    include: { homeroomTeacher: { include: { user: { select: { firstName: true, lastName: true } } } } },
  });
}

/** SUPER_ADMIN removes a class — only while it has no enrolled students. */
export async function deleteClassRoom(id: string) {
  const classRoom = await prisma.classRoom.findUnique({
    where: { id },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!classRoom) throw ApiError.notFound("Class room");
  if (classRoom._count.enrollments > 0) {
    throw ApiError.badRequest(`${classRoom.name} has ${classRoom._count.enrollments} enrolled student(s) — move them first`);
  }
  return prisma.classRoom.delete({ where: { id } });
}

// ---------- subjects ----------

export const listSubjects = (gradeLevel?: string) =>
  prisma.subject.findMany({
    // A grade filter also returns all-grade subjects (gradeLevel null).
    where: gradeLevel ? { OR: [{ gradeLevel }, { gradeLevel: null }] } : undefined,
    orderBy: [{ gradeLevel: "asc" }, { code: "asc" }],
    include: { _count: { select: { classSubjects: true } } },
  });

export const createSubject = (input: { code: string; name: string; description?: string; gradeLevel?: string }) =>
  prisma.subject.create({ data: { ...input, code: input.code.toUpperCase() } });

export async function assignSubject(input: { classRoomId: string; subjectId: string; teacherId?: string }) {
  // A grade-scoped subject can only be assigned to a class of that grade.
  const [subject, classRoom] = await Promise.all([
    prisma.subject.findUnique({ where: { id: input.subjectId } }),
    prisma.classRoom.findUnique({ where: { id: input.classRoomId } }),
  ]);
  if (!subject) throw ApiError.notFound("Subject");
  if (!classRoom) throw ApiError.notFound("Class room");
  if (subject.gradeLevel && subject.gradeLevel !== classRoom.gradeLevel) {
    throw ApiError.badRequest(
      `${subject.name} is a grade ${subject.gradeLevel} subject and cannot be assigned to ${classRoom.name}`,
    );
  }
  return prisma.classSubject.upsert({
    where: { classRoomId_subjectId: { classRoomId: input.classRoomId, subjectId: input.subjectId } },
    create: input,
    update: { teacherId: input.teacherId ?? null },
  });
}

/** One specific teacher's teaching load (admin view, drives the assignment UI). */
export async function subjectsForTeacher(staffId: string) {
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff) throw ApiError.notFound("Staff member");
  return prisma.classSubject.findMany({
    where: { teacherId: staffId, classRoom: { academicYear: { isActive: true } } },
    orderBy: [{ classRoom: { gradeLevel: "asc" } }, { subject: { code: "asc" } }],
    include: {
      subject: true,
      classRoom: { select: { id: true, name: true, gradeLevel: true, _count: { select: { enrollments: true } } } },
    },
  });
}

/**
 * Remove a subject from a class entirely. Refused once results exist for
 * that class × subject — history must stay intact (unassign the teacher
 * instead if you only want to change who teaches it).
 */
export async function removeClassSubject(id: string) {
  const classSubject = await prisma.classSubject.findUnique({
    where: { id },
    include: { subject: true, classRoom: true },
  });
  if (!classSubject) throw ApiError.notFound("Class subject");
  const resultCount = await prisma.examResult.count({
    where: {
      subjectId: classSubject.subjectId,
      student: { enrollments: { some: { classRoomId: classSubject.classRoomId } } },
    },
  });
  if (resultCount > 0) {
    throw ApiError.badRequest(
      `${classSubject.subject.name} already has ${resultCount} recorded result(s) in ${classSubject.classRoom.name} — unassign the teacher instead of removing the subject`,
    );
  }
  return prisma.classSubject.delete({ where: { id } });
}

/**
 * The signed-in teacher's teaching load: every class × subject assigned to
 * them (a teacher with two subjects sees both). Admin/registrar callers get
 * the full assignment list so the same gradebook UI works for them.
 */
export async function teachingAssignments(userId: string, role: string) {
  const where =
    role === "TEACHER"
      ? { teacher: { is: { userId } } }
      : {}; // ADMIN / SUPER_ADMIN / REGISTRAR see all assignments
  return prisma.classSubject.findMany({
    where: { ...where, classRoom: { academicYear: { isActive: true } } },
    orderBy: [{ classRoom: { gradeLevel: "asc" } }, { subject: { code: "asc" } }],
    include: {
      subject: true,
      classRoom: { select: { id: true, name: true, gradeLevel: true, _count: { select: { enrollments: true } } } },
      teacher: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
}

// ---------- timetable ----------

export const addTimetableSlot = (input: {
  classRoomId: string; subjectId: string; teacherId?: string;
  dayOfWeek: string; startTime: string; endTime: string;
}) => prisma.timetableSlot.create({ data: input });

export const removeTimetableSlot = (id: string) => prisma.timetableSlot.delete({ where: { id } });
