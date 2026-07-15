import { Router } from "express";
import type { Response } from "express";
import { createAssignmentSchema, updateAssignmentSchema, feedbackSchema, paginationSchema, type PaginationQuery } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as assignments from "./assignments.service";

/** Teacher side of assignments; the parent side lives under /portal. */
export const assignmentsRouter = Router();
assignmentsRouter.use(authenticate, requireRoles("ADMIN", "TEACHER"));

const actor = (req: { user?: { sub: string; role: string } }) => ({ userId: req.user!.sub, role: req.user!.role });

/** Stream a stored attachment back to the browser as a download. */
export function sendAttachment(res: Response, file: { name: string; type: string; buffer: Buffer }) {
  res.setHeader("Content-Type", file.type);
  // Sanitized at upload time, but never trust stored names in a header.
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  res.send(file.buffer);
}

assignmentsRouter.get("/", validateQuery(paginationSchema), asyncHandler(async (req, res) => {
  res.json(ok(await assignments.listMine(actor(req), parsedQuery<PaginationQuery>(req))));
}));

assignmentsRouter.post("/", validateBody(createAssignmentSchema), asyncHandler(async (req, res) => {
  res.status(201).json(ok(await assignments.createAssignment(req.body, actor(req)), "Assignment sent to the class"));
}));

// Teachers can modify or remove what they sent — changes show up in the
// parent portal immediately.
assignmentsRouter.patch("/:id", validateBody(updateAssignmentSchema), asyncHandler(async (req, res) => {
  res.json(ok(await assignments.updateAssignment(req.params.id, req.body, actor(req)), "Assignment updated"));
}));

assignmentsRouter.delete("/:id", asyncHandler(async (req, res) => {
  res.json(ok(await assignments.deleteAssignment(req.params.id, actor(req)), "Assignment removed"));
}));

assignmentsRouter.get("/:id/attachment", asyncHandler(async (req, res) => {
  sendAttachment(res, await assignments.assignmentAttachment(req.params.id, actor(req)));
}));

assignmentsRouter.get("/:id/submissions", asyncHandler(async (req, res) => {
  res.json(ok(await assignments.submissionsFor(req.params.id, actor(req))));
}));

assignmentsRouter.get("/submissions/:id/attachment", asyncHandler(async (req, res) => {
  sendAttachment(res, await assignments.submissionAttachment(req.params.id, actor(req)));
}));

assignmentsRouter.post("/submissions/:id/feedback", validateBody(feedbackSchema), asyncHandler(async (req, res) => {
  res.json(ok(await assignments.giveFeedback(req.params.id, req.body, actor(req)), "Feedback saved"));
}));
