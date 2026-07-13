import { Router } from "express";
import type { DashboardStats } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { authenticate, requireRoles } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

/** Aggregated stats for the admin home screen — one round trip for the whole page. */
dashboardRouter.get("/stats", requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    const [
      studentTotal, byGrade, staffTotal, teachingTotal,
      todayTotal, todayPresent,
      monthInvoices, monthPayments, allInvoices,
      lastRun, announcements,
    ] = await Promise.all([
      prisma.student.count({ where: { status: "ACTIVE" } }),
      prisma.student.groupBy({ by: ["gradeLevel"], where: { status: "ACTIVE" }, _count: true }),
      prisma.staff.count({ where: { status: "ACTIVE" } }),
      prisma.staff.count({ where: { status: "ACTIVE", staffType: "TEACHING" } }),
      prisma.attendanceRecord.count({ where: { date: today } }),
      prisma.attendanceRecord.count({ where: { date: today, status: { in: ["PRESENT", "LATE"] } } }),
      prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: { invoice: { issueDate: { gte: monthStart }, status: { notIn: ["VOID", "DRAFT"] } } } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "SUCCEEDED", paidAt: { gte: monthStart } } }),
      prisma.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, include: { items: true, payments: { where: { status: "SUCCEEDED" } } } }),
      prisma.payrollRun.findFirst({ orderBy: [{ year: "desc" }, { month: "desc" }], include: { payslips: { select: { net: true } } } }),
      prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, audience: true, createdAt: true } }),
    ]);

    // Grade levels sort naturally as K,1,2,...  — order them for the chart.
    const gradeOrder = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
    const outstanding = allInvoices.reduce(
      (s, inv) => s + inv.items.reduce((a, i) => a + i.amount, 0) - inv.payments.reduce((a, p) => a + p.amount, 0),
      0,
    );

    // Teachers see no finance/payroll figures — those blocks are zeroed
    // here and hidden by the web dashboard.
    const financeVisible = req.user!.role !== "TEACHER";

    const stats: DashboardStats = {
      students: {
        total: studentTotal,
        byGrade: gradeOrder.map((g) => ({ gradeLevel: g, count: byGrade.find((b) => b.gradeLevel === g)?._count ?? 0 })),
      },
      staff: { total: staffTotal, teaching: teachingTotal },
      attendanceTodayRate: todayTotal === 0 ? null : Math.round((todayPresent / todayTotal) * 1000) / 10,
      finance: financeVisible
        ? {
            invoicedThisMonth: monthInvoices._sum.amount ?? 0,
            collectedThisMonth: monthPayments._sum.amount ?? 0,
            outstanding,
            overdueInvoices: allInvoices.filter((i) => i.status === "OVERDUE").length,
          }
        : { invoicedThisMonth: 0, collectedThisMonth: 0, outstanding: 0, overdueInvoices: 0 },
      payroll: financeVisible
        ? {
            lastRunLabel: lastRun ? `${lastRun.year}-${String(lastRun.month).padStart(2, "0")} (${lastRun.status})` : null,
            lastRunNet: lastRun?.payslips.reduce((s, p) => s + p.net, 0) ?? 0,
          }
        : { lastRunLabel: null, lastRunNet: 0 },
      recentAnnouncements: announcements.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
    res.json(ok(stats));
  }));
