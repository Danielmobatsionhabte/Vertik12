"use client";

import { useEffect, useState } from "react";
import type { DashboardStats } from "@vertik12/shared";
import { get, getSession } from "@/lib/api";
import { formatMoney, formatDate, gradeLabel } from "@/lib/format";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<DashboardStats>("/dashboard/stats").then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!stats)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  const maxGrade = Math.max(1, ...stats.students.byGrade.map((g) => g.count));
  // Teachers see no finance figures anywhere in the app.
  const financeVisible = getSession()?.user.role !== "TEACHER";

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="A live snapshot of the whole school" />

      {/* headline stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active students" value={stats.students.total} />
        <StatCard label="Staff members" value={stats.staff.total} detail={`${stats.staff.teaching} teaching`} />
        <StatCard
          label="Attendance today"
          value={stats.attendanceTodayRate === null ? "—" : `${stats.attendanceTodayRate}%`}
          detail={stats.attendanceTodayRate === null ? "No register taken yet" : "Present or late"}
        />
        {financeVisible && (
          <StatCard
            label="Outstanding fees"
            value={formatMoney(stats.finance.outstanding)}
            detail={`${stats.finance.overdueInvoices} overdue invoice(s)`}
          />
        )}
      </div>

      {/* visitors — administration only */}
      {stats.visitors && (
        <Card className="relative mt-6 overflow-hidden p-6">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand-gradient opacity-[0.08] blur-3xl" />
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <span aria-hidden>👀</span> Portal visitors
              </h2>
              <p className="mt-2 text-4xl font-bold tabular-nums text-gradient">{stats.visitors.today}</p>
              <p className="text-xs text-slate-400">unique users signed in today</p>
              <p className="mt-2 text-sm text-slate-500">
                <span className="font-semibold text-slate-700">{stats.visitors.last7Days}</span> unique visitors in the last 7 days
              </p>
            </div>
            <div className="flex items-end gap-1" aria-label="Daily visitors, last 14 days">
              {(() => {
                const max = Math.max(1, ...stats.visitors.trend.map((t) => t.count));
                return stats.visitors.trend.map((t) => (
                  <div key={t.date} className="flex flex-col items-center gap-1" title={`${t.date}: ${t.count} visitor(s)`}>
                    <div
                      className="w-4 rounded-t-md bg-gradient-to-t from-brand-600 to-accent-500"
                      style={{ height: `${Math.max(3, (t.count / max) * 72)}px` }}
                    />
                    <span className="text-[9px] text-slate-400">{t.date.slice(8)}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* enrolment by grade */}
        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Enrolment by grade</h2>
          <div className="space-y-2">
            {stats.students.byGrade.map((g) => (
              <div key={g.gradeLevel} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-slate-500">{gradeLabel(g.gradeLevel)}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-gradient-soft transition-all" style={{ width: `${(g.count / maxGrade) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-xs tabular-nums text-slate-600">{g.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          {/* finance summary (staff with finance responsibility only) */}
          {financeVisible && (
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Finance — this month</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Invoiced</dt>
                <dd className="font-medium tabular-nums">{formatMoney(stats.finance.invoicedThisMonth)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Collected</dt>
                <dd className="font-medium tabular-nums text-emerald-600">{formatMoney(stats.finance.collectedThisMonth)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-3">
                <dt className="text-slate-500">Last payroll</dt>
                <dd className="font-medium tabular-nums">
                  {stats.payroll.lastRunLabel ? `${formatMoney(stats.payroll.lastRunNet)}` : "—"}
                </dd>
              </div>
              {stats.payroll.lastRunLabel && <p className="text-xs text-slate-400">{stats.payroll.lastRunLabel}</p>}
            </dl>
          </Card>
          )}

          {/* announcements */}
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Recent announcements</h2>
            <ul className="space-y-3">
              {stats.recentAnnouncements.map((a) => (
                <li key={a.id} className="text-sm">
                  <p className="font-medium text-slate-800">{a.title}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                    <Badge tone="gray">{a.audience}</Badge> {formatDate(a.createdAt)}
                  </p>
                </li>
              ))}
              {stats.recentAnnouncements.length === 0 && <p className="text-sm text-slate-400">No announcements yet.</p>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
