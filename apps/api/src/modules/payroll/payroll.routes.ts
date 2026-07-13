import { Router } from "express";
import { createPayrollRunSchema, payslipBonusSchema, upsertSalaryStructureSchema } from "@vertik12/shared";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error-handler";
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

// Payslips ----------------------------------------------------------------
payrollRouter.get("/staff/:staffId/payslips", requireRoles("ADMIN", "ACCOUNTANT", "TEACHER"),
  asyncHandler(async (req, res) => {
    res.json(ok(await payroll.staffPayslips(req.params.staffId)));
  }));
