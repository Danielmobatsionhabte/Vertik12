import { Router } from "express";
import { z } from "zod";
import { markAttendanceSchema } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as attendance from "./attendance.service";

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const actor = (req: { user?: { sub: string; role: string } }) => ({ userId: req.user!.sub, role: req.user!.role });

// Teachers mark per subject (their own only); admin/registrar can also mark general.
attendanceRouter.post(
  "/mark",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER"),
  validateBody(markAttendanceSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await attendance.markAttendance(req.body, actor(req)), "Attendance saved"));
  }),
);

const registerQuery = z.object({
  classRoomId: z.string().min(1),
  date: z.coerce.date(),
  subjectId: z.string().optional(),
});

attendanceRouter.get(
  "/register",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER"),
  validateQuery(registerQuery),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<z.infer<typeof registerQuery>>(req);
    res.json(ok(await attendance.classRegister(q.classRoomId, q.date, q.subjectId)));
  }),
);

const summaryQuery = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });

attendanceRouter.get(
  "/students/:studentId/summary",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"),
  validateQuery(summaryQuery),
  asyncHandler(async (req, res) => {
    const q = parsedQuery<z.infer<typeof summaryQuery>>(req);
    res.json(ok(await attendance.studentSummary(req.params.studentId, q.from, q.to)));
  }),
);

// Date-range attendance report (printable table): whole class or one student.
const reportQuery = z.object({
  classRoomId: z.string().min(1),
  studentId: z.string().optional(),
  subjectId: z.string().optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

attendanceRouter.get(
  "/report",
  requireRoles("ADMIN", "REGISTRAR", "TEACHER"),
  validateQuery(reportQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await attendance.attendanceReport(parsedQuery(req), actor(req))));
  }),
);
