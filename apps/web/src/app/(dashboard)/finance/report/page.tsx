"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { get, ApiClientError } from "@/lib/api";
import { useGrades, gradeName } from "@/lib/grades";
import { formatDate, formatMoney, fullName, humanize, monthLabel } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, PageHeader, Select, Spinner, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Per-academic-year finance report: every invoice issued during the chosen
 * year — previous years included — with invoiced/collected/outstanding
 * totals and grade / month / status breakdowns. Printable and CSV-exportable.
 */

interface ReportRow {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  student: { id: string; firstName: string; lastName: string; admissionNo: string; gradeLevel: string };
  total: number;
  paid: number;
  balance: number;
}

interface GroupTotals { invoices: number; invoiced: number; collected: number; outstanding: number }

interface Report {
  year: { id: string; name: string; startDate: string; endDate: string; isActive: boolean };
  rows: ReportRow[];
  totals: { invoices: number; students: number; invoiced: number; collected: number; outstanding: number };
  byGrade: Array<GroupTotals & { gradeLevel: string }>;
  byMonth: Array<GroupTotals & { year: number; month: number }>;
  byStatus: Array<GroupTotals & { status: string }>;
}

interface YearOption { id: string; name: string; isActive: boolean }

function downloadCsv(report: Report) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const major = (cents: number) => (cents / 100).toFixed(2);
  const header = ["Invoice", "Student", "Admission No", "Grade", "Issued", "Due", "Total", "Paid", "Balance", "Currency", "Status"];
  const lines = report.rows.map((r) =>
    [
      r.number, `${r.student.firstName} ${r.student.lastName}`, r.student.admissionNo, r.student.gradeLevel,
      new Date(r.issueDate).toISOString().slice(0, 10), new Date(r.dueDate).toISOString().slice(0, 10),
      major(r.total), major(r.paid), major(r.balance), r.currency, r.status,
    ].map(esc).join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finance-${report.year.name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FinanceReportPage() {
  const grades = useGrades();
  const [years, setYears] = useState<YearOption[]>([]);
  const [yearId, setYearId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<YearOption[]>("/academics/years").then((ys) => {
      setYears(ys);
      const active = ys.find((y) => y.isActive) ?? ys[0];
      if (active) setYearId(active.id);
    }).catch(() => setYears([]));
  }, []);

  async function generate() {
    if (!yearId) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await get<Report>(`/finance/report?academicYearId=${yearId}`));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to generate the report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Finance yearly report"
          subtitle="Fees, invoices and collections of the chosen academic year — previous years included"
          actions={
            <>
              <Link href="/finance"><Button variant="secondary">← Fees & Invoices</Button></Link>
              <Button variant="secondary" onClick={() => report && downloadCsv(report)} disabled={!report || report.rows.length === 0}>
                <Icon name="file" className="h-4 w-4" /> CSV
              </Button>
              <Button variant="secondary" onClick={() => window.print()} disabled={!report}>
                <Icon name="printer" className="h-4 w-4" /> Print
              </Button>
            </>
          }
        />

        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Academic year">
              <Select className="!w-64" value={yearId} onChange={(e) => setYearId(e.target.value)}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>)}
              </Select>
            </Field>
            <Button onClick={() => void generate()} loading={loading} disabled={!yearId}>Generate report</Button>
          </div>
        </Card>
        <ErrorNote message={error} />
      </div>

      {loading && <div className="flex justify-center py-16 text-brand-600 print:hidden"><Spinner /></div>}

      {report && !loading && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
            <StatCard label="Invoiced" value={formatMoney(report.totals.invoiced)} detail={`${report.totals.invoices} invoices · ${report.totals.students} students`} />
            <StatCard label="Collected" value={formatMoney(report.totals.collected)} />
            <StatCard label="Outstanding" value={formatMoney(report.totals.outstanding)} />
            <StatCard label="Collection rate" value={report.totals.invoiced > 0 ? `${Math.round((report.totals.collected / report.totals.invoiced) * 100)}%` : "—"} />
          </div>

          {report.rows.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By month</h3>
                <div className="table-scroll">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1.5 font-medium">Month</th>
                        <th className="px-2 py-1.5 text-right font-medium">Invoices</th>
                        <th className="px-2 py-1.5 text-right font-medium">Invoiced</th>
                        <th className="px-2 py-1.5 text-right font-medium">Collected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byMonth.map((m) => (
                        <tr key={`${m.year}-${m.month}`} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1.5">{monthLabel(m.month, m.year)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{m.invoices}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(m.invoiced)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatMoney(m.collected)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By grade</h3>
                <div className="table-scroll">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1.5 font-medium">Grade</th>
                        <th className="px-2 py-1.5 text-right font-medium">Invoices</th>
                        <th className="px-2 py-1.5 text-right font-medium">Invoiced</th>
                        <th className="px-2 py-1.5 text-right font-medium">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byGrade.map((g) => (
                        <tr key={g.gradeLevel} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1.5">{gradeName(grades, g.gradeLevel)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{g.invoices}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(g.invoiced)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-rose-600">{formatMoney(g.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          <Card className="overflow-x-auto p-6 print:border-0 print:p-0 print:shadow-none">
            <div className="mb-4 border-b border-slate-200 pb-3">
              <h2 className="font-semibold text-slate-900">Invoices — {report.year.name}</h2>
              <p className="text-xs text-slate-500">
                {report.totals.invoices} invoice(s) · invoiced {formatMoney(report.totals.invoiced)} · collected {formatMoney(report.totals.collected)} ·{" "}
                {formatDate(report.year.startDate)} – {formatDate(report.year.endDate)}
              </p>
            </div>
            {report.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No invoices were issued during this academic year.</p>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2 font-medium">Invoice</th>
                      <th className="px-2 py-2 font-medium">Student</th>
                      <th className="px-2 py-2 font-medium">Grade</th>
                      <th className="px-2 py-2 font-medium">Issued</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="px-2 py-2 text-right font-medium">Paid</th>
                      <th className="px-2 py-2 text-right font-medium">Balance</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100">
                        <td className="px-2 py-1.5 font-mono">{r.number}</td>
                        <td className="px-2 py-1.5">
                          <p className="font-medium text-slate-800">{fullName(r.student)}</p>
                          <p className="text-slate-400">{r.student.admissionNo}</p>
                        </td>
                        <td className="px-2 py-1.5">{gradeName(grades, r.student.gradeLevel)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.issueDate)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(r.total, r.currency)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{formatMoney(r.paid, r.currency)}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${r.balance > 0 ? "text-rose-600" : ""}`}>{formatMoney(r.balance, r.currency)}</td>
                        <td className="px-2 py-1.5"><Badge>{humanize(r.status)}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
                      <td className="px-2 py-2" colSpan={4}>Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatMoney(report.totals.invoiced)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{formatMoney(report.totals.collected)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-rose-600">{formatMoney(report.totals.outstanding)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
