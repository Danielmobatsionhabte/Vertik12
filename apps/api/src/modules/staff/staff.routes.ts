import { Router } from "express";
import { z } from "zod";
import { createStaffSchema, updateStaffSchema, paginationSchema, STAFF_TYPES, STAFF_STATUSES } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as staff from "./staff.service";

export const staffRouter = Router();
staffRouter.use(authenticate);

const listQuery = paginationSchema.extend({
  staffType: z.enum(STAFF_TYPES).optional(),
  status: z.enum(STAFF_STATUSES).optional(),
  role: z.enum(["ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"]).optional(),
  department: z.string().trim().max(100).optional(),
  academicYearId: z.string().optional(), // roster during that year (past years too)
  sort: z.enum(["staffNo", "recent"]).optional(), // recent = latest hires first
});

staffRouter.get(
  "/",
  requireRoles("ADMIN", "ACCOUNTANT"),
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.listStaff(parsedQuery(req))));
  }),
);

// Per-year HR report (any year, incl. previous ones).
// NOTE: registered before "/:id" so the path isn't swallowed by the param route.
staffRouter.get(
  "/report",
  requireRoles("ADMIN", "ACCOUNTANT"),
  validateQuery(z.object({
    academicYearId: z.string().min(1),
    staffType: z.enum(STAFF_TYPES).optional(),
    status: z.enum(STAFF_STATUSES).optional(),
    department: z.string().trim().max(100).optional(),
  })),
  asyncHandler(async (req, res) => {
    const { academicYearId, ...filters } =
      parsedQuery<{ academicYearId: string; staffType?: string; status?: string; department?: string }>(req);
    res.json(ok(await staff.staffYearReport(academicYearId, filters)));
  }),
);

staffRouter.get(
  "/:id",
  requireRoles("ADMIN", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.getStaff(req.params.id)));
  }),
);

staffRouter.post(
  "/",
  requireRoles("ADMIN"),
  validateBody(createStaffSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await staff.createStaff(req.body), "Staff member created"));
  }),
);

staffRouter.patch(
  "/:id",
  requireRoles("ADMIN"),
  validateBody(updateStaffSchema.extend({ firstName: z.string().optional(), lastName: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.updateStaff(req.params.id, req.body), "Staff updated"));
  }),
);

// HR status management: active / on leave / terminated / resigned.
// Access follows automatically (termination revokes the login, re-hiring
// restores it) — see the service for the rules.
staffRouter.post(
  "/:id/status",
  requireRoles("ADMIN"),
  validateBody(z.object({ status: z.enum(STAFF_STATUSES) })),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.setStaffStatus(req.params.id, req.body.status, req.user!.role), "Staff status updated"));
  }),
);

// Grant/revoke web access (login) — registrar access is Super-Admin-only.
staffRouter.post(
  "/:id/access",
  requireRoles("ADMIN"),
  validateBody(z.object({ isActive: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json(ok(
      await staff.setWebAccess(req.params.id, req.body.isActive, req.user!.role),
      req.body.isActive ? "Web access granted" : "Web access revoked",
    ));
  }),
);

staffRouter.delete(
  "/:id",
  requireRoles("ADMIN"),
  validateBody(z.object({ status: z.enum(["TERMINATED", "RESIGNED"]).default("RESIGNED") })),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.deactivateStaff(req.params.id, req.body.status), "Staff deactivated"));
  }),
);
