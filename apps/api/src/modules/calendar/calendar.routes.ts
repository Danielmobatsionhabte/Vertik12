import { Router } from "express";
import {
  calendarEventSchema, updateCalendarEventSchema, reviewCalendarEventSchema,
  calendarQuerySchema, type CalendarQuery,
} from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as calendar from "./calendar.service";

/**
 * School calendar — the one module every portal shares.
 *
 * Reads are open to every signed-in account (audience-filtered in the
 * service); writes are open too, but only the administration's events go
 * live immediately — everyone else proposes and an admin reviews.
 */
export const calendarRouter = Router();
calendarRouter.use(authenticate);

calendarRouter.get("/", validateQuery(calendarQuerySchema), asyncHandler(async (req, res) => {
  const query = parsedQuery<CalendarQuery>(req);
  res.json(ok(await calendar.listEvents(query, req.user!)));
}));

// Dashboard strip: the next few things happening, for whoever is signed in.
calendarRouter.get("/upcoming", asyncHandler(async (req, res) => {
  res.json(ok(await calendar.upcomingEvents(req.user!)));
}));

// Sidebar badge for the administration's review queue.
calendarRouter.get("/pending-count", asyncHandler(async (req, res) => {
  res.json(ok(await calendar.pendingCount(req.user!.role)));
}));

calendarRouter.get("/:id", asyncHandler(async (req, res) => {
  res.json(ok(await calendar.getEvent(req.params.id, req.user!)));
}));

// Any stakeholder may add to the calendar — admins publish, others propose.
calendarRouter.post("/", validateBody(calendarEventSchema), asyncHandler(async (req, res) => {
  const { event, published } = await calendar.createEvent(req.body, req.user!);
  res.status(201).json(ok(
    event,
    published ? "Event added to the school calendar" : "Event proposed — an administrator will review it",
  ));
}));

calendarRouter.patch("/:id", validateBody(updateCalendarEventSchema), asyncHandler(async (req, res) => {
  res.json(ok(await calendar.updateEvent(req.params.id, req.body, req.user!), "Event updated"));
}));

calendarRouter.post("/:id/review", requireRoles("ADMIN"), validateBody(reviewCalendarEventSchema),
  asyncHandler(async (req, res) => {
    const event = await calendar.reviewEvent(req.params.id, req.body.action, req.body.note, req.user!.sub);
    res.json(ok(event, req.body.action === "APPROVE" ? "Event published to the calendar" : "Proposal rejected"));
  }));

calendarRouter.delete("/:id", asyncHandler(async (req, res) => {
  res.json(ok(await calendar.deleteEvent(req.params.id, req.user!), "Event removed"));
}));
