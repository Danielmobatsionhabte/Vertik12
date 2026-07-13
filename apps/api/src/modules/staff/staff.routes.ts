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
});

staffRouter.get(
  "/",
  requireRoles("ADMIN", "ACCOUNTANT"),
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.listStaff(parsedQuery(req))));
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
