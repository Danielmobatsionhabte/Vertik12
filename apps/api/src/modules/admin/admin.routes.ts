import { Router } from "express";
import { z } from "zod";
import { adminUpdateUserSchema, createUserSchema, gradeBandsSchema, paginationSchema, schoolSettingsSchema, ROLES } from "@vertik12/shared";
import { getGradeScale, setGradeScale } from "../../lib/grading";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as admin from "./admin.service";

/** System administration — every route is SUPER_ADMIN only. */
export const adminRouter = Router();
adminRouter.use(authenticate, requireRoles());

// Users ------------------------------------------------------------------
const userListQuery = paginationSchema.extend({ role: z.enum(ROLES).optional() });

adminRouter.get("/users", validateQuery(userListQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await admin.listUsers(parsedQuery(req))));
  }));

adminRouter.post("/users", validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await admin.createUser(req.body), "User created"));
  }));

adminRouter.patch("/users/:id", validateBody(adminUpdateUserSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await admin.updateUser(req.params.id, req.body, req.user!.sub), "User updated"));
  }));

adminRouter.post("/users/:id/reset-password",
  asyncHandler(async (req, res) => {
    res.json(ok(await admin.resetPassword(req.params.id), "Password reset"));
  }));

// Audit logs --------------------------------------------------------------
adminRouter.get("/audit-logs", validateQuery(paginationSchema.extend({ userId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.json(ok(await admin.listAuditLogs(parsedQuery(req))));
  }));

// Visitors (per user per day: IP, country, browser & device) ---------------
adminRouter.get("/visits",
  validateQuery(paginationSchema.extend({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })),
  asyncHandler(async (req, res) => {
    res.json(ok(await admin.listVisits(parsedQuery(req))));
  }));

// School settings ----------------------------------------------------------
adminRouter.get("/settings",
  asyncHandler(async (_req, res) => {
    res.json(ok(await admin.getSettings()));
  }));

adminRouter.put("/settings", validateBody(schoolSettingsSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await admin.updateSettings(req.body), "School settings saved"));
  }));

// Grading scale (country-specific letter bands used everywhere grades
// are generated: exam results, report cards, transcripts) ----------------
adminRouter.get("/grading",
  asyncHandler(async (_req, res) => {
    res.json(ok(await getGradeScale()));
  }));

adminRouter.put("/grading", validateBody(gradeBandsSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await setGradeScale(req.body.bands), "Grading scale saved"));
  }));
