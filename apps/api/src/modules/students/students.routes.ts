import { Router } from "express";
import { z } from "zod";
import {
  createStudentSchema, updateStudentSchema, paginationSchema, bulkEnrollSchema,
  guardianPortalAccountSchema, studentPhotoSchema, studentDocumentSchema, gradeCode, STUDENT_STATUSES,
} from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as students from "./students.service";

export const studentsRouter = Router();
studentsRouter.use(authenticate);

const listQuery = paginationSchema.extend({
  gradeLevel: gradeCode.optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  classRoomId: z.string().optional(), // filter by section/class
  academicYearId: z.string().optional(), // filter by enrollment year (past years too)
  sort: z.enum(["recent", "name", "grade"]).optional(), // default: recently registered
});

// NOTE: registered before "/:id" so the path isn't swallowed by the param route.
studentsRouter.get(
  "/unassigned",
  requireRoles("ADMIN", "REGISTRAR"),
  validateQuery(z.object({ academicYearId: z.string().min(1), gradeLevel: gradeCode.optional() })),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<{ academicYearId: string; gradeLevel?: string }>(req);
    res.json(ok(await students.unassignedStudents(q.academicYearId, q.gradeLevel)));
  }),
);

// Per-year student report (any year, incl. previous ones) for Admin/Registrar.
studentsRouter.get(
  "/report",
  requireRoles("ADMIN", "REGISTRAR"),
  validateQuery(z.object({
    academicYearId: z.string().min(1),
    gradeLevel: gradeCode.optional(),
    status: z.enum(STUDENT_STATUSES).optional(),
  })),
  asyncHandler(async (req, res) => {
    const { academicYearId, ...filters } = parsedQuery<{ academicYearId: string; gradeLevel?: string; status?: string }>(req);
    res.json(ok(await students.studentsYearReport(academicYearId, filters)));
  }),
);

// Assign existing students to a class of an academic year (rollover).
studentsRouter.post(
  "/enroll",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(bulkEnrollSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.bulkEnroll(req.body), "Students enrolled"));
  }),
);

// Teachers get read-only access to student records (per the permission
// matrix); the Registrar owns records management alongside Admin.
studentsRouter.get(
  "/",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"),
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.listStudents(parsedQuery(req))));
  }),
);

studentsRouter.get(
  "/:id",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    // Teachers see no finance data; accountants see no exam results.
    // Billing defaults to the active academic year; ?academicYearId=… shows
    // another year's invoices.
    const academicYearId = typeof req.query.academicYearId === "string" && req.query.academicYearId
      ? req.query.academicYearId
      : undefined;
    res.json(ok(await students.getStudent(req.params.id, req.user!.role, academicYearId)));
  }),
);

studentsRouter.post(
  "/",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(createStudentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await students.createStudent(req.body), "Student admitted"));
  }),
);

studentsRouter.patch(
  "/:id",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(updateStudentSchema.extend({ classRoomId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.updateStudent(req.params.id, req.body), "Student updated"));
  }),
);

studentsRouter.delete(
  "/:id",
  requireRoles("ADMIN", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.withdrawStudent(req.params.id), "Student withdrawn"));
  }),
);

// Student photo (optional; Admin/Registrar upload or capture, replace, remove).
studentsRouter.put(
  "/:id/photo",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(studentPhotoSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.setStudentPhoto(req.params.id, req.body), "Photo saved"));
  }),
);

studentsRouter.delete(
  "/:id/photo",
  requireRoles("ADMIN", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.removeStudentPhoto(req.params.id), "Photo removed"));
  }),
);

// Staff see any student's photo; parents/students only their own (checked
// in the service). Served inline so <img> previews render directly.
studentsRouter.get(
  "/:id/photo",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT", "PARENT", "STUDENT"),
  asyncHandler(async (req, res) => {
    const photo = await students.getStudentPhoto(req.params.id, { userId: req.user!.sub, role: req.user!.role });
    res.setHeader("Content-Type", photo.type);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(photo.buffer);
  }),
);

// Documents on file (guardian ID, certificates…) — webcam shots or uploads.
studentsRouter.post(
  "/:id/documents",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(studentDocumentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await students.addStudentDocument(req.params.id, req.body, req.user!.sub), "Document saved"));
  }),
);

studentsRouter.get(
  "/:id/documents",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.listStudentDocuments(req.params.id)));
  }),
);

studentsRouter.get(
  "/:id/documents/:docId",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    const doc = await students.getStudentDocument(req.params.id, req.params.docId);
    res.setHeader("Content-Type", doc.type);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.name.replace(/[^\w.\- ]+/g, "_")}"`);
    res.send(doc.buffer);
  }),
);

studentsRouter.delete(
  "/:id/documents/:docId",
  requireRoles("ADMIN", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.removeStudentDocument(req.params.id, req.params.docId), "Document removed"));
  }),
);

// Guardian management (Admin/Registrar): add another guardian, edit info.
const guardianBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  relation: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional().or(z.literal("")),
  occupation: z.string().optional(),
  isPrimary: z.boolean().default(false),
});

studentsRouter.post(
  "/:id/guardians",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(guardianBody),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await students.addGuardian(req.params.id, req.body), "Guardian added"));
  }),
);

studentsRouter.patch(
  "/:id/guardians/:guardianId",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(guardianBody.partial()),
  asyncHandler(async (req, res) => {
    res.json(ok(await students.updateGuardian(req.params.id, req.params.guardianId, req.body), "Guardian updated"));
  }),
);

// Register the parent/guardian's web-portal login from the student page.
studentsRouter.post(
  "/:id/guardians/:guardianId/portal-account",
  requireRoles("ADMIN", "REGISTRAR"),
  validateBody(guardianPortalAccountSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(
      await students.createGuardianPortalAccount(req.params.id, req.params.guardianId, req.body.email),
      "Parent portal account created",
    ));
  }),
);
