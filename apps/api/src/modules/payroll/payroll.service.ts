import type { CreatePayrollRunInput, PayrollReportQuery, UpdatePayslipInput, UpsertSalaryStructureInput } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { emailLayout, esc } from "../../lib/email-templates";

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

/**
 * Admin edits a payslip's amounts while the run is still a DRAFT. Omitted
 * fields keep their snapshot values; component lists are replaced wholesale
 * and gross/net recompute so the payslip stays internally consistent.
 */
export async function updatePayslip(payslipId: string, input: UpdatePayslipInput) {
  const payslip = await prisma.payslip.findUnique({ where: { id: payslipId }, include: { run: true } });
  if (!payslip) throw ApiError.notFound("Payslip");
  if (payslip.run.status !== "DRAFT") {
    throw ApiError.badRequest("Payslips can only be edited while the payroll run is a draft");
  }
  const basicSalary = input.basicSalary ?? payslip.basicSalary;
  const bonus = input.bonus ?? payslip.bonus;
  const allowances = input.allowances ?? parseComponents(payslip.allowances);
  const deductions = input.deductions ?? parseComponents(payslip.deductions);
  const gross = basicSalary + sum(allowances) + bonus;
  const totalDeductions = sum(deductions);
  return prisma.payslip.update({
    where: { id: payslipId },
    data: {
      basicSalary,
      bonus,
      allowances: JSON.stringify(allowances),
      deductions: JSON.stringify(deductions),
      gross,
      totalDeductions,
      net: gross - totalDeductions,
    },
  });
}

// ============================ report =============================

/**
 * Advanced payslip search + aggregate report (drives /payroll/report).
 * Status, staff and amount filters push into the query; the inclusive
 * YYYY-MM period bounds are applied after the fetch because a (year, month)
 * tuple can't be range-compared in a single Prisma filter.
 */
export async function payrollReport(f: PayrollReportQuery) {
  const slips = await prisma.payslip.findMany({
    where: {
      ...(f.runStatus ? { run: { status: f.runStatus } } : {}),
      ...(f.payslipStatus ? { status: f.payslipStatus } : {}),
      ...(f.minNet !== undefined || f.maxNet !== undefined
        ? { net: { ...(f.minNet !== undefined ? { gte: f.minNet } : {}), ...(f.maxNet !== undefined ? { lte: f.maxNet } : {}) } }
        : {}),
      staff: {
        ...(f.staffType ? { staffType: f.staffType } : {}),
        ...(f.department ? { department: { contains: f.department } } : {}),
        ...(f.search
          ? {
              OR: [
                { staffNo: { contains: f.search } },
                { designation: { contains: f.search } },
                { user: { firstName: { contains: f.search } } },
                { user: { lastName: { contains: f.search } } },
              ],
            }
          : {}),
      },
    },
    include: {
      run: { select: { id: true, month: true, year: true, status: true } },
      staff: {
        select: {
          staffNo: true,
          designation: true,
          department: true,
          staffType: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }, { staff: { staffNo: "asc" } }],
  });

  const bound = (ym?: string) => (ym ? Number(ym.slice(0, 4)) * 100 + Number(ym.slice(5, 7)) : null);
  const fromKey = bound(f.from);
  const toKey = bound(f.to);
  const rows = slips
    .filter((p) => {
      const k = p.run.year * 100 + p.run.month;
      return (fromKey === null || k >= fromKey) && (toKey === null || k <= toKey);
    })
    .map((p) => ({ ...p, allowances: parseComponents(p.allowances), deductions: parseComponents(p.deductions) }));

  const groupBy = <K extends string | number>(keyOf: (r: (typeof rows)[number]) => K) => {
    const acc = new Map<K, { payslips: number; gross: number; deductions: number; net: number }>();
    for (const r of rows) {
      const g = acc.get(keyOf(r)) ?? { payslips: 0, gross: 0, deductions: 0, net: 0 };
      g.payslips += 1;
      g.gross += r.gross;
      g.deductions += r.totalDeductions;
      g.net += r.net;
      acc.set(keyOf(r), g);
    }
    return acc;
  };

  return {
    rows,
    totals: {
      payslips: rows.length,
      staff: new Set(rows.map((r) => r.staffId)).size,
      gross: rows.reduce((s, r) => s + r.gross, 0),
      bonus: rows.reduce((s, r) => s + r.bonus, 0),
      deductions: rows.reduce((s, r) => s + r.totalDeductions, 0),
      net: rows.reduce((s, r) => s + r.net, 0),
    },
    byMonth: [...groupBy((r) => r.run.year * 100 + r.run.month).entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([k, v]) => ({ year: Math.floor(k / 100), month: k % 100, ...v })),
    byDepartment: [...groupBy((r) => r.staff.department ?? "Unassigned").entries()]
      .sort((a, b) => b[1].net - a[1].net)
      .map(([department, v]) => ({ department, ...v })),
  };
}

/**
 * HTML for the emailed payroll report (Payroll › Report › Email report):
 * grand totals plus the per-month and per-department summaries. `period` is
 * a human label like "2026" or "2026-01 to 2026-06".
 */
export function payrollReportEmailHtml(report: Awaited<ReturnType<typeof payrollReport>>, period: string): string {
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const th = (label: string, right = false) =>
    `<th style="padding:6px 10px;font-size:11px;text-transform:uppercase;color:#64748b;text-align:${right ? "right" : "left"};border-bottom:1px solid #e2e8f0">${esc(label)}</th>`;
  const td = (v: string, right = false, strong = false) =>
    `<td style="padding:6px 10px;font-size:13px;color:#0f172a;text-align:${right ? "right" : "left"};${strong ? "font-weight:600;" : ""}border-bottom:1px solid #f1f5f9">${v}</td>`;
  const monthName = (y: number, m: number) =>
    new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const summaryTable = (
    header: string,
    rows: Array<{ label: string; payslips: number; gross: number; net: number }>,
  ) => `
    <h2 style="margin:20px 0 8px;font-size:14px;color:#0f172a">${esc(header)}</h2>
    <table style="border-collapse:collapse;width:100%">
      <tr>${th("")}${th("Payslips", true)}${th("Gross", true)}${th("Net", true)}</tr>
      ${rows
        .map((r) => `<tr>${td(esc(r.label))}${td(String(r.payslips), true)}${td(money(r.gross), true)}${td(money(r.net), true, true)}</tr>`)
        .join("")}
    </table>`;

  return emailLayout(
    `Payroll report — ${period}`,
    `<p style="font-size:14px;color:#334155">
       ${report.totals.payslips} payslip(s) across ${report.totals.staff} employee(s).
       Gross <strong>${money(report.totals.gross)}</strong>,
       deductions <strong>${money(report.totals.deductions)}</strong>,
       net payout <strong>${money(report.totals.net)}</strong>.
     </p>
     ${summaryTable("By month", report.byMonth.map((m) => ({ label: monthName(m.year, m.month), ...m })))}
     ${summaryTable("By department", report.byDepartment.map((d) => ({ label: d.department, ...d })))}
     <p style="font-size:12px;color:#94a3b8;margin-top:20px">Open Payroll › Report in the web app for the full payslip-by-payslip breakdown and CSV export.</p>`,
  );
}

/** A staff member's own payslip history (also used on the staff profile). */
export const staffPayslips = (staffId: string) =>
  prisma.payslip.findMany({
    where: { staffId },
    include: { run: { select: { month: true, year: true, status: true } } },
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
  });

/**
 * One payslip in full — drives the printable paystub and the emailed copy.
 * Includes the employee, the run period and the school letterhead details.
 */
export async function getPayslip(id: string) {
  const payslip = await prisma.payslip.findUnique({
    where: { id },
    include: {
      run: { select: { month: true, year: true, status: true, paidAt: true } },
      staff: {
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      },
    },
  });
  if (!payslip) throw ApiError.notFound("Payslip");
  const settings = await prisma.schoolSettings.findUnique({ where: { id: "school" } });
  return {
    ...payslip,
    allowances: parseComponents(payslip.allowances),
    deductions: parseComponents(payslip.deductions),
    school: settings
      ? { name: settings.schoolName, address: settings.address, phone: settings.phone, email: settings.email, motto: settings.motto }
      : null,
  };
}

/** Simple, print-friendly HTML paystub used for the emailed copy. */
export function payslipEmailHtml(p: Awaited<ReturnType<typeof getPayslip>>): string {
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency }).format(cents / 100);
  const period = new Date(p.run.year, p.run.month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const componentRows = (label: string, list: Component[], sign: string) =>
    list.map((c) => `<tr><td style="padding:4px 8px;color:#475569">${esc(c.name)} (${label})</td><td style="padding:4px 8px;text-align:right">${sign}${money(c.amount)}</td></tr>`).join("");
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
    <div style="background:#0f172a;color:#fff;padding:20px 24px">
      <h2 style="margin:0">${esc(p.school?.name ?? "School")} — Paystub</h2>
      <p style="margin:4px 0 0;color:#cbd5e1">${period}</p>
    </div>
    <div style="padding:20px 24px">
      <p style="margin:0 0 12px"><strong>${esc(p.staff.user.firstName)} ${esc(p.staff.user.lastName)}</strong><br/>
      ${esc(p.staff.staffNo)} · ${esc(p.staff.designation)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 8px;color:#475569">Basic salary</td><td style="padding:4px 8px;text-align:right">${money(p.basicSalary)}</td></tr>
        ${componentRows("allowance", p.allowances, "+")}
        ${p.bonus > 0 ? `<tr><td style="padding:4px 8px;color:#475569">Bonus</td><td style="padding:4px 8px;text-align:right">+${money(p.bonus)}</td></tr>` : ""}
        ${componentRows("deduction", p.deductions, "−")}
        <tr style="border-top:2px solid #0f172a;font-weight:bold">
          <td style="padding:8px">Net pay</td><td style="padding:8px;text-align:right">${money(p.net)}</td>
        </tr>
      </table>
      <p style="color:#94a3b8;font-size:12px;margin-top:16px">Status: ${p.status}${p.paidAt ? ` · Paid ${new Date(p.paidAt).toLocaleDateString()}` : ""}</p>
    </div>
  </div>`;
}
