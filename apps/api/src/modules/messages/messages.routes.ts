import { Router } from "express";
import { composeMessageSchema, STAFF_ROLES } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { authenticate } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";

/**
 * Internal email-like messaging for every portal:
 *  - staff ↔ staff (registrar, teachers, administrators, accountant)
 *  - staff ↔ parents/students (the school writes to families and back)
 * Parents/students can only write TO staff — never to other families.
 */
export const messagesRouter = Router();
messagesRouter.use(authenticate);

const isStaff = (role: string) => (STAFF_ROLES as string[]).includes(role);

const senderSelect = { select: { id: true, firstName: true, lastName: true, role: true, email: true } };

// Directory of people the user can write to (everyone but themselves).
// Staff can reach anyone with a login; families can only reach staff.
messagesRouter.get("/recipients", asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: req.user!.sub },
      ...(isStaff(req.user!.role) ? {} : { role: { in: STAFF_ROLES } }),
    },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, role: true, email: true },
  });
  res.json(ok(users));
}));

messagesRouter.get("/inbox", asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.message.findMany({
      where: { recipientId: req.user!.sub },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { sender: senderSelect },
    }),
    prisma.message.count({ where: { recipientId: req.user!.sub, readAt: null } }),
  ]);
  res.json(ok({ items, unread }));
}));

// Lightweight unread counter for the sidebar badge (polled by every portal).
messagesRouter.get("/unread-count", asyncHandler(async (req, res) => {
  const unread = await prisma.message.count({ where: { recipientId: req.user!.sub, readAt: null } });
  res.json(ok({ unread }));
}));

messagesRouter.get("/sent", asyncHandler(async (req, res) => {
  const items = await prisma.message.findMany({
    where: { senderId: req.user!.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { recipient: senderSelect },
  });
  res.json(ok(items));
}));

// Reading a message marks it read (only the recipient can open it).
messagesRouter.get("/:id", asyncHandler(async (req, res) => {
  const message = await prisma.message.findUnique({
    where: { id: req.params.id },
    include: { sender: senderSelect, recipient: senderSelect },
  });
  if (!message || (message.recipientId !== req.user!.sub && message.senderId !== req.user!.sub)) {
    throw ApiError.notFound("Message");
  }
  if (message.recipientId === req.user!.sub && !message.readAt) {
    await prisma.message.update({ where: { id: message.id }, data: { readAt: new Date() } });
  }
  res.json(ok(message));
}));

messagesRouter.post("/", validateBody(composeMessageSchema), asyncHandler(async (req, res) => {
  const recipient = await prisma.user.findUnique({ where: { id: req.body.recipientId } });
  if (!recipient || !recipient.isActive) {
    throw ApiError.badRequest("Recipient must be an active account");
  }
  // Families can only write to the school, never to other families.
  if (!isStaff(req.user!.role) && !isStaff(recipient.role)) {
    throw ApiError.forbidden("You can only message school staff");
  }
  const message = await prisma.message.create({
    data: { senderId: req.user!.sub, recipientId: req.body.recipientId, subject: req.body.subject, body: req.body.body },
    include: { recipient: senderSelect },
  });
  res.status(201).json(ok(message, "Message sent"));
}));
