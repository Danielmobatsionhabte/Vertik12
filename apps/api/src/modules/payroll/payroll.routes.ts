import { Router } from "express";
import { createPayrollRunSchema, emailPayrollReportSchema, emailPayslipSchema, payrollReportQuerySchema, payslipBonusSchema, updatePayslipSchema, upsertSalaryStructureSchema } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { parsedQuery, validateBody, validateQuery } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
import { ApiError } from "../../lib/errors";
import { sendMail } from "../../lib/mailer";
import { ok } from "../../lib/pagination";
import * as payroll from "./payroll.service";

export const payrollRouter = Router();
payrollRouter.use(authenticate);

// Salary structures -----------------------------------------------------
payrollRouter.get("/salaries", requireRoles("ADMIN", "ACCOUNTANT"),
  asyncHandler(async (_req, res) => {
    res.json(ok(await payroll.listSalaryStructures()));
  }));

// Every payroll MUTATION is ADMIN-only; the accountant's view is read-only.
payrollRouter.put("/salaries", requireRoles("ADMIN"), validateBody(upsertSalaryStructureSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.upsertSalaryStructure(req.body), "Salary structure saved"));
  }));

// Advanced filter + aggregate report over all payslips (drives /payroll/report).
payrollRouter.get("/report", requireRoles("ADMIN", "ACCOUNTANT"), validateQuery(payrollReportQuerySchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.payrollReport(parsedQuery(req))));
  }));

// Email the filtered payroll report (e.g. the yearly summary) to the signed-in
// admin or an explicit address.
payrollRouter.post("/report/email", requireRoles("ADMIN"), validateBody(emailPayrollReportSchema),
  asyncHandler(async (req, res) => {
    const { email, ...filters } = req.body;
    const to = email ?? req.user!.email;
    const report = await payroll.payrollReport(filters);
    if (report.totals.payslips === 0) throw ApiError.badRequest("No payslips match these filters — nothing to email");
    const period = filters.from || filters.to
      ? `${filters.from ?? "…"} to ${filters.to ?? "present"}`
      : "all time";
    const result = await sendMail({
      to,
      subject: `Payroll report — ${period}`,
      html: payroll.payrollReportEmailHtml(report, period),
    });
    res.json(ok(result, result.message));
  }));

// Payroll runs ------------------------------------------------------------
payrollRouter.get("/runs", requireRoles("ADMIN", "ACCOUNTANT"),
  asyncHandler(async (_req, res) => {
    res.json(ok(await payroll.listRuns()));
  }));

payrollRouter.get("/runs/:id", requireRoles("ADMIN", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.getRun(req.params.id)));
  }));

payrollRouter.post("/runs", requireRoles("ADMIN"), validateBody(createPayrollRunSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await payroll.createRun(req.body, req.user!.sub), "Payroll run created"));
  }));

// Admin can discard a draft run and start over (modify payroll anytime).
payrollRouter.delete("/runs/:id", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.deleteDraftRun(req.params.id), "Draft run discarded"));
  }));

payrollRouter.post("/runs/:id/approve", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.approveRun(req.params.id), "Payroll run approved"));
  }));

payrollRouter.post("/runs/:id/pay", requireRoles("ADMIN"),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.markRunPaid(req.params.id), "Payroll disbursed"));
  }));

// One-off bonus on a payslip (only while the run is a draft) --------------
payrollRouter.patch("/payslips/:id/bonus", requireRoles("ADMIN"), validateBody(payslipBonusSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.setPayslipBonus(req.params.id, req.body.bonus), "Bonus saved"));
  }));

// Admin edits a draft payslip's amounts (basic, allowances, deductions, bonus).
payrollRouter.patch("/payslips/:id", requireRoles("ADMIN"), validateBody(updatePayslipSchema),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.updatePayslip(req.params.id, req.body), "Payslip updated"));
  }));

// Payslips ----------------------------------------------------------------
payrollRouter.get("/staff/:staffId/payslips", requireRoles("ADMIN", "ACCOUNTANT", "TEACHER"),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.staffPayslips(req.params.staffId)));
  }));

// Full paystub (drives the printable view).
payrollRouter.get("/payslips/:id", requireRoles("ADMIN", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.getPayslip(req.params.id)));
  }));

// Email the paystub to the employee (or an explicit address).
payrollRouter.post("/payslips/:id/email", requireRoles("ADMIN"), validateBody(emailPayslipSchema),
  asyncHandler(async (req, res) => {
    const payslip = await payroll.getPayslip(req.params.id);
    const to = req.body.email ?? payslip.staff.user.email;
    if (!to) throw ApiError.badRequest("This employee has no email address on file — provide one");
    const period = new Date(payslip.run.year, payslip.run.month - 1, 1)
      .toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const result = await sendMail({
      to,
      subject: `Your paystub — ${period}`,
      html: payroll.payslipEmailHtml(payslip),
    });
    res.json(ok(result, result.message));
  }));
