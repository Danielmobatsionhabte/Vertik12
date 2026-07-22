import { CALENDAR_PUBLISHER_ROLES, type CalendarQuery } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";

/**
 * The school calendar — one shared source of truth every portal reads.
 *
 * Two rules shape everything here:
 *
 *  1. **Everyone reads it.** Term dates, holidays, exam windows and meetings
 *     are visible to staff, teachers, parents and students alike; only the
 *     `audience` field narrows an individual event (a staff training day is
 *     not the parents' business).
 *
 *  2. **Everyone can propose, the administration publishes.** A teacher who
 *     wants a field trip on the calendar, or a parent proposing a PTA date,
 *     creates the event exactly like an admin does — it simply lands as
 *     PENDING in the admin's review queue instead of going live.
 */

/** Dates are stored at midnight UTC so a day never shifts by timezone. */
function toUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

const canPublish = (role: string) => CALENDAR_PUBLISHER_ROLES.includes(role as never);

/** Which audiences a role is allowed to see. Staff see everything. */
function audiencesFor(role: string): string[] | undefined {
  return role === "STUDENT" ? ["ALL", "STUDENTS"]
    : role === "PARENT" ? ["ALL", "PARENTS"]
    : undefined;
}

const authorSelect = {
  id: true, firstName: true, lastName: true, role: true,
} satisfies Prisma.UserSelect;

/** Events carry a user id, not a relation — resolve the authors in one query. */
async function withAuthors<T extends { createdById: string }>(events: T[]) {
  const ids = [...new Set(events.map((e) => e.createdById))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: authorSelect })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return events.map((e) => ({
    ...e,
    author: byId.get(e.createdById) ?? null,
  }));
}

/**
 * Everything overlapping the requested window (defaults to the current
 * month ± a month, which is what the month grid and the dashboard need).
 *
 * An event overlaps the window when it starts before the window ends and
 * ends after the window starts — so a two-week holiday shows up in every
 * month it touches, not just the one it began in.
 */
export async function listEvents(query: CalendarQuery, actor: { sub: string; role: string }) {
  const audiences = audiencesFor(actor.role);
  const status = query.status ?? "PUBLISHED";
  // Only the administration may browse the pending/rejected queues. Everyone
  // else sees published events — plus their own proposals, so a teacher can
  // tell whether the trip they suggested was approved.
  if (status !== "PUBLISHED" && !canPublish(actor.role)) {
    throw ApiError.forbidden("Only an administrator can review proposed events");
  }

  const visibility: Prisma.CalendarEventWhereInput =
    status === "PUBLISHED"
      ? { OR: [{ status: "PUBLISHED" }, { createdById: actor.sub }] }
      : { status };

  // The month grid asks for a window; the review queue must not have one
  // imposed, or a proposal for next term would never surface in it.
  const now = new Date();
  const windowed = status === "PUBLISHED" || query.from !== undefined || query.to !== undefined;
  const from = toUtcDay(query.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const to = toUtcDay(query.to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)));

  const events = await prisma.calendarEvent.findMany({
    where: {
      AND: [
        visibility,
        ...(windowed ? [{ startDate: { lte: to } }, { endDate: { gte: from } }] : []),
        ...(audiences ? [{ audience: { in: audiences } }] : []),
        ...(query.category ? [{ category: query.category }] : []),
        ...(query.academicYearId ? [{ academicYearId: query.academicYearId }] : []),
      ],
    },
    orderBy: [{ startDate: "asc" }, { startTime: "asc" }, { title: "asc" }],
    include: { academicYear: { select: { id: true, name: true } } },
  });
  return withAuthors(events);
}

/** Next events from today onwards — the dashboard's "what's coming up" strip. */
export async function upcomingEvents(actor: { sub: string; role: string }, take = 5) {
  const audiences = audiencesFor(actor.role);
  const today = toUtcDay(new Date());
  const events = await prisma.calendarEvent.findMany({
    where: {
      status: "PUBLISHED",
      endDate: { gte: today },
      ...(audiences ? { audience: { in: audiences } } : {}),
    },
    orderBy: [{ startDate: "asc" }, { startTime: "asc" }],
    take,
  });
  return withAuthors(events);
}

/** How many proposals are waiting — the admin's sidebar badge. */
export async function pendingCount(role: string) {
  if (!canPublish(role)) return { pending: 0 };
  return { pending: await prisma.calendarEvent.count({ where: { status: "PENDING" } }) };
}

export async function getEvent(id: string, actor: { sub: string; role: string }) {
  const event = await prisma.calendarEvent.findUnique({
    where: { id },
    include: { academicYear: { select: { id: true, name: true } } },
  });
  if (!event) throw ApiError.notFound("Calendar event");
  const audiences = audiencesFor(actor.role);
  const hidden = event.status !== "PUBLISHED" && event.createdById !== actor.sub && !canPublish(actor.role);
  if (hidden || (audiences && !audiences.includes(event.audience))) {
    throw ApiError.notFound("Calendar event");
  }
  const [withAuthor] = await withAuthors([event]);
  return withAuthor;
}

/**
 * Add an event. Admins publish directly; every other stakeholder's event is
 * a proposal awaiting review — the return message tells them which happened.
 */
export async function createEvent(
  input: {
    title: string; description?: string; category: string; audience: string;
    startDate: Date; endDate?: Date; allDay: boolean; startTime?: string; endTime?: string;
    location?: string; academicYearId?: string;
  },
  actor: { sub: string; role: string },
) {
  if (input.academicYearId) {
    const year = await prisma.academicYear.findUnique({ where: { id: input.academicYearId } });
    if (!year) throw ApiError.notFound("Academic year");
  }
  const startDate = toUtcDay(input.startDate);
  const endDate = toUtcDay(input.endDate ?? input.startDate);
  const published = canPublish(actor.role);

  const event = await prisma.calendarEvent.create({
    data: {
      title: input.title,
      description: input.description || null,
      category: input.category,
      audience: input.audience,
      startDate,
      endDate,
      allDay: input.allDay,
      startTime: input.allDay ? null : input.startTime ?? null,
      endTime: input.allDay ? null : input.endTime ?? null,
      location: input.location || null,
      academicYearId: input.academicYearId ?? null,
      status: published ? "PUBLISHED" : "PENDING",
      createdById: actor.sub,
    },
  });
  return { event, published };
}

/**
 * Edit an event. The administration can edit anything; an author can still
 * correct their own proposal while it waits for review (once published or
 * rejected it is out of their hands).
 */
export async function updateEvent(
  id: string,
  input: Record<string, unknown>,
  actor: { sub: string; role: string },
) {
  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) throw ApiError.notFound("Calendar event");

  if (!canPublish(actor.role)) {
    if (event.createdById !== actor.sub) {
      throw ApiError.forbidden("You can only edit events you proposed");
    }
    if (event.status !== "PENDING") {
      throw ApiError.badRequest("This event has already been reviewed — ask an administrator to change it");
    }
  }

  const next = { ...event, ...input } as typeof event;
  const startDate = toUtcDay(next.startDate);
  const endDate = toUtcDay(next.endDate);
  if (endDate < startDate) throw ApiError.badRequest("The end date cannot be before the start date");
  if (input.academicYearId) {
    const year = await prisma.academicYear.findUnique({ where: { id: input.academicYearId as string } });
    if (!year) throw ApiError.notFound("Academic year");
  }

  return prisma.calendarEvent.update({
    where: { id },
    data: {
      title: next.title,
      description: next.description || null,
      category: next.category,
      audience: next.audience,
      startDate,
      endDate,
      allDay: next.allDay,
      // Switching an event to all-day drops the times rather than leaving
      // stale ones behind for the next edit to resurrect.
      startTime: next.allDay ? null : next.startTime,
      endTime: next.allDay ? null : next.endTime,
      location: next.location || null,
      academicYearId: (input.academicYearId as string | null | undefined) === null ? null : next.academicYearId,
    },
  });
}

/** Admin decision on a proposal. Approving publishes it as-is. */
export async function reviewEvent(id: string, action: "APPROVE" | "REJECT", note: string | undefined, reviewerId: string) {
  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) throw ApiError.notFound("Calendar event");
  if (event.status !== "PENDING") {
    throw ApiError.badRequest(`This event is already ${event.status.toLowerCase()}`);
  }
  return prisma.calendarEvent.update({
    where: { id },
    data: {
      status: action === "APPROVE" ? "PUBLISHED" : "REJECTED",
      reviewNote: note || null,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  });
}

/** Remove an event — the administration, or the author while it's pending. */
export async function deleteEvent(id: string, actor: { sub: string; role: string }) {
  const event = await prisma.calendarEvent.findUnique({ where: { id } });
  if (!event) throw ApiError.notFound("Calendar event");
  if (!canPublish(actor.role)) {
    if (event.createdById !== actor.sub) throw ApiError.forbidden("You can only withdraw events you proposed");
    if (event.status === "PUBLISHED") {
      throw ApiError.badRequest("Published events are removed by an administrator");
    }
  }
  await prisma.calendarEvent.delete({ where: { id } });
  return { id };
}
