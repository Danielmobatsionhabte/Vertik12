import { Router } from "express";
import { z } from "zod";
import { createExamSchema, updateExamSchema, examTypeSchema, recordResultsSchema, reviewSubmissionSchema, submitResultsSchema } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody, validateQuery, parsedQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";
import * as exams from "./exams.service";

export const examsRouter = Router();
examsRouter.use(authenticate);

const actor = (req: { user?: { sub: string; role: string } }) => ({ userId: req.user!.sub, role: req.user!.role });

examsRouter.get("/", asyncHandler(async (_req, res) => {
  res.json(ok(await exams.listExams()));
}));

// Admin-managed exam types (Term Exam, Final Exam, …). Registered before
// the param routes below so "/types" isn't captured by "/:id".
examsRouter.get("/types", asyncHandler(async (_req, res) => {
  res.json(ok(await exams.listExamTypes()));
}));

examsRouter.post("/types", requireRoles("ADMIN"), validateBody(examTypeSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await exams.createExamType(req.body.name)));
  }));

examsRouter.delete("/types/:id", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await exams.deleteExamType(req.params.id), "Exam type removed"));
  }));

// Teachers create their own assessments (assignments, weekly tests, …);
// admins create school-wide exams.
examsRouter.post("/", requireRoles("ADMIN", "TEACHER"), validateBody(createExamSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await exams.createExam(req.body, req.user!.sub)));
  }));

// Teachers can reschedule/edit or cancel their own assessments; admins any.
examsRouter.patch("/:id", requireRoles("ADMIN", "TEACHER"), validateBody(updateExamSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await exams.updateExam(req.params.id, req.body, actor(req)), "Assessment updated"));
  }));

examsRouter.delete("/:id", requireRoles("ADMIN", "TEACHER"),
  asyncHandler(async (req, res) => {
    res.json(ok(await exams.deleteExam(req.params.id, actor(req)), "Assessment cancelled"));
  }));

// Existing marks + lock state for one exam × class × subject (gradebook).
const resultsQuery = z.object({ examId: z.string().min(1), classRoomId: z.string().min(1), subjectId: z.string().min(1) });
examsRouter.get("/results", requireRoles("ADMIN", "REGISTRAR", "TEACHER"), validateQuery(resultsQuery),
  asyncHandler(async (req, res) => {
    res.json(ok(await exams.getResults(parsedQuery(req), actor(req))));
  }));

examsRouter.post("/results", requireRoles("ADMIN", "TEACHER"), validateBody(recordResultsSchema),
  asyncHandler(async (req, res) => {
    // Teachers are further restricted to their own class × subject assignments,
    // and to results not yet submitted/approved.
    res.json(ok(await exams.recordResults(req.body, actor(req)), "Results recorded"));
  }));

// Teacher → Registrar sign-off workflow ---------------------------------
examsRouter.post("/submissions", requireRoles("TEACHER", "ADMIN"), validateBody(submitResultsSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await exams.submitResults(req.body, actor(req)), "Results sent to the registrar"));
  }));

examsRouter.get("/submissions", requireRoles("ADMIN", "REGISTRAR", "TEACHER"),
  asyncHandler(async (req, res) => {
    res.json(ok(await exams.listSubmissions(actor(req))));
  }));

examsRouter.post("/submissions/:id/review", requireRoles("ADMIN", "REGISTRAR"), validateBody(reviewSubmissionSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(
      await exams.reviewSubmission(req.params.id, req.body.action, req.body.note, req.user!.sub),
      req.body.action === "APPROVE" ? "Results approved and locked" : "Results rejected — the teacher can edit again",
    ));
  }));

// Registrar: transcripts & report cards (records custodian).
examsRouter.get("/report-card/:studentId/:termId", requireRoles("ADMIN", "REGISTRAR", "TEACHER"),
  asyncHandler(async (req, res) => {
    res.json(ok(await exams.reportCard(req.params.studentId, req.params.termId)));
  }));

// Sign-off before the card is printed/released to the family.
examsRouter.post("/report-card/:studentId/:termId/approve", requireRoles("ADMIN", "REGISTRAR"),
  asyncHandler(async (req, res) => {
    res.json(ok(await exams.approveReportCard(req.params.studentId, req.params.termId, req.user!.sub), "Report card approved"));
  }));
