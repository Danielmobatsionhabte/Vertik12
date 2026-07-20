"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { STAFF_TYPES, STAFF_STATUSES } from "@vertik12/shared";
import { get, ApiClientError } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Select, Spinner, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Per-academic-year HR report: the staff roster during the chosen year —
 * previous years included — with hires made that year flagged, plus
 * type/department/status summaries. Printable and exportable to CSV.
 */

interface ReportRow {
  id: string;
  staffNo: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  staffType: string;
  designation: string;
  department: string | null;
  status: string;
  joinDate: string;
  joinedThisYear: boolean;
}

interface CountRow { label: string; count: number }

interface Report {
  year: { id: string; name: string; startDate: string; endDate: string; isActive: boolean };
  rows: ReportRow[];
  totals: {
    staff: number;
    newHires: number;
    byType: CountRow[];
    byDepartment: CountRow[];
    byStatus: CountRow[];
    byRole: CountRow[];
  };
}

interface YearOption { id: string; name: string; isActive: boolean }

function downloadCsv(report: Report) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = ["Staff No", "First name", "Last name", "Email", "Role", "Type", "Designation", "Department", "Join date", "Status", "Hired this year"];
  const lines = report.rows.map((r) =>
    [
      r.staffNo, r.firstName, r.lastName, r.email, r.role, r.staffType, r.designation,
      r.department ?? "", new Date(r.joinDate).toISOString().slice(0, 10), r.status,
      r.joinedThisYear ? "Yes" : "No",
    ].map(esc).join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `staff-${report.year.name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StaffReportPage() {
  const [years, setYears] = useState<YearOption[]>([]);
  const [yearId, setYearId] = useState("");
  const [staffType, setStaffType] = useState("");
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
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
      const params = new URLSearchParams({ academicYearId: yearId });
      if (staffType) params.set("staffType", staffType);
      if (status) params.set("status", status);
      if (department) params.set("department", department);
      setReport(await get<Report>(`/staff/report?${params}`));
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
          title="Staff & HR yearly report"
          subtitle="The employee roster during the chosen academic year — previous years included — with that year's hires flagged"
          actions={
            <>
              <Link href="/staff"><Button variant="secondary">← Staff & HR</Button></Link>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Academic year">
              <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Staff type">
              <Select value={staffType} onChange={(e) => setStaffType(e.target.value)}>
                <option value="">All types</option>
                {STAFF_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STAFF_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            </Field>
            <Field label="Department">
              <Input placeholder="e.g. Science" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => void generate()} loading={loading} disabled={!yearId}>Generate report</Button>
            </div>
          </div>
        </Card>
        <ErrorNote message={error} />
      </div>

      {loading && <div className="flex justify-center py-16 text-brand-600 print:hidden"><Spinner /></div>}

      {report && !loading && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
            <StatCard label="Employees" value={report.totals.staff} detail={report.year.name} />
            <StatCard label="Hired during this year" value={report.totals.newHires} />
            <StatCard
              label="Teaching / non-teaching"
              value={STAFF_TYPES.map((t) => report.totals.byType.find((x) => x.label === t)?.count ?? 0).join(" / ")}
            />
            <StatCard label="Departments" value={report.totals.byDepartment.length} />
          </div>

          <Card className="overflow-x-auto p-6 print:border-0 print:p-0 print:shadow-none">
            <div className="mb-4 border-b border-slate-200 pb-3">
              <h2 className="font-semibold text-slate-900">Staff roster — {report.year.name}</h2>
              <p className="text-xs text-slate-500">
                {report.totals.staff} employee(s) · {report.totals.newHires} hired during the year ·{" "}
                {formatDate(report.year.startDate)} – {formatDate(report.year.endDate)}
              </p>
            </div>
            {report.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No staff match these filters for this year.</p>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2 font-medium">Staff No</th>
                      <th className="px-2 py-2 font-medium">Employee</th>
                      <th className="px-2 py-2 font-medium">Department</th>
                      <th className="px-2 py-2 font-medium">Type</th>
                      <th className="px-2 py-2 font-medium">Role</th>
                      <th className="px-2 py-2 font-medium">Joined</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100">
                        <td className="px-2 py-1.5 font-mono">{r.staffNo}</td>
                        <td className="px-2 py-1.5">
                          <p className="font-medium text-slate-800">{r.firstName} {r.lastName}</p>
                          <p className="text-slate-400">{r.designation} · {r.email}</p>
                        </td>
                        <td className="px-2 py-1.5">{r.department ?? "—"}</td>
                        <td className="px-2 py-1.5">{humanize(r.staffType)}</td>
                        <td className="px-2 py-1.5"><Badge tone="gray">{r.role}</Badge></td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {formatDate(r.joinDate)}
                          {r.joinedThisYear && <Badge tone="brand"> new</Badge>}
                        </td>
                        <td className="px-2 py-1.5"><Badge>{r.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {report.rows.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By department</h3>
                <div className="table-scroll">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1.5 font-medium">Department</th>
                        <th className="px-2 py-1.5 text-right font-medium">Employees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.totals.byDepartment.map((d) => (
                        <tr key={d.label} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1.5">{d.label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{d.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By status & role</h3>
                <div className="table-scroll">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1.5 font-medium">Group</th>
                        <th className="px-2 py-1.5 text-right font-medium">Employees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...report.totals.byStatus, ...report.totals.byRole].map((g) => (
                        <tr key={g.label} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1.5">{humanize(g.label)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{g.count}</td>
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
    </div>
  );
}
