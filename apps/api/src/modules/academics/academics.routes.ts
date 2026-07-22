import { Router } from "express";
import { z } from "zod";
import {
  createAcademicYearSchema, createTermSchema, createClassRoomSchema,
  createSubjectSchema, assignSubjectSchema, timetableSlotSchema, gradeDefSchema,
} from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as academics from "./academics.service";

export const academicsRouter = Router();
academicsRouter.use(authenticate);

// Grade levels -----------------------------------------------------------
// Every portal reads the ladder (dropdowns everywhere); only the
// administration shapes it — grade naming varies by country.
academicsRouter.get("/grades", asyncHandler(async (_req, res) => {
  res.json(ok(await academics.listGrades()));
}));

academicsRouter.post("/grades", requireRoles("ADMIN"), validateBody(gradeDefSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.createGrade(req.body), "Grade level added"));
  }));

academicsRouter.patch("/grades/:id", requireRoles("ADMIN"),
  validateBody(gradeDefSchema.pick({ name: true, sortOrder: true }).partial()),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.updateGrade(req.params.id, req.body), "Grade level updated"));
  }));

academicsRouter.delete("/grades/:id", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.deleteGrade(req.params.id), "Grade level removed"));
  }));

// Academic years -------------------------------------------------------
academicsRouter.get("/years", asyncHandler(async (_req, res) => {
  res.json(ok(await academics.listAcademicYears()));
}));

academicsRouter.post("/years", requireRoles("ADMIN"), validateBody(createAcademicYearSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.createAcademicYear(req.body)));
  }));

academicsRouter.post("/years/:id/activate", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.activateAcademicYear(req.params.id), "Academic year activated"));
  }));

// Remove an empty year (no classes/enrollments/fees/exams; never the active one).
academicsRouter.delete("/years/:id", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.deleteAcademicYear(req.params.id), "Academic year removed"));
  }));

academicsRouter.post("/terms", requireRoles("ADMIN"), validateBody(createTermSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.createTerm(req.body)));
  }));

// Class rooms ----------------------------------------------------------
academicsRouter.get("/classes", asyncHandler(async (req, res) => {
  res.json(ok(await academics.listClassRooms(req.query.academicYearId as string | undefined)));
}));

academicsRouter.get("/classes/:id", asyncHandler(async (req, res) => {
  res.json(ok(await academics.getClassRoom(req.params.id)));
}));

// Registrar: scheduling support (classes, sections, timetables).
academicsRouter.post("/classes", requireRoles("ADMIN", "REGISTRAR"), validateBody(createClassRoomSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.createClassRoom(req.body)));
  }));

// New-year rollover: copy every class (structure + subject/teacher
// assignments) from one academic year into another; duplicates by name are
// skipped. Same roles as class creation.
academicsRouter.post("/classes/copy", requireRoles("ADMIN", "REGISTRAR"),
  validateBody(z.object({
    fromAcademicYearId: z.string().min(1),
    toAcademicYearId: z.string().min(1),
  })),
  asyncHandler(async (req, res) => {
    const result = await academics.copyClassRooms(req.body.fromAcademicYearId, req.body.toAcademicYearId);
    res.status(201).json(ok(result, `Copied ${result.copied} class(es) from ${result.from} to ${result.to}`));
  }));

// Rename/restructure = SUPER_ADMIN; homeroom teacher = ADMIN/REGISTRAR too.
const updateClassBody = z.object({
  name: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  branch: z.string().optional().or(z.literal("")),
  capacity: z.coerce.number().int().positive().optional(),
  homeroomTeacherId: z.string().nullable().optional(),
});

academicsRouter.patch("/classes/:id", requireRoles("ADMIN", "REGISTRAR"), validateBody(updateClassBody),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.updateClassRoom(req.params.id, req.body, req.user!.role), "Class updated"));
  }));

academicsRouter.delete("/classes/:id", requireRoles(),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.deleteClassRoom(req.params.id), "Class removed"));
  }));

// Subjects -------------------------------------------------------------
academicsRouter.get("/subjects", asyncHandler(async (req, res) => {
  res.json(ok(await academics.listSubjects(req.query.gradeLevel as string | undefined)));
}));

// Creating the subject catalogue (per grade) is a SUPER_ADMIN privilege.
academicsRouter.post("/subjects", requireRoles(), validateBody(createSubjectSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.createSubject(req.body)));
  }));

// The signed-in teacher's class × subject assignments (drives the gradebook).
academicsRouter.get("/my-subjects", requireRoles("ADMIN", "REGISTRAR", "TEACHER"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.teachingAssignments(req.user!.sub, req.user!.role)));
  }));

academicsRouter.post("/class-subjects", requireRoles("ADMIN"), validateBody(assignSubjectSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.assignSubject(req.body), "Subject assigned to class"));
  }));

academicsRouter.delete("/class-subjects/:id", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.removeClassSubject(req.params.id), "Subject removed from class"));
  }));

// A specific teacher's teaching load (admin's assignment screen).
academicsRouter.get("/teachers/:staffId/subjects", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.subjectsForTeacher(req.params.staffId)));
  }));

// Timetable ------------------------------------------------------------
// Kept for existing callers; the full timetabling API (week grid, teaching
// load, availability, change requests) lives under /schedule. Both paths
// share one conflict-checked service, so neither can double-book a teacher.
academicsRouter.post("/timetable", requireRoles("ADMIN", "REGISTRAR"), validateBody(timetableSlotSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.addTimetableSlot(req.body, req.user!.sub)));
  }));

academicsRouter.delete("/timetable/:id", requireRoles("ADMIN", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.removeTimetableSlot(req.params.id)));
  }));
