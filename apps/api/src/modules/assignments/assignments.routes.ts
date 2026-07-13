import { Router } from "express";
import { createAssignmentSchema, feedbackSchema } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as assignments from "./assignments.service";

/** Teacher side of assignments; the parent side lives under /portal. */
export const assignmentsRouter = Router();
assignmentsRouter.use(authenticate, requireRoles("ADMIN", "TEACHER"));

const actor = (req: { user?: { sub: string; role: string } }) => ({ userId: req.user!.sub, role: req.user!.role });

assignmentsRouter.get("/", asyncHandler(async (req, res) => {
  res.json(ok(await assignments.listMine(actor(req))));
}));

assignmentsRouter.post("/", validateBody(createAssignmentSchema), asyncHandler(async (req, res) => {
  res.status(201).json(ok(await assignments.createAssignment(req.body, actor(req)), "Assignment sent to the class"));
}));

assignmentsRouter.get("/:id/submissions", asyncHandler(async (req, res) => {
  res.json(ok(await assignments.submissionsFor(req.params.id, actor(req))));
}));

assignmentsRouter.post("/submissions/:id/feedback", validateBody(feedbackSchema), asyncHandler(async (req, res) => {
  res.json(ok(await assignments.giveFeedback(req.params.id, req.body, actor(req)), "Feedback saved"));
}));
