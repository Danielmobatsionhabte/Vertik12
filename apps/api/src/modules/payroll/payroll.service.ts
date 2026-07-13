import type { CreatePayrollRunInput, UpsertSalaryStructureInput } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";

type Component = { name: string; amount: number };
const sum = (components: Component[]) => components.reduce((s, c) => s + c.amount, 0);
const parseComponents = (json: string): Component[] => JSON.parse(json) as Component[];

// ========================= salary structures =========================

export const upsertSalaryStructure = async (input: UpsertSalaryStructureInput) => {
  const staff = await prisma.staff.findUnique({ where: { id: input.staffId } });
  if (!staff) throw ApiError.notFound("Staff member");
  const data = {
    basicSalary: input.basicSalary,
    payFrequency: input.payFrequency,
    currency: input.currency,
    allowances: JSON.stringify(input.allowances),
    deductions: JSON.stringify(input.deductions),
    ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
  };
  return prisma.salaryStructure.upsert({
    where: { staffId: input.staffId },
    create: { staffId: input.staffId, ...data },
    update: data,
  });
};

export const listSalaryStructures = () =>
  prisma.salaryStructure.findMany({
    include: { staff: { include: { user: { select: { firstName: true, lastName: true } } } } },
    orderBy: { staff: { staffNo: "asc" } },
  });

// ============================ payroll runs ============================

/**
 * Creates a DRAFT run for a month and generates one payslip per active
 * staff member with a salary structure. Each payslip snapshots the salary
 * components at run time, so later salary changes never rewrite history.
 */
export async function createRun(input: CreatePayrollRunInput, createdBy: string) {
  const existing = await prisma.payrollRun.findUnique({ where: { month_year: { month: input.month, year: input.year } } });
  if (existing) throw ApiError.conflict(`A payroll run for ${input.month}/${input.year} already exists`);

  const structures = await prisma.salaryStructure.findMany({
    where: { staff: { status: "ACTIVE" } },
    include: { staff: true },
  });
  if (structures.length === 0) {
    throw ApiError.badRequest("No active staff have salary structures. Set salaries first.");
  }

  return prisma.payrollRun.create({
    data: {
      month: input.month,
      year: input.year,
      notes: input.notes,
      createdBy,
      payslips: {
        create: structures.map((s) => {
          const allowances = parseComponents(s.allowances);
          const deductions = parseComponents(s.deductions);
          const gross = s.basicSalary + sum(allowances);
          const totalDeductions = sum(deductions);
          return {
            staffId: s.staffId,
            basicSalary: s.basicSalary,
            allowances: s.allowances,
            deductions: s.deductions,
            gross,
            totalDeductions,
            net: gross - totalDeductions,
            currency: s.currency,
          };
        }),
      },
    },
    include: { payslips: true },
  });
}

export const listRuns = () =>
  prisma.payrollRun.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { _count: { select: { payslips: true } }, payslips: { select: { net: true, currency: true } } },
  });

export async function getRun(id: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      payslips: {
        include: { staff: { include: { user: { select: { firstName: true, lastName: true } } } } },
        orderBy: { staff: { staffNo: "asc" } },
      },
    },
  });
  if (!run) throw ApiError.notFound("Payroll run");
  return {
    ...run,
    payslips: run.payslips.map((p) => ({
      ...p,
      allowances: parseComponents(p.allowances),
      deductions: parseComponents(p.deductions),
    })),
    totals: {
      gross: run.payslips.reduce((s, p) => s + p.gross, 0),
      deductions: run.payslips.reduce((s, p) => s + p.totalDeductions, 0),
      net: run.payslips.reduce((s, p) => s + p.net, 0),
    },
  };
}

/** Admin discards a DRAFT run (payslips go with it) to redo the month. */
export async function deleteDraftRun(id: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) throw ApiError.notFound("Payroll run");
  if (run.status !== "DRAFT") throw ApiError.badRequest("Only draft runs can be discarded");
  return prisma.payrollRun.delete({ where: { id } });
}

/** DRAFT → APPROVED. Approval locks the run for disbursement. */
export async function approveRun(id: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) throw ApiError.notFound("Payroll run");
  if (run.status !== "DRAFT") throw ApiError.badRequest(`Run is already ${run.status}`);
  return prisma.payrollRun.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } });
}

/** APPROVED → PAID. Marks every payslip disbursed. */
export async function markRunPaid(id: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) throw ApiError.notFound("Payroll run");
  if (run.status !== "APPROVED") throw ApiError.badRequest("Run must be approved before it can be paid");
  const now = new Date();
  await prisma.$transaction([
    prisma.payslip.updateMany({ where: { runId: id, status: "PENDING" }, data: { status: "PAID", paidAt: now } }),
    prisma.payrollRun.update({ where: { id }, data: { status: "PAID", paidAt: now } }),
  ]);
  return getRun(id);
}

/**
 * Admin adds a one-off bonus to a payslip while the run is still a DRAFT.
 * Gross and net are recomputed so the totals always add up.
 */
export async function setPayslipBonus(payslipId: string, bonus: number) {
  const payslip = await prisma.payslip.findUnique({ where: { id: payslipId }, include: { run: true } });
  if (!payslip) throw ApiError.notFound("Payslip");
  if (payslip.run.status !== "DRAFT") {
    throw ApiError.badRequest("Bonuses can only be changed while the payroll run is a draft");
  }
  const allowanceTotal = sum(parseComponents(payslip.allowances));
  const gross = payslip.basicSalary + allowanceTotal + bonus;
  return prisma.payslip.update({
    where: { id: payslipId },
    data: { bonus, gross, net: gross - payslip.totalDeductions },
  });
}

/** A staff member's own payslip history (also used on the staff profile). */
export const staffPayslips = (staffId: string) =>
  prisma.payslip.findMany({
    where: { staffId },
    include: { run: { select: { month: true, year: true, status: true } } },
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
  });
