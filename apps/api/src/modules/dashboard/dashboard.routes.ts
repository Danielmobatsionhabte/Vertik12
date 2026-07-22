import { Router } from "express";
import type { DashboardStats } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { authenticate, requireRoles } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/error-handler";
import { ok } from "../../lib/pagination";

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

/**
 * The school's letterhead — name, motto, contact details — for anything a
 * user prints (timetables, registers). Readable by every signed-in role:
 * the same fields already appear on receipts and report cards that parents
 * hold in their hands, and none of them are configuration secrets. Editing
 * still lives behind Administration › School settings (SUPER_ADMIN).
 */
dashboardRouter.get("/school", asyncHandler(async (_req, res) => {
  const settings = await prisma.schoolSettings.findUnique({
    where: { id: "school" },
    select: { schoolName: true, motto: true, logoUrl: true, address: true, phone: true, email: true },
  });
  res.json(ok(settings ?? { schoolName: "Vertik12", motto: null, logoUrl: null, address: null, phone: null, email: null }));
}));

/** Aggregated stats for the admin home screen — one round trip for the whole page. */
dashboardRouter.get("/stats", requireRoles("ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"),
  asyncHandler(async (req, res) => {
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

    // Unsettled invoices: their items minus their successful payments =
    // the school's outstanding balance. Aggregated in SQL — loading every
    // open invoice with relations does not scale past a few thousand rows.
    const unsettled: Prisma.InvoiceWhereInput = { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } };

    const [
      studentTotal, byGrade, staffTotal, teachingTotal,
      todayTotal, todayPresent,
      monthInvoices, monthPayments,
      unsettledItems, unsettledPaid, overdueInvoices,
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
      prisma.invoiceItem.aggregate({ _sum: { amount: true }, where: { invoice: unsettled } }),
      prisma.payment.aggregate({ _sum: { amount: true }, where: { status: "SUCCEEDED", invoice: unsettled } }),
      prisma.invoice.count({
        where: {
          OR: [
            { status: "OVERDUE" },
            { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today } },
          ],
        },
      }),
      prisma.payrollRun.findFirst({ orderBy: [{ year: "desc" }, { month: "desc" }], include: { payslips: { select: { net: true } } } }),
      prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, audience: true, createdAt: true } }),
    ]);

    // Grade levels sort naturally as K,1,2,...  — order them for the chart.
    const gradeOrder = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
    const outstanding = (unsettledItems._sum.amount ?? 0) - (unsettledPaid._sum.amount ?? 0);

    // Teachers see no finance/payroll figures — those blocks are zeroed
    // here and hidden by the web dashboard.
    const financeVisible = req.user!.role !== "TEACHER";

    // Visitor counters are for the administration only.
    const isAdmin = req.user!.role === "ADMIN" || req.user!.role === "SUPER_ADMIN";
    let visitors: DashboardStats["visitors"] = null;
    if (isAdmin) {
      const twoWeeksAgo = new Date(today);
      twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 13);
      const weekAgo = new Date(today);
      weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
      const [visitsToday, visitors7, byDay] = await Promise.all([
        prisma.dailyVisit.count({ where: { date: today } }),
        prisma.dailyVisit.groupBy({ by: ["userId"], where: { date: { gte: weekAgo } } }),
        prisma.dailyVisit.groupBy({ by: ["date"], where: { date: { gte: twoWeeksAgo } }, _count: true }),
      ]);
      const trend: Array<{ date: string; count: number }> = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(twoWeeksAgo);
        d.setUTCDate(d.getUTCDate() + i);
        const hit = byDay.find((b) => b.date.getTime() === d.getTime());
        trend.push({ date: d.toISOString().slice(0, 10), count: hit?._count ?? 0 });
      }
      visitors = { today: visitsToday, last7Days: visitors7.length, trend };
    }

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
            overdueInvoices,
          }
        : { invoicedThisMonth: 0, collectedThisMonth: 0, outstanding: 0, overdueInvoices: 0 },
      payroll: financeVisible
        ? {
            lastRunLabel: lastRun ? `${lastRun.year}-${String(lastRun.month).padStart(2, "0")} (${lastRun.status})` : null,
            lastRunNet: lastRun?.payslips.reduce((s, p) => s + p.net, 0) ?? 0,
          }
        : { lastRunLabel: null, lastRunNet: 0 },
      visitors,
      recentAnnouncements: announcements.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    };
    res.json(ok(stats));
  }));
