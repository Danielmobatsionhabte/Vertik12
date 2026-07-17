import { Router } from "express";
import {
  createLessonPlanSchema, updateLessonPlanSchema, reviewLessonPlanSchema,
  paginationSchema, gradeCode, LESSON_PLAN_STATUSES,
  type PaginationQuery,
} from "@vertik12/shared";
import { z } from "zod";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import { sendAttachment } from "../assignments/assignments.routes";
import * as plans from "./lesson-plans.service";

/**
 * Lesson plans: the administration publishes the curriculum plan teachers
 * of each grade × subject follow; teachers can contribute their own.
 */
export const lessonPlansRouter = Router();
lessonPlansRouter.use(authenticate, requireRoles("ADMIN", "TEACHER"));

const actor = (req: { user?: { sub: string; role: string } }) => ({ userId: req.user!.sub, role: req.user!.role });

const listQuery = paginationSchema.extend({
  gradeLevel: gradeCode.optional(),
  subjectId: z.string().max(64).optional(),
  status: z.enum(LESSON_PLAN_STATUSES).optional(),
  week: z.coerce.number().int().min(1).max(52).optional(),
  mine: z.coerce.boolean().optional(), // only my own plans
});

lessonPlansRouter.get("/", validateQuery(listQuery), asyncHandler(async (req, res) => {
  const [list, locked] = await Promise.all([
    plans.listPlans(
      actor(req),
      parsedQuery<PaginationQuery & { gradeLevel?: string; subjectId?: string; status?: string; week?: number; mine?: boolean }>(req),
    ),
    plans.getLock(),
  ]);
  res.json(ok({ ...list, locked }));
}));

// The administration locks curriculum editing once it is complete, and
// re-opens it (gives permission back) when revisions are allowed.
lessonPlansRouter.post("/lock", requireRoles("ADMIN"), validateBody(z.object({ locked: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json(ok(await plans.setLock(req.body.locked),
      req.body.locked
        ? "Lesson plans are now locked — teachers can no longer add or modify them"
        : "Lesson-plan editing re-opened for teachers"));
  }));

// Admin sign-off on a teacher's submission: approve (publish) or reject.
lessonPlansRouter.post("/:id/review", requireRoles("ADMIN"), validateBody(reviewLessonPlanSchema),
  asyncHandler(async (req, res) => {
    const verdict = await plans.reviewPlan(req.params.id, req.body.action, req.body.note, actor(req));
    res.json(ok(verdict, req.body.action === "APPROVE" ? "Lesson plan approved and published" : "Lesson plan sent back to the author"));
  }));

lessonPlansRouter.post("/", validateBody(createLessonPlanSchema), asyncHandler(async (req, res) => {
  res.status(201).json(ok(await plans.createPlan(req.body, actor(req)), "Lesson plan saved"));
}));

lessonPlansRouter.patch("/:id", validateBody(updateLessonPlanSchema), asyncHandler(async (req, res) => {
  res.json(ok(await plans.updatePlan(req.params.id, req.body, actor(req)), "Lesson plan updated"));
}));

lessonPlansRouter.delete("/:id", asyncHandler(async (req, res) => {
  res.json(ok(await plans.deletePlan(req.params.id, actor(req)), "Lesson plan removed"));
}));

lessonPlansRouter.get("/:id/attachment", asyncHandler(async (req, res) => {
  sendAttachment(res, await plans.planAttachment(req.params.id, actor(req)));
}));
