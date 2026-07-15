import { Router } from "express";
import { createAnnouncementSchema, paginationSchema } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok, paginate, toSkipTake } from "../../lib/pagination";

/**
 * Announcements are simple enough that the Prisma calls live in the route
 * file — no separate service layer needed until the logic grows.
 */
export const announcementsRouter = Router();
announcementsRouter.use(authenticate);

/** Audience filter per role — students/parents only see what's addressed to them. */
function audiencesFor(role: string): string[] | undefined {
  return role === "STUDENT" ? ["ALL", "STUDENTS"]
    : role === "PARENT" ? ["ALL", "PARENTS"]
    : undefined; // staff see everything
}

// Paginated feed — pinned first, newest first.
announcementsRouter.get("/", validateQuery(paginationSchema), asyncHandler(async (req, res) => {
  const q = parsedQuery<{ page: number; pageSize: number; search?: string }>(req);
  const audiences = audiencesFor(req.user!.role);
  const where = {
    ...(audiences ? { audience: { in: audiences } } : {}),
    ...(q.search ? { OR: [{ title: { contains: q.search } }, { body: { contains: q.search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      ...toSkipTake(q),
      include: { author: { select: { firstName: true, lastName: true, role: true } } },
    }),
    prisma.announcement.count({ where }),
  ]);
  res.json(ok(paginate(items, total, q)));
}));

// Sidebar badge: announcements published since the user last opened the
// page (never opened ⇒ everything visible to them counts as new).
announcementsRouter.get("/unread-count", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { announcementsSeenAt: true },
  });
  const audiences = audiencesFor(req.user!.role);
  const unread = await prisma.announcement.count({
    where: {
      ...(audiences ? { audience: { in: audiences } } : {}),
      ...(user?.announcementsSeenAt ? { createdAt: { gt: user.announcementsSeenAt } } : {}),
    },
  });
  res.json(ok({ unread }));
}));

// Opening the Announcements page clears the badge.
announcementsRouter.post("/mark-seen", asyncHandler(async (req, res) => {
  await prisma.user.update({ where: { id: req.user!.sub }, data: { announcementsSeenAt: new Date() } });
  res.json(ok({ unread: 0 }));
}));

announcementsRouter.post("/", requireRoles("ADMIN", "REGISTRAR", "TEACHER"), validateBody(createAnnouncementSchema),
  asyncHandler(async (req, res) => {
    const item = await prisma.announcement.create({ data: { ...req.body, authorId: req.user!.sub } });
    res.status(201).json(ok(item, "Announcement published"));
  }));

announcementsRouter.delete("/:id", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    await prisma.announcement.delete({ where: { id: req.params.id } });
    res.json(ok(null, "Announcement removed"));
  }));
