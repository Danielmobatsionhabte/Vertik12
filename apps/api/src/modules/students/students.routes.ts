import { Router } from "express";
import { z } from "zod";
import {
  createStudentSchema, updateStudentSchema, paginationSchema, bulkEnrollSchema,
  guardianPortalAccountSchema, GRADE_LEVELS, STUDENT_STATUSES,
} from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as students from "./students.service";

export const studentsRouter = Router();
studentsRouter.use(authenticate);

const listQuery = paginationSchema.extend({
  gradeLevel: z.enum(GRADE_LEVELS).optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
  classRoomId: z.string().optional(), // filter by section/class
});

// NOTE: registered before "/:id" so the path isn't swallowed by the param route.
studentsRouter.get(
  "/unassigned",
  requireRoles("ADMIN", "REGISTRAR"),
  validateQuery(z.object({ academicYearId: z.string().min(1), gradeLevel: z.enum(GRADE_LEVELS).optional() })),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<{ academicYearId: string; gradeLevel?: string }>(req);
    res.json(ok(await students.unassignedStudents(q.academicYearId, q.gradeLevel)));
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
    res.json(ok(await students.getStudent(req.params.id, req.user!.role)));
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
