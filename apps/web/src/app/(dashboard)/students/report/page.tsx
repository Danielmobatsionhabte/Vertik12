"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { STUDENT_STATUSES } from "@vertik12/shared";
import { get, ApiClientError } from "@/lib/api";
import { useGrades, gradeName } from "@/lib/grades";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, PageHeader, Select, Spinner, StatCard } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Per-academic-year student report for the admin/registrar. Pick any year —
 * including previous ones after a rollover — and get everyone enrolled that
 * year with the class they were in THEN, plus grade/gender/class summaries.
 * Printable and exportable to CSV.
 */

interface ReportRow {
  studentId: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: string;
  status: string;
  admittedAt: string;
  gradeLevel: string; // grade of the class in the report's year
  className: string;
  enrollmentStatus: string;
}

interface CountRow { label: string; count: number }

interface Report {
  year: { id: string; name: string; startDate: string; endDate: string; isActive: boolean };
  rows: ReportRow[];
  totals: {
    students: number;
    newAdmissions: number;
    byGrade: CountRow[];
    byGender: CountRow[];
    byStatus: CountRow[];
    byClass: CountRow[];
  };
}

interface YearOption { id: string; name: string; isActive: boolean }

function downloadCsv(report: Report) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = ["Admission No", "First name", "Last name", "Gender", "Grade", "Class", "Registered", "Student status", "Enrollment status"];
  const lines = report.rows.map((r) =>
    [
      r.admissionNo, r.firstName, r.lastName, r.gender, r.gradeLevel, r.className,
      new Date(r.admittedAt).toISOString().slice(0, 10), r.status, r.enrollmentStatus,
    ].map(esc).join(","),
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `students-${report.year.name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function StudentsReportPage() {
  const grades = useGrades();
  const [years, setYears] = useState<YearOption[]>([]);
  const [yearId, setYearId] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [status, setStatus] = useState("");
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
      if (gradeLevel) params.set("gradeLevel", gradeLevel);
      if (status) params.set("status", status);
      setReport(await get<Report>(`/students/report?${params}`));
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
          title="Student yearly report"
          subtitle="Everyone enrolled in the chosen academic year — including previous years — with their class of that year"
          actions={
            <>
              <Link href="/students"><Button variant="secondary">← Students</Button></Link>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Academic year">
              <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Grade (of that year)">
              <Select value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}>
                <option value="">All grades</option>
                {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
              </Select>
            </Field>
            <Field label="Student status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
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
            <StatCard label="Students enrolled" value={report.totals.students} detail={report.year.name} />
            <StatCard label="New admissions" value={report.totals.newAdmissions} detail="registered during this year" />
            <StatCard label="Classes" value={report.totals.byClass.length} />
            <StatCard
              label="Gender split"
              value={report.totals.byGender.map((g) => `${g.count} ${humanize(g.label)}`).join(" · ") || "—"}
            />
          </div>

          <Card className="overflow-x-auto p-6 print:border-0 print:p-0 print:shadow-none">
            <div className="mb-4 border-b border-slate-200 pb-3">
              <h2 className="font-semibold text-slate-900">Students — {report.year.name}</h2>
              <p className="text-xs text-slate-500">
                {report.totals.students} student(s) · {report.totals.newAdmissions} newly admitted ·{" "}
                {formatDate(report.year.startDate)} – {formatDate(report.year.endDate)}
              </p>
            </div>
            {report.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No students were enrolled in this year (with these filters).</p>
            ) : (
              <div className="table-scroll">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2 font-medium">Admission No</th>
                      <th className="px-2 py-2 font-medium">Name</th>
                      <th className="px-2 py-2 font-medium">Gender</th>
                      <th className="px-2 py-2 font-medium">Grade</th>
                      <th className="px-2 py-2 font-medium">Class</th>
                      <th className="px-2 py-2 font-medium">Registered</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={r.studentId} className="border-b border-slate-100">
                        <td className="px-2 py-1.5 font-mono">{r.admissionNo}</td>
                        <td className="px-2 py-1.5">
                          <Link className="font-medium text-slate-800 hover:underline print:no-underline" href={`/students/${r.studentId}`}>
                            {r.firstName} {r.lastName}
                          </Link>
                        </td>
                        <td className="px-2 py-1.5 capitalize">{r.gender.toLowerCase()}</td>
                        <td className="px-2 py-1.5">{gradeName(grades, r.gradeLevel)}</td>
                        <td className="px-2 py-1.5">{r.className}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.admittedAt)}</td>
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
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By grade</h3>
                <div className="table-scroll">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1.5 font-medium">Grade</th>
                        <th className="px-2 py-1.5 text-right font-medium">Students</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.totals.byGrade.map((g) => (
                        <tr key={g.label} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1.5">{gradeName(grades, g.label)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{g.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">By class</h3>
                <div className="table-scroll">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-1.5 font-medium">Class</th>
                        <th className="px-2 py-1.5 text-right font-medium">Students</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.totals.byClass.map((c) => (
                        <tr key={c.label} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-1.5">{c.label}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{c.count}</td>
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
