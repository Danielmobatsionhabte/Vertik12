import {
  DAYS_OF_WEEK, SCHEDULE_MANAGER_ROLES, periodsOverlap, minutesOfDay, formatPeriod,
  type DayOfWeek, type ScheduleConflict, type TimetableQuery, type AvailabilityQuery,
} from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";

/**
 * Teacher timetabling.
 *
 * A timetable slot says "class X studies subject Y with teacher Z, every
 * <weekday>, from <start> to <end>, in room R" for one academic year. The
 * job of this service is to make sure the grid stays physically possible:
 *
 *   · a class can only study one subject at a time,
 *   · a teacher can only be in one classroom at a time,
 *   · a room can only host one class at a time.
 *
 * Every write path — the registrar placing a period, an admin moving one,
 * and the approval of a teacher's change request — goes through
 * `assertPlaceable`, so there is exactly one implementation of the rules
 * and no way to sneak a clash in through a side door.
 */

const isManager = (role: string) => SCHEDULE_MANAGER_ROLES.includes(role as never);

/** Rooms are matched case/spacing-insensitively: "Lab 1" == "lab  1". */
const roomKey = (room: string | null | undefined) => room?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";

const slotInclude = {
  subject: { select: { id: true, code: true, name: true } },
  teacher: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
  classRoom: {
    select: {
      id: true, name: true, gradeLevel: true, section: true,
      academicYear: { select: { id: true, name: true } },
    },
  },
} as const;

type SlotWithRelations = Awaited<ReturnType<typeof prisma.timetableSlot.findFirst<{ include: typeof slotInclude }>>>;

const teacherName = (slot: NonNullable<SlotWithRelations>) =>
  slot.teacher ? `${slot.teacher.user.firstName} ${slot.teacher.user.lastName}` : null;

/** The year to schedule in — an explicit one, or the school's active year. */
async function resolveYearId(academicYearId?: string): Promise<string> {
  if (academicYearId) {
    const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
    if (!year) throw ApiError.notFound("Academic year");
    return year.id;
  }
  const active = await prisma.academicYear.findFirst({ where: { isActive: true } });
  if (!active) {
    throw ApiError.badRequest("No active academic year — create one and mark it active before building the timetable");
  }
  return active.id;
}

// ---------- the conflict engine ----------

export interface SlotCandidate {
  classRoomId: string;
  subjectId: string;
  teacherId?: string | null;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  room?: string | null;
}

/**
 * Every clash the candidate period would cause, in the order a scheduler
 * cares about them. Reads the whole day for that academic year in one
 * query and compares in memory — a school day is a few hundred rows, and
 * doing the overlap test in JS keeps it identical to the check the web app
 * runs while the registrar drags a period around.
 */
export async function findConflicts(
  candidate: SlotCandidate,
  academicYearId: string,
  excludeSlotId?: string,
): Promise<ScheduleConflict[]> {
  const sameDay = await prisma.timetableSlot.findMany({
    where: {
      dayOfWeek: candidate.dayOfWeek,
      classRoom: { academicYearId },
      ...(excludeSlotId ? { id: { not: excludeSlotId } } : {}),
    },
    include: slotInclude,
  });

  const conflicts: ScheduleConflict[] = [];
  const candidateRoom = roomKey(candidate.room);

  for (const slot of sameDay) {
    if (!slot) continue;
    if (!periodsOverlap(candidate.startTime, candidate.endTime, slot.startTime, slot.endTime)) continue;

    const describe = (kind: ScheduleConflict["kind"], message: string): ScheduleConflict => ({
      kind,
      message,
      slotId: slot.id,
      dayOfWeek: slot.dayOfWeek as DayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      className: slot.classRoom.name,
      subjectName: slot.subject.name,
      teacherName: teacherName(slot),
      room: slot.room,
    });

    const when = `${dayLabel(slot.dayOfWeek)} ${formatPeriod(slot.startTime, slot.endTime)}`;

    // 1. The class is already busy — two teachers in the same room with the
    //    same students is the clash this whole feature exists to prevent.
    if (slot.classRoomId === candidate.classRoomId) {
      conflicts.push(describe(
        "CLASS",
        `${slot.classRoom.name} already has ${slot.subject.name}` +
        `${teacherName(slot) ? ` with ${teacherName(slot)}` : ""} on ${when}`,
      ));
      continue; // one clash per existing slot is enough to explain the refusal
    }

    // 2. The teacher is already teaching somewhere else.
    if (candidate.teacherId && slot.teacherId === candidate.teacherId) {
      conflicts.push(describe(
        "TEACHER",
        `${teacherName(slot) ?? "That teacher"} is teaching ${slot.subject.name} to ${slot.classRoom.name} on ${when}`,
      ));
      continue;
    }

    // 3. The room is already taken.
    if (candidateRoom && roomKey(slot.room) === candidateRoom) {
      conflicts.push(describe(
        "ROOM",
        `${slot.room} is taken by ${slot.classRoom.name} (${slot.subject.name}) on ${when}`,
      ));
    }
  }

  // Most fundamental clash first, so the refusal message is deterministic
  // and names the reason a scheduler would fix first — the students can't
  // be in two lessons at once, whoever is teaching them.
  const priority: Record<ScheduleConflict["kind"], number> = { CLASS: 0, TEACHER: 1, ROOM: 2 };
  return conflicts.sort(
    (a, b) => priority[a.kind] - priority[b.kind] || a.startTime.localeCompare(b.startTime),
  );
}

const dayLabel = (day: string) => day.charAt(0) + day.slice(1).toLowerCase();

/**
 * Validate a candidate period and refuse it if it cannot be placed.
 * Returns the normalized data ready for Prisma.
 */
async function assertPlaceable(candidate: SlotCandidate, academicYearId: string, excludeSlotId?: string) {
  if (minutesOfDay(candidate.endTime) <= minutesOfDay(candidate.startTime)) {
    throw ApiError.badRequest("The period must end after it starts");
  }

  const [classRoom, subject] = await Promise.all([
    prisma.classRoom.findUnique({ where: { id: candidate.classRoomId }, include: { academicYear: true } }),
    prisma.subject.findUnique({ where: { id: candidate.subjectId } }),
  ]);
  if (!classRoom) throw ApiError.notFound("Class");
  if (!subject) throw ApiError.notFound("Subject");
  if (classRoom.academicYearId !== academicYearId) {
    throw ApiError.badRequest(
      `${classRoom.name} belongs to ${classRoom.academicYear.name} — schedule it in that academic year`,
    );
  }

  // The class must actually take this subject: the timetable schedules the
  // curriculum, it doesn't invent it.
  const classSubject = await prisma.classSubject.findUnique({
    where: { classRoomId_subjectId: { classRoomId: candidate.classRoomId, subjectId: candidate.subjectId } },
  });
  if (!classSubject) {
    throw ApiError.badRequest(
      `${classRoom.name} does not take ${subject.name} — assign the subject to the class first (Classes › Subjects)`,
    );
  }

  // Unassigned periods inherit the teacher who already owns the subject in
  // that class, so the common case needs no extra input from the registrar.
  const teacherId = candidate.teacherId ?? classSubject.teacherId ?? null;
  if (teacherId) {
    const teacher = await prisma.staff.findUnique({
      where: { id: teacherId },
      include: { user: { select: { firstName: true, lastName: true, isActive: true } } },
    });
    if (!teacher) throw ApiError.notFound("Teacher");
    if (teacher.status !== "ACTIVE" || !teacher.user.isActive) {
      throw ApiError.badRequest(
        `${teacher.user.firstName} ${teacher.user.lastName} is not an active staff member — pick someone else`,
      );
    }
  }

  const conflicts = await findConflicts({ ...candidate, teacherId }, academicYearId, excludeSlotId);
  if (conflicts.length > 0) {
    throw new ApiError(409, conflicts[0]!.message, { conflicts });
  }

  return {
    classRoomId: candidate.classRoomId,
    subjectId: candidate.subjectId,
    teacherId,
    dayOfWeek: candidate.dayOfWeek,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    room: candidate.room?.trim() || null,
  };
}

/** Dry run for the UI: "would this work?" without writing anything. */
export async function checkPlacement(candidate: SlotCandidate, academicYearId?: string, excludeSlotId?: string) {
  const yearId = await resolveYearId(academicYearId);
  const conflicts = await findConflicts(candidate, yearId, excludeSlotId);
  return { ok: conflicts.length === 0, conflicts };
}

// ---------- reading the timetable ----------

/**
 * Slots matching the filters, ordered day-by-day then by start time so the
 * caller can render a week grid straight from the array.
 *
 * A teacher who doesn't name a filter gets their own timetable — the
 * common case, and it means a teacher can never fish for a colleague's
 * schedule by omitting parameters.
 */
export async function listSlots(query: TimetableQuery, actor: { sub: string; role: string }) {
  const academicYearId = await resolveYearId(query.academicYearId);

  let teacherId = query.teacherId;
  if (!isManager(actor.role)) {
    const staff = await prisma.staff.findUnique({ where: { userId: actor.sub }, select: { id: true } });
    if (!staff) throw ApiError.forbidden("Only staff members have a teaching timetable");
    teacherId = staff.id; // teachers always see their own load, whatever they ask for
  }

  const slots = await prisma.timetableSlot.findMany({
    where: {
      classRoom: { academicYearId },
      ...(query.classRoomId ? { classRoomId: query.classRoomId } : {}),
      ...(teacherId ? { teacherId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.dayOfWeek ? { dayOfWeek: query.dayOfWeek } : {}),
    },
    include: slotInclude,
    orderBy: [{ startTime: "asc" }],
  });

  // Prisma can't order by a weekday name, so the calendar order is applied
  // here — Monday first, not alphabetically ("FRIDAY" before "MONDAY").
  const dayOrder = new Map(DAYS_OF_WEEK.map((d, i) => [d as string, i]));
  slots.sort((a, b) => (dayOrder.get(a.dayOfWeek)! - dayOrder.get(b.dayOfWeek)!) || a.startTime.localeCompare(b.startTime));

  return { academicYearId, slots };
}

/** The signed-in teacher's own week, plus their open change requests. */
export async function mySchedule(userId: string, academicYearId?: string) {
  const staff = await prisma.staff.findUnique({ where: { userId }, select: { id: true } });
  if (!staff) throw ApiError.forbidden("Only staff members have a teaching timetable");
  const yearId = await resolveYearId(academicYearId);

  const [slots, requests] = await Promise.all([
    prisma.timetableSlot.findMany({
      where: { teacherId: staff.id, classRoom: { academicYearId: yearId } },
      include: slotInclude,
      orderBy: [{ startTime: "asc" }],
    }),
    prisma.scheduleChangeRequest.findMany({
      where: { staffId: staff.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const dayOrder = new Map(DAYS_OF_WEEK.map((d, i) => [d as string, i]));
  slots.sort((a, b) => (dayOrder.get(a.dayOfWeek)! - dayOrder.get(b.dayOfWeek)!) || a.startTime.localeCompare(b.startTime));

  const periods = slots.length;
  const minutes = slots.reduce((sum, s) => sum + (minutesOfDay(s.endTime) - minutesOfDay(s.startTime)), 0);
  return { staffId: staff.id, academicYearId: yearId, slots, requests, load: { periods, minutes } };
}

/**
 * Which teachers are free in a given window — the registrar's answer to
 * "then who can take it?". Returns every active teaching staff member,
 * flagged busy or free, with the clashing period named for the busy ones.
 */
export async function teacherAvailability(query: AvailabilityQuery) {
  const academicYearId = await resolveYearId(query.academicYearId);
  const [teachers, sameDay] = await Promise.all([
    prisma.staff.findMany({
      where: { staffType: "TEACHING", status: "ACTIVE", user: { isActive: true } },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { staffNo: "asc" },
    }),
    prisma.timetableSlot.findMany({
      where: {
        dayOfWeek: query.dayOfWeek,
        classRoom: { academicYearId },
        ...(query.excludeSlotId ? { id: { not: query.excludeSlotId } } : {}),
      },
      include: slotInclude,
    }),
  ]);

  const clashing = sameDay.filter((s) => periodsOverlap(query.startTime, query.endTime, s.startTime, s.endTime));

  return teachers.map((teacher) => {
    const busy = clashing.find((s) => s.teacherId === teacher.id);
    return {
      staffId: teacher.id,
      name: `${teacher.user.firstName} ${teacher.user.lastName}`,
      designation: teacher.designation,
      free: !busy,
      busyWith: busy ? `${busy.subject.name} · ${busy.classRoom.name}` : null,
    };
  });
}

// ---------- writing the timetable ----------

export async function createSlot(
  input: SlotCandidate & { note?: string; academicYearId?: string },
  actorId: string,
) {
  // The year comes from the class being scheduled — a class only ever
  // belongs to one — so the caller never has to send it.
  const owningYear = await prisma.classRoom.findUnique({
    where: { id: input.classRoomId },
    select: { academicYearId: true },
  });
  const academicYearId = await resolveYearId(input.academicYearId ?? owningYear?.academicYearId);
  const data = await assertPlaceable(input, academicYearId);
  return prisma.timetableSlot.create({
    data: { ...data, note: input.note?.trim() || null, createdById: actorId },
    include: slotInclude,
  });
}

/** Move / retime / reassign an existing period, re-checking every rule. */
export async function updateSlot(id: string, input: Partial<SlotCandidate> & { note?: string | null }) {
  const slot = await prisma.timetableSlot.findUnique({
    where: { id },
    include: { classRoom: { select: { academicYearId: true } } },
  });
  if (!slot) throw ApiError.notFound("Timetable slot");

  const candidate: SlotCandidate = {
    classRoomId: input.classRoomId ?? slot.classRoomId,
    subjectId: input.subjectId ?? slot.subjectId,
    teacherId: input.teacherId === undefined ? slot.teacherId : input.teacherId,
    dayOfWeek: (input.dayOfWeek ?? slot.dayOfWeek) as DayOfWeek,
    startTime: input.startTime ?? slot.startTime,
    endTime: input.endTime ?? slot.endTime,
    room: input.room === undefined ? slot.room : input.room,
  };

  // Moving a period into another year's class would silently escape the
  // conflict checks, which are scoped per year — resolve from the target.
  const targetYear = input.classRoomId
    ? (await prisma.classRoom.findUnique({ where: { id: input.classRoomId }, select: { academicYearId: true } }))?.academicYearId
    : slot.classRoom.academicYearId;
  const data = await assertPlaceable(candidate, await resolveYearId(targetYear), id);

  return prisma.timetableSlot.update({
    where: { id },
    data: { ...data, ...(input.note === undefined ? {} : { note: input.note || null }) },
    include: slotInclude,
  });
}

export async function deleteSlot(id: string) {
  const slot = await prisma.timetableSlot.findUnique({ where: { id }, include: slotInclude });
  if (!slot) throw ApiError.notFound("Timetable slot");
  await prisma.timetableSlot.delete({ where: { id } });
  return { id, className: slot.classRoom.name, subjectName: slot.subject.name };
}

// ---------- change requests ----------

/**
 * Notify a user in the internal inbox. Fire-and-forget: a schedule decision
 * must never fail because the notification could not be written.
 */
function notify(recipientId: string, senderId: string, subject: string, body: string) {
  void prisma.message
    .create({ data: { senderId, recipientId, subject, body } })
    .catch(() => undefined);
}

/** The registrars + admins who should hear about a new request. */
async function scheduleManagers() {
  return prisma.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "REGISTRAR", "SUPER_ADMIN"] } },
    select: { id: true },
  });
}

/**
 * A teacher files a request against one of their own periods. Only the
 * teacher who actually teaches the slot can ask for it to be changed —
 * with the administration able to file on anyone's behalf (a teacher rings
 * the office to say they're unavailable).
 */
export async function createRequest(
  input: {
    slotId: string; kind: string; reason: string;
    proposedDayOfWeek?: string; proposedStartTime?: string; proposedEndTime?: string; proposedTeacherId?: string;
  },
  actor: { sub: string; role: string; name: string },
) {
  const slot = await prisma.timetableSlot.findUnique({ where: { id: input.slotId }, include: slotInclude });
  if (!slot) throw ApiError.notFound("Timetable slot");
  if (!slot.teacherId) throw ApiError.badRequest("This period has no teacher assigned yet");

  const staff = await prisma.staff.findUnique({ where: { userId: actor.sub }, select: { id: true } });
  const ownsSlot = staff?.id === slot.teacherId;
  if (!ownsSlot && !isManager(actor.role)) {
    throw ApiError.forbidden("You can only ask to change your own periods");
  }

  const open = await prisma.scheduleChangeRequest.findFirst({
    where: { slotId: slot.id, status: "PENDING" },
  });
  if (open) {
    throw ApiError.conflict("There is already an open request for this period — the registrar is reviewing it");
  }

  if (input.proposedTeacherId) {
    const cover = await prisma.staff.findUnique({ where: { id: input.proposedTeacherId } });
    if (!cover) throw ApiError.notFound("Covering teacher");
  }

  const request = await prisma.scheduleChangeRequest.create({
    data: {
      slotId: slot.id,
      staffId: slot.teacherId,
      requestedById: actor.sub,
      kind: input.kind,
      reason: input.reason,
      proposedDayOfWeek: input.proposedDayOfWeek ?? null,
      proposedStartTime: input.proposedStartTime ?? null,
      proposedEndTime: input.proposedEndTime ?? null,
      proposedTeacherId: input.proposedTeacherId ?? null,
    },
  });

  const period = `${dayLabel(slot.dayOfWeek)} ${formatPeriod(slot.startTime, slot.endTime)}`;
  const managers = await scheduleManagers();
  for (const manager of managers) {
    if (manager.id === actor.sub) continue;
    notify(
      manager.id,
      actor.sub,
      `Schedule change request — ${slot.subject.name}, ${slot.classRoom.name}`,
      `${actor.name} cannot make ${period} (${slot.subject.name}, ${slot.classRoom.name}).\n\n` +
      `Reason: ${input.reason}\n\n` +
      `Review it under Timetable › Change requests.`,
    );
  }

  return request;
}

/** Teachers see their own requests; the administration sees everyone's. */
export async function listRequests(actor: { sub: string; role: string }, status?: string) {
  const where: { status?: string; staffId?: string } = {};
  if (status) where.status = status;

  if (!isManager(actor.role)) {
    const staff = await prisma.staff.findUnique({ where: { userId: actor.sub }, select: { id: true } });
    if (!staff) throw ApiError.forbidden("Only staff members can view schedule requests");
    where.staffId = staff.id;
  }

  const requests = await prisma.scheduleChangeRequest.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  // Hydrate the slot and the requesting teacher in bulk — the request row
  // stores plain ids so the table stays free of deep relation chains.
  const [slots, staffRows] = await Promise.all([
    prisma.timetableSlot.findMany({ where: { id: { in: requests.map((r) => r.slotId) } }, include: slotInclude }),
    prisma.staff.findMany({
      where: { id: { in: requests.map((r) => r.staffId) } },
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const staffById = new Map(staffRows.map((s) => [s.id, s]));

  return requests.map((request) => {
    const staff = staffById.get(request.staffId);
    return {
      ...request,
      slot: slotById.get(request.slotId) ?? null,
      teacherName: staff ? `${staff.user.firstName} ${staff.user.lastName}` : "—",
    };
  });
}

/** Badge for the registrar's sidebar. */
export async function pendingRequestCount(actor: { sub: string; role: string }) {
  if (!isManager(actor.role)) return { pending: 0 };
  return { pending: await prisma.scheduleChangeRequest.count({ where: { status: "PENDING" } }) };
}

/**
 * The registrar's decision.
 *
 * Approving is not just a status flip: for a CHANGE the slot actually moves
 * (to the reviewer's override, else the teacher's proposal), for a SWAP the
 * covering teacher takes it over, and for a CANCEL the period is removed.
 * Each of those goes back through `assertPlaceable`, so approving a request
 * can never introduce the very clash this module prevents — if the proposed
 * time is taken, the approval is refused with the reason.
 */
export async function reviewRequest(
  id: string,
  input: {
    action: "APPROVE" | "REJECT"; note?: string;
    dayOfWeek?: string; startTime?: string; endTime?: string; teacherId?: string | null; room?: string | null;
  },
  reviewer: { sub: string; name: string },
) {
  const request = await prisma.scheduleChangeRequest.findUnique({ where: { id } });
  if (!request) throw ApiError.notFound("Schedule change request");
  if (request.status !== "PENDING") {
    throw ApiError.badRequest(`This request was already ${request.status.toLowerCase()}`);
  }

  const slot = await prisma.timetableSlot.findUnique({ where: { id: request.slotId }, include: slotInclude });
  if (!slot) throw ApiError.notFound("Timetable slot");

  let outcome = "";

  if (input.action === "APPROVE") {
    if (request.kind === "CANCEL") {
      await prisma.timetableSlot.delete({ where: { id: slot.id } });
      outcome = "The period was removed from the timetable.";
    } else {
      // Reviewer's override wins over the teacher's proposal; anything
      // neither of them specified stays as it is.
      const dayOfWeek = (input.dayOfWeek ?? request.proposedDayOfWeek ?? slot.dayOfWeek) as DayOfWeek;
      const startTime = input.startTime ?? request.proposedStartTime ?? slot.startTime;
      const endTime = input.endTime ?? request.proposedEndTime ?? slot.endTime;
      const teacherId =
        input.teacherId !== undefined ? input.teacherId
        : request.kind === "SWAP" ? request.proposedTeacherId
        : slot.teacherId;

      const unchanged =
        dayOfWeek === slot.dayOfWeek && startTime === slot.startTime &&
        endTime === slot.endTime && teacherId === slot.teacherId && input.room === undefined;
      if (unchanged) {
        throw ApiError.badRequest(
          "Approving would change nothing — set the new day, time or covering teacher (or reject the request)",
        );
      }

      const moved = await updateSlot(slot.id, {
        dayOfWeek, startTime, endTime, teacherId,
        ...(input.room === undefined ? {} : { room: input.room }),
      });
      outcome =
        `Your period is now ${dayLabel(moved.dayOfWeek)} ${formatPeriod(moved.startTime, moved.endTime)}` +
        `${moved.teacher ? ` with ${moved.teacher.user.firstName} ${moved.teacher.user.lastName} teaching it` : ""}.`;
    }
  }

  const updated = await prisma.scheduleChangeRequest.update({
    where: { id },
    data: {
      status: input.action === "APPROVE" ? "APPROVED" : "REJECTED",
      reviewNote: input.note || null,
      reviewedById: reviewer.sub,
      reviewedAt: new Date(),
    },
  });

  notify(
    request.requestedById,
    reviewer.sub,
    `Schedule request ${input.action === "APPROVE" ? "approved" : "declined"} — ${slot.subject.name}, ${slot.classRoom.name}`,
    `${reviewer.name} ${input.action === "APPROVE" ? "approved" : "declined"} your request for ` +
    `${dayLabel(slot.dayOfWeek)} ${formatPeriod(slot.startTime, slot.endTime)}.\n\n` +
    `${outcome}${outcome ? "\n\n" : ""}${input.note ? `Note: ${input.note}` : ""}`.trim(),
  );

  return updated;
}

/** The teacher withdraws a request they no longer need. */
export async function cancelRequest(id: string, actor: { sub: string; role: string }) {
  const request = await prisma.scheduleChangeRequest.findUnique({ where: { id } });
  if (!request) throw ApiError.notFound("Schedule change request");
  if (request.requestedById !== actor.sub && !isManager(actor.role)) {
    throw ApiError.forbidden("You can only withdraw your own requests");
  }
  if (request.status !== "PENDING") {
    throw ApiError.badRequest(`This request was already ${request.status.toLowerCase()}`);
  }
  return prisma.scheduleChangeRequest.update({ where: { id }, data: { status: "CANCELLED" } });
}
