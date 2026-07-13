import { Router } from "express";
import { createAnnouncementSchema } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";

/**
 * Announcements are simple enough that the Prisma calls live in the route
 * file — no separate service layer needed until the logic grows.
 */
export const announcementsRouter = Router();
announcementsRouter.use(authenticate);

announcementsRouter.get("/", asyncHandler(async (req, res) => {
  // Students/parents only see announcements addressed to them.
  const role = req.user!.role;
  const audiences =
    role === "STUDENT" ? ["ALL", "STUDENTS"]
    : role === "PARENT" ? ["ALL", "PARENTS"]
    : undefined; // staff see everything
  const items = await prisma.announcement.findMany({
    where: audiences ? { audience: { in: audiences } } : undefined,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 50,
    include: { author: { select: { firstName: true, lastName: true, role: true } } },
  });
  res.json(ok(items));
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
