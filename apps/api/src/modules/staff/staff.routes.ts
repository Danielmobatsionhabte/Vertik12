import { Router } from "express";
import { z } from "zod";
import {
  createStaffSchema, updateStaffSchema, paginationSchema, staffDocumentSchema,
  updateStaffDocumentSchema, STAFF_TYPES, STAFF_STATUSES,
} from "@vertik12/shared";
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

// Registration accepts the day-one paperwork alongside the profile, so ID
// and right-to-work checks are filed with the record rather than chased later.
staffRouter.post(
  "/",
  requireRoles("ADMIN"),
  validateBody(createStaffSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await staff.createStaff(req.body, req.user!.sub), "Staff member created"));
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

// ---------------------------------------------------------------------------
// HR documents (identification, background check, work authorization…)
//
// ADMIN-only throughout — deliberately stricter than student documents.
// A background-check result or a passport scan is not the accountant's or a
// teacher's business, so these routes do not extend read access the way
// /students/:id/documents does.
// ---------------------------------------------------------------------------

// Compliance chase-list across all staff: what has lapsed or is about to.
// Two segments, so the single-segment "/:id" route above can never swallow it.
staffRouter.get(
  "/documents/expiring",
  requireRoles("ADMIN"),
  validateQuery(z.object({ withinDays: z.coerce.number().int().min(1).max(365).optional() })),
  asyncHandler(async (req, res) => {
    const { withinDays } = parsedQuery<{ withinDays?: number }>(req);
    res.json(ok(await staff.expiringStaffDocuments(withinDays)));
  }),
);

staffRouter.get(
  "/:id/documents",
  requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.listStaffDocuments(req.params.id)));
  }),
);

staffRouter.post(
  "/:id/documents",
  requireRoles("ADMIN"),
  validateBody(staffDocumentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await staff.addStaffDocument(req.params.id, req.body, req.user!.sub), "Document filed"));
  }),
);

staffRouter.get(
  "/:id/documents/:docId",
  requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    const doc = await staff.getStaffDocument(req.params.id, req.params.docId);
    res.setHeader("Content-Type", doc.type);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`);
    res.send(doc.buffer);
  }),
);

staffRouter.patch(
  "/:id/documents/:docId",
  requireRoles("ADMIN"),
  validateBody(updateStaffDocumentSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await staff.updateStaffDocument(req.params.id, req.params.docId, req.body), "Document updated"));
  }),
);

staffRouter.delete(
  "/:id/documents/:docId",
  requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    const removed = await staff.removeStaffDocument(req.params.id, req.params.docId);
    res.json(ok(removed, `"${removed.label}" removed from the file`));
  }),
);
