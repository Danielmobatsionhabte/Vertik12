"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { get, post, getSession, ApiClientError } from "@/lib/api";
import { formatDate, gradeLabel } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, PageHeader, Select, Spinner } from "@/components/ui";

interface YearRow { id: string; name: string; isActive: boolean; terms: Array<{ id: string; name: string }> }

interface ReportCard {
  school: { name: string; motto?: string | null; address?: string | null } | null;
  student: { id: string; name: string; admissionNo: string; gradeLevel: string };
  term: { id: string; name: string; academicYear: string };
  subjects: Array<{
    subject: { id: string; code: string; name: string };
    percentage: number;
    grade: string;
    points: number;
    exams: Array<{ exam: string; marks: number; maxMarks: number; grade: string }>;
  }>;
  gpa: number | null;
  overall: number | null;
  overallGrade: string | null;
  scale: Array<{ letter: string; minPercent: number; points: number }>;
  approval: { approvedAt: string; approvedById: string } | null;
}

/**
 * Registrar view: generate the term report card from the admin-configured
 * grading scale, approve it, and print it (the print stylesheet strips the
 * app chrome so only the card itself is on paper).
 */
export default function ReportCardPage() {
  const { id } = useParams<{ id: string }>();
  const [terms, setTerms] = useState<Array<{ id: string; name: string; yearName: string }>>([]);
  const [termId, setTermId] = useState("");
  const [card, setCard] = useState<ReportCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const role = getSession()?.user.role;
  const canApprove = role === "SUPER_ADMIN" || role === "ADMIN" || role === "REGISTRAR";

  useEffect(() => {
    get<YearRow[]>("/academics/years").then((years) => {
      const active = years.find((y) => y.isActive) ?? years[0];
      const list = (active?.terms ?? []).map((t) => ({ id: t.id, name: t.name, yearName: active!.name }));
      setTerms(list);
      if (list[0]) setTermId(list[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!termId) return;
    setLoading(true);
    setError(null);
    try {
      setCard(await get<ReportCard>(`/exams/report-card/${id}/${termId}`));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load report card");
    } finally {
      setLoading(false);
    }
  }, [id, termId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    setApproving(true);
    try {
      await post(`/exams/report-card/${id}/${termId}/approve`);
      await load();
    } finally {
      setApproving(false);
    }
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Report card"
          subtitle="Grades are generated from the school's configured grading scale"
          actions={
            <div className="flex items-center gap-2">
              <Select value={termId} onChange={(e) => setTermId(e.target.value)} className="!w-44">
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.yearName}</option>)}
              </Select>
              {card && canApprove && !card.approval && (
                <Button onClick={approve} loading={approving}>Approve</Button>
              )}
              <Button variant="secondary" onClick={() => window.print()} disabled={!card}>
                🖨 Print
              </Button>
            </div>
          }
        />
        <ErrorNote message={error} />
      </div>

      {loading && (
        <div className="flex justify-center py-24 text-brand-600 print:hidden"><Spinner /></div>
      )}

      {card && !loading && (
        <Card className="mx-auto max-w-3xl p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none">
          {/* letterhead */}
          <div className="border-b-2 border-slate-800 pb-4 text-center">
            <h1 className="text-2xl font-bold text-slate-900">{card.school?.name ?? "Vertik12"}</h1>
            {card.school?.motto && <p className="text-sm italic text-slate-500">{card.school.motto}</p>}
            {card.school?.address && <p className="mt-1 text-xs text-slate-400">{card.school.address}</p>}
            <p className="mt-3 text-sm font-semibold uppercase tracking-widest text-slate-700">
              Student Report Card — {card.term.name}, {card.term.academicYear}
            </p>
          </div>

          {/* student block */}
          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs uppercase text-slate-400">Student</dt><dd className="font-medium">{card.student.name}</dd></div>
            <div><dt className="text-xs uppercase text-slate-400">Admission No</dt><dd className="font-mono">{card.student.admissionNo}</dd></div>
            <div><dt className="text-xs uppercase text-slate-400">Grade</dt><dd>{gradeLabel(card.student.gradeLevel)}</dd></div>
          </dl>

          {/* grades table */}
          {card.subjects.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">No exam results recorded for this term yet.</p>
          ) : (
            <table className="mt-6 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-medium">Subject</th>
                  <th className="py-2 pr-4 font-medium">Exams</th>
                  <th className="py-2 pr-4 text-right font-medium">Score /100</th>
                  <th className="py-2 text-right font-medium">Grade</th>
                </tr>
              </thead>
              <tbody>
                {card.subjects.map((s) => (
                  <tr key={s.subject.id} className="border-b border-slate-100">
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{s.subject.name}</td>
                    <td className="py-2.5 pr-4 text-xs text-slate-500">
                      {s.exams.map((e) => `${e.exam}: ${e.marks}/${e.maxMarks}`).join(" · ")}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{s.percentage}</td>
                    <td className="py-2.5 text-right font-semibold">{s.grade}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
                  <td className="py-3 pr-4">Overall</td>
                  <td />
                  <td className="py-3 pr-4 text-right tabular-nums">{card.overall ?? "—"}</td>
                  <td className="py-3 text-right">{card.overallGrade ?? "—"} {card.gpa !== null && <span className="ml-2 text-xs font-normal text-slate-500">GPA {card.gpa}</span>}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* grading key + approval */}
          <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-400">Grading scale</p>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                {card.scale.map((b) => `${b.letter} ≥ ${b.minPercent}%`).join("  ·  ")}
              </p>
            </div>
            <div className="text-right">
              {card.approval ? (
                <>
                  <Badge tone="green">APPROVED</Badge>
                  <p className="mt-1 text-xs text-slate-400">by the Registrar's Office · {formatDate(card.approval.approvedAt)}</p>
                </>
              ) : (
                <Badge tone="yellow">DRAFT — not yet approved</Badge>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
