import { Router } from "express";
import { checkoutSchema, submitAssignmentSchema } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as portal from "./portal.service";
import * as assignments from "../assignments/assignments.service";
import { sendAttachment } from "../assignments/assignments.routes";

/** Parent portal — guardian accounts only; scoped to their own children. */
export const portalRouter = Router();
portalRouter.use(authenticate, requireRoles("PARENT"));

portalRouter.get("/children", asyncHandler(async (req, res) => {
  res.json(ok(await portal.myChildren(req.user!.sub)));
}));

portalRouter.get("/children/:studentId", asyncHandler(async (req, res) => {
  res.json(ok(await portal.childOverview(req.user!.sub, req.params.studentId)));
}));

portalRouter.post("/pay", validateBody(checkoutSchema), asyncHandler(async (req, res) => {
  const { invoiceId, ...urls } = req.body;
  res.json(ok(await portal.payInvoice(req.user!.sub, invoiceId, urls)));
}));

// Assignments: parents see their child's homework and submit on their behalf.
portalRouter.get("/children/:studentId/assignments", asyncHandler(async (req, res) => {
  res.json(ok(await assignments.assignmentsForChild(req.user!.sub, req.params.studentId)));
}));

portalRouter.post("/assignments/submit", validateBody(submitAssignmentSchema), asyncHandler(async (req, res) => {
  res.status(201).json(ok(await assignments.submitForChild(req.body, req.user!.sub), "Assignment submitted"));
}));

// The teacher's attached brief (PDF/JPG/DOC), ownership-checked.
portalRouter.get("/assignments/:id/attachment", asyncHandler(async (req, res) => {
  sendAttachment(res, await assignments.assignmentAttachmentForParent(req.user!.sub, req.params.id));
}));
