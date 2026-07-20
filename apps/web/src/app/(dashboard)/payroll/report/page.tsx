"use client";

import { useState, type ChangeEvent } from "react";
import Link from "next/link";
import { get, post, getSession, ApiClientError } from "@/lib/api";
import { formatMoney, monthLabel } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { EditPayslipModal, type EditablePayslip } from "../edit-payslip-modal";

/**
 * Payroll report with advanced filters: period range, employee search,
 * department, staff type, run/payslip status and net-pay bounds. Shows the
 * matching payslips with grand totals plus per-month and per-department
 * summaries. Printable, exportable to CSV, and (for admins) draft payslips
 * can be edited right from the results.
 */

interface Component { name: string; amount: number }

interface ReportRow {
  id: string;
  basicSalary: number;
  bonus: number;
  gross: number;
  totalDeductions: number;
  net: number;
  currency: string;
  status: string;
  allowances: Component[];
  deductions: Component[];
  run: { id: string; month: number; year: number; status: string };
  staff: {
    staffNo: string;
    designation: string;
    department: string | null;
    staffType: string;
    user: { firstName: string; lastName: string };
  };
}

interface GroupTotals { payslips: number; gross: number; deductions: number; net: number }

interface Report {
  rows: ReportRow[];
  totals: { payslips: number; staff: number; gross: number; bonus: number; deductions: number; net: number };
  byMonth: Array<GroupTotals & { month: number; year: number }>;
  byDepartment: Array<GroupTotals & { department: string }>;
}

const EMPTY_FILTERS = {
  from: "",
  to: "",
  search: "",
  department: "",
  staffType: "",
  runStatus: "",
  payslipStatus: "",
  minNet: "",
  maxNet: "",
};

const staffName = (r: ReportRow) => `${r.staff.user.firstName} ${r.staff.user.lastName}`;
const periodKey = (r: { month: number; year: number }) => `${r.year}-${String(r.month).padStart(2, "0")}`;

function downloadCsv(rows: ReportRow[]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const major = (cents: number) => (cents / 100).toFixed(2);
  const header = ["Period", "Staff No", "Employee", "Department", "Type", "Designation", "Basic", "Allowances", "Bonus", "Deductions", "Net", "Currency", "Run status", "Payslip status"];
  const lines = rows.map((r) =>
    [
      periodKey(r.run),
      r.staff.staffNo,
      staffName(r),
      r.staff.department ?? "",
      r.staff.staffType,
      r.staff.designation,
      major(r.basicSalary),
      major(r.gross - r.basicSalary - r.bonus),
      major(r.bonus),
      major(r.totalDeductions),
      major(r.net),
      r.currency,
      r.run.status,
      r.status,
    ].map(esc).join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "payroll-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function PayrollReportPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditablePayslip | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const role = getSession()?.user.role;
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const set = (key: keyof typeof EMPTY_FILTERS) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (!value) continue;
        // Net bounds are entered in major units; the API expects cents.
        if (key === "minNet" || key === "maxNet") params.set(key, String(Math.round(parseFloat(value) * 100)));
        else params.set(key, value);
      }
      setReport(await get<Report>(`/payroll/report?${params}`));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to generate the report");
    } finally {
      setLoading(false);
    }
  }

  /** Emails the currently filtered report (defaults to the signed-in admin). */
  async function emailReport() {
    setEmailing(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(filters)) {
        if (!value) continue;
        body[key] = key === "minNet" || key === "maxNet" ? Math.round(parseFloat(value) * 100) : value;
      }
      const result = await post<{ message: string }>("/payroll/report/email", body);
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to email the report");
    } finally {
      setEmailing(false);
    }
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Payroll report"
          subtitle="Filter payslips across every run, see the totals, then print or export the result"
          actions={
            <>
              <Link href="/payroll"><Button variant="secondary">← Payroll runs</Button></Link>
              <Button variant="secondary" onClick={() => report && downloadCsv(report.rows)} disabled={!report || report.rows.length === 0}>
                <Icon name="file" className="h-4 w-4" /> CSV
              </Button>
              <Button variant="secondary" onClick={() => window.print()} disabled={!report}>
                <Icon name="printer" className="h-4 w-4" /> Print
              </Button>
              {isAdmin && (
                <Button variant="secondary" onClick={() => void emailReport()} loading={emailing}
                  disabled={!report || report.rows.length === 0}
                  title="Email this report (with the filters above) to your account email">
                  <Icon name="mail" className="h-4 w-4" /> Email report
                </Button>
              )}
            </>
          }
        />

        <Card className="mb-6 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="From month">
              <Input type="month" value={filters.from} onChange={set("from")} />
            </Field>
            <Field label="To month">
              <Input type="month" value={filters.to} onChange={set("to")} />
            </Field>
            <Field label="Employee">
              <Input placeholder="Name, staff no or designation" value={filters.search} onChange={set("search")} />
            </Field>
            <Field label="Department">
              <Input placeholder="e.g. Science" value={filters.department} onChange={set("department")} />
            </Field>
            <Field label="Staff type">
              <Select value={filters.staffType} onChange={set("staffType")}>
                <option value="">All</option>
                <option value="TEACHING">Teaching</option>
                <option value="NON_TEACHING">Non-teaching</option>
              </Select>
            </Field>
            <Field label="Run status">
              <Select value={filters.runStatus} onChange={set("runStatus")}>
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="APPROVED">Approved</option>
                <option value="PAID">Paid</option>
              </Select>
            </Field>
            <Field label="Payslip status">
              <Select value={filters.payslipStatus} onChange={set("payslipStatus")}>
                <option value="">All</option>
                <option value="PENDING">Pending</option>
                <option value="PAID">Paid</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min net (USD)">
                <Input type="number" min={0} step="0.01" placeholder="0" value={filters.minNet} onChange={set("minNet")} />
              </Field>
              <Field label="Max net (USD)">
                <Input type="number" min={0} step="0.01" placeholder="∞" value={filters.maxNet} onChange={set("maxNet")} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void generate()} loading={loading}>Generate report</Button>
            <button className="text-sm text-slate-500 hover:underline" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </button>
          </div>
        </Card>
        <ErrorNote message={error} />
        {notice && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
        )}
      </div>

      {loading && <div className="flex justify-center py-16 text-brand-600 print:hidden"><Spinner /></div>}

      {report && !loading && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
            <StatCard label="Payslips" value={report.totals.payslips} detail={`${report.totals.staff} employees`} />
            <StatCard label="Gross" value={formatMoney(report.totals.gross)} detail={report.totals.bonus > 0 ? `incl. ${formatMoney(report.totals.bonus)} bonuses` : undefined} />
            <StatCard label="Deductions" value={formatMoney(report.totals.deductions)} />
            <StatCard label="Net payout" value={formatMoney(report.totals.net)} />
          </div>

          <Card className="overflow-x-auto p-6 print:border-0 print:p-0 print:shadow-none">
            <div className="mb-4 border-b border-slate-200 pb-3">
              <h2 className="font-semibold text-slate-900">Payroll report</h2>
              <p className="text-xs text-slate-500">
                {report.totals.payslips} payslips · {report.totals.staff} employees · Net {formatMoney(report.totals.net)}
              </p>
            </div>
            {report.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No payslips match these filters.</p>
            ) : (
              <div className="table-scroll">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2 font-medium">Period</th>
                    <th className="px-2 py-2 font-medium">Employee</th>
                    <th className="px-2 py-2 font-medium">Department</th>
                    <th className="px-2 py-2 text-right font-medium">Basic</th>
                    <th className="px-2 py-2 text-right font-medium">Allowances</th>
                    <th className="px-2 py-2 text-right font-medium">Bonus</th>
                    <th className="px-2 py-2 text-right font-medium">Deductions</th>
                    <th className="px-2 py-2 text-right font-medium">Net</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    {isAdmin && <th className="px-2 py-2 font-medium print:hidden" />}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 whitespace-nowrap">{monthLabel(r.run.month, r.run.year)}</td>
                      <td className="px-2 py-1.5">
                        <p className="font-medium text-slate-800">{staffName(r)}</p>
                        <p className="text-slate-400">{r.staff.staffNo} · {r.staff.designation}</p>
                      </td>
                      <td className="px-2 py-1.5">{r.staff.department ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(r.basicSalary, r.currency)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" title={r.allowances.map((a) => `${a.name}: ${formatMoney(a.amount)}`).join("\n")}>
                        +{formatMoney(r.gross - r.basicSalary - r.bonus, r.currency)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.bonus > 0 ? `+${formatMoney(r.bonus, r.currency)}` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-rose-600" title={r.deductions.map((d) => `${d.name}: ${formatMoney(d.amount)}`).join("\n")}>
                        −{formatMoney(r.totalDeductions, r.currency)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-emerald-700">{formatMoney(r.net, r.currency)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap"><Badge>{r.run.status}</Badge></td>
                      {isAdmin && (
                        <td className="px-2 py-1.5 print:hidden">
                          {r.run.status === "DRAFT" && (
                            <button
                              className="font-medium text-brand-600 hover:underline"
                              title="Edit this draft payslip"
                              onClick={() => setEditing({
                                id: r.id,
                                basicSalary: r.basicSalary,
                                bonus: r.bonus,
                                currency: r.currency,
                                allowances: r.allowances,
                                deductions: r.deductions,
                                staffName: staffName(r),
                              })}
                            >
                              <Icon name="edit" className="mr-0.5 inline h-3.5 w-3.5" />Edit
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
                    <td className="px-2 py-2" colSpan={3}>Total</td>
                    <td className="px-2 py-2 text-right tabular-nums" colSpan={3}>{formatMoney(report.totals.gross)} gross</td>
                    <td className="px-2 py-2 text-right tabular-nums text-rose-600">−{formatMoney(report.totals.deductions)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{formatMoney(report.totals.net)}</td>
                    <td colSpan={isAdmin ? 2 : 1} />
                  </tr>
                </tfoot>
              </table>
              </div>
            )}
          </Card>

          {report.rows.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By month</h3>
                <div className="table-scroll">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1.5 font-medium">Period</th>
                      <th className="px-2 py-1.5 text-right font-medium">Payslips</th>
                      <th className="px-2 py-1.5 text-right font-medium">Gross</th>
                      <th className="px-2 py-1.5 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byMonth.map((m) => (
                      <tr key={periodKey(m)} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1.5">{monthLabel(m.month, m.year)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{m.payslips}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(m.gross)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatMoney(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By department</h3>
                <div className="table-scroll">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1.5 font-medium">Department</th>
                      <th className="px-2 py-1.5 text-right font-medium">Payslips</th>
                      <th className="px-2 py-1.5 text-right font-medium">Gross</th>
                      <th className="px-2 py-1.5 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDepartment.map((d) => (
                      <tr key={d.department} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-1.5">{d.department}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{d.payslips}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(d.gross)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatMoney(d.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      <EditPayslipModal
        payslip={editing}
        onClose={() => setEditing(null)}
        onSaved={() => generate()}
      />
    </div>
  );
}
