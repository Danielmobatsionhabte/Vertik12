import { Router } from "express";
import { z } from "zod";
import {
  createAcademicYearSchema, createTermSchema, createClassRoomSchema,
  createSubjectSchema, assignSubjectSchema, timetableSlotSchema,
} from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as academics from "./academics.service";

export const academicsRouter = Router();
academicsRouter.use(authenticate);

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
academicsRouter.post("/timetable", requireRoles("ADMIN", "REGISTRAR"), validateBody(timetableSlotSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await academics.addTimetableSlot(req.body)));
  }));

academicsRouter.delete("/timetable/:id", requireRoles("ADMIN", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await academics.removeTimetableSlot(req.params.id)));
  }));
