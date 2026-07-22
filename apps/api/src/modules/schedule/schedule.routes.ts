import { Router } from "express";
import { z } from "zod";
import {
  timetableSlotSchema, updateTimetableSlotSchema, timetableQuerySchema, availabilityQuerySchema,
  scheduleChangeRequestSchema, reviewScheduleRequestSchema, SCHEDULE_REQUEST_STATUSES,
  type TimetableQuery, type AvailabilityQuery,
} from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as schedule from "./schedule.service";

/**
 * Teacher timetabling.
 *
 *  - ADMIN / REGISTRAR build and move periods (every write is conflict-checked).
 *  - TEACHERs read their own week and file a change request when they
 *    can't make a period; the service scopes their reads to themselves.
 */
export const scheduleRouter = Router();
scheduleRouter.use(authenticate, requireRoles("ADMIN", "REGISTRAR", "TEACHER"));

const manage = requireRoles("ADMIN", "REGISTRAR");

// ---------- reading ----------

scheduleRouter.get("/slots", validateQuery(timetableQuerySchema), asyncHandler(async (req, res) => {
  res.json(ok(await schedule.listSlots(parsedQuery<TimetableQuery>(req), req.user!)));
}));

// The signed-in teacher's own week + their open requests + teaching load.
scheduleRouter.get("/my", asyncHandler(async (req, res) => {
  res.json(ok(await schedule.mySchedule(req.user!.sub, req.query.academicYearId as string | undefined)));
}));

// "Who is free at this time?" — the registrar's answer to a change request.
scheduleRouter.get("/availability", manage, validateQuery(availabilityQuerySchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await schedule.teacherAvailability(parsedQuery<AvailabilityQuery>(req))));
  }));

// ---------- writing ----------

// Dry run: the builder calls this as the registrar picks a time, so the
// clash is shown before they hit save rather than as a failed request.
const checkSchema = timetableSlotSchema.innerType().extend({
  academicYearId: z.string().min(1).max(64).optional(),
  excludeSlotId: z.string().min(1).max(64).optional(),
});

scheduleRouter.post("/check", manage, validateBody(checkSchema), asyncHandler(async (req, res) => {
  const { academicYearId, excludeSlotId, ...candidate } = req.body;
  res.json(ok(await schedule.checkPlacement(candidate, academicYearId, excludeSlotId)));
}));

scheduleRouter.post("/slots", manage, validateBody(timetableSlotSchema), asyncHandler(async (req, res) => {
  const slot = await schedule.createSlot(req.body, req.user!.sub);
  res.status(201).json(ok(slot, "Period added to the timetable"));
}));

scheduleRouter.patch("/slots/:id", manage, validateBody(updateTimetableSlotSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await schedule.updateSlot(req.params.id, req.body), "Period updated"));
  }));

scheduleRouter.delete("/slots/:id", manage, asyncHandler(async (req, res) => {
  const removed = await schedule.deleteSlot(req.params.id);
  res.json(ok(removed, `${removed.subjectName} removed from ${removed.className}`));
}));

// ---------- change requests ----------

scheduleRouter.get("/requests", validateQuery(z.object({ status: z.enum(SCHEDULE_REQUEST_STATUSES).optional() })),
  asyncHandler(async (req, res) => {
    const { status } = parsedQuery<{ status?: string }>(req);
    res.json(ok(await schedule.listRequests(req.user!, status)));
  }));

scheduleRouter.get("/requests/pending-count", asyncHandler(async (req, res) => {
  res.json(ok(await schedule.pendingRequestCount(req.user!)));
}));

// A teacher asks for one of their periods to be moved, swapped or dropped.
scheduleRouter.post("/requests", validateBody(scheduleChangeRequestSchema), asyncHandler(async (req, res) => {
  const request = await schedule.createRequest(req.body, req.user!);
  res.status(201).json(ok(request, "Request sent to the registrar"));
}));

// Approving a CHANGE actually moves the period — and is refused if the
// new time clashes, so a decision can never break the timetable.
scheduleRouter.post("/requests/:id/review", manage, validateBody(reviewScheduleRequestSchema),
  asyncHandler(async (req, res) => {
    const updated = await schedule.reviewRequest(req.params.id, req.body, req.user!);
    res.json(ok(updated, req.body.action === "APPROVE" ? "Request approved and the timetable updated" : "Request declined"));
  }));

scheduleRouter.post("/requests/:id/cancel", asyncHandler(async (req, res) => {
  res.json(ok(await schedule.cancelRequest(req.params.id, req.user!), "Request withdrawn"));
}));
