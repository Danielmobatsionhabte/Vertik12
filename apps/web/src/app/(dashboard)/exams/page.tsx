"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { get, post, patch, del, getSession, ApiClientError } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select } from "@/components/ui";
import { DataTable } from "@/components/data-table";

interface ExamRow {
  id: string;
  name: string;
  category: string;
  weight: number;
  startDate?: string | null;
  createdBy?: string | null;
  term: { name: string; academicYear: { name: string } };
  _count: { results: number };
}
interface YearRow { id: string; name: string; isActive: boolean; terms: Array<{ id: string; name: string }> }
interface ExamTypeRow { id: string; name: string }

export default function ExamsPage() {
  const session = getSession();
  const role = session?.user.role ?? "";
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(role);
  const canSchedule = isAdmin || role === "TEACHER";

  const [exams, setExams] = useState<ExamRow[] | null>(null);
  const [years, setYears] = useState<YearRow[]>([]);
  const [types, setTypes] = useState<ExamTypeRow[]>([]);
  const [editing, setEditing] = useState<ExamRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () => Promise.all([
      get<ExamRow[]>("/exams").then(setExams),
      get<ExamTypeRow[]>("/exams/types").then(setTypes),
    ]),
    [],
  );

  useEffect(() => {
    void load();
    get<YearRow[]>("/academics/years").then(setYears);
  }, [load]);

  const terms = (years.find((y) => y.isActive) ?? years[0])?.terms ?? [];

  /** Teachers may modify only assessments they scheduled; admins any. */
  const canModify = (e: ExamRow) => isAdmin || (role === "TEACHER" && e.createdBy === session?.user.id);

  async function cancelExam(e: ExamRow) {
    if (!window.confirm(`Cancel "${e.name}"? This removes the schedule (blocked if results exist).`)) return;
    try {
      await del(`/exams/${e.id}`);
      setNotice(`"${e.name}" was cancelled.`);
      await load();
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Failed to cancel");
    }
  }

  return (
    <div>
      <PageHeader
        title="Exams & Grades"
        subtitle="Assessments contribute to term report cards proportionally to their weight"
        actions={
          <div className="flex gap-2">
            {isAdmin && <Button variant="secondary" onClick={() => setShowTypes(true)}>Manage exam types</Button>}
            <Link href="/exams/gradebook">
              <Button variant="secondary">Open gradebook</Button>
            </Link>
            {canSchedule && <Button onClick={() => setShowAdd(true)}>+ Schedule assessment</Button>}
          </div>
        }
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <Card>
        <DataTable
          loading={!exams}
          rows={exams ?? []}
          keyFor={(e) => e.id}
          emptyTitle="No assessments scheduled"
          columns={[
            { header: "Assessment", cell: (e) => <span className="font-medium text-slate-900">{e.name}</span> },
            { header: "Type", cell: (e) => <Badge tone="gray">{e.category.replaceAll("_", " ")}</Badge> },
            { header: "Term", cell: (e) => `${e.term.name} · ${e.term.academicYear.name}` },
            { header: "Starts", cell: (e) => formatDate(e.startDate) },
            { header: "Weight", align: "right", cell: (e) => `${e.weight}%` },
            { header: "Results", align: "right", cell: (e) => e._count.results },
            {
              header: "",
              cell: (e) =>
                canModify(e) ? (
                  <span className="flex gap-2">
                    <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setEditing(e)}>Edit</button>
                    <button className="text-xs font-medium text-rose-600 hover:underline" onClick={() => void cancelExam(e)}>Cancel</button>
                  </span>
                ) : e._count.results > 0 ? <Badge tone="green">Graded</Badge> : null,
            },
          ]}
        />
      </Card>

      {(showAdd || editing) && (
        <ExamFormModal
          exam={editing}
          terms={terms}
          types={types}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={async () => {
            setShowAdd(false);
            setEditing(null);
            await load();
          }}
        />
      )}
      {showTypes && (
        <ExamTypesModal
          types={types}
          onClose={() => setShowTypes(false)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** Create or edit (reschedule) an assessment. */
function ExamFormModal({ exam, terms, types, onClose, onSaved }: {
  exam: ExamRow | null;
  terms: Array<{ id: string; name: string }>;
  types: ExamTypeRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: exam?.name ?? "",
    category: exam?.category ?? types[0]?.name ?? "OTHER",
    termId: terms[0]?.id ?? "",
    weight: String(exam?.weight ?? 100),
    startDate: exam?.startDate ? exam.startDate.slice(0, 10) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name,
      category: form.category,
      termId: form.termId,
      weight: Number(form.weight),
      startDate: form.startDate || undefined,
    };
    try {
      if (exam) await patch(`/exams/${exam.id}`, payload);
      else await post("/exams", payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <Modal open title={exam ? `Edit — ${exam.name}` : "Schedule an assessment"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Assessment name">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Term 2 Exam, Weekly Test 4" required />
        </Field>
        <Field label="Type">
          <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            {types.map((t) => <option key={t.id} value={t.name}>{humanize(t.name)}</option>)}
          </Select>
        </Field>
        <Field label="Term">
          <Select value={form.termId} onChange={(e) => setForm((f) => ({ ...f, termId: e.target.value }))} required>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Weight (%)" hint="Contribution to the term grade">
            <Input type="number" min={0} max={100} value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} />
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
          </Field>
        </div>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{exam ? "Save changes" : "Schedule"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Admin: add/remove the assessment types available school-wide. */
function ExamTypesModal({ types, onClose, onChanged }: {
  types: ExamTypeRow[];
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/exams/types", { name: name.trim().toUpperCase().replaceAll(" ", "_") });
      setName("");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to add type");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: ExamTypeRow) {
    setBusy(true);
    setError(null);
    try {
      await del(`/exams/types/${t.id}`);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to remove");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Exam types" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          These types are offered whenever an assessment is scheduled (Term Exam, Final Exam, Mid Term, …).
          Types in use by existing assessments cannot be removed.
        </p>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {types.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-medium text-slate-800">{humanize(t.name)}</span>
              <button className="text-xs font-medium text-rose-600 hover:underline" disabled={busy} onClick={() => void remove(t)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="flex items-end gap-3">
          <Field label="New type">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mid Term" required minLength={2} />
          </Field>
          <Button type="submit" loading={busy}>Add type</Button>
        </form>
        <ErrorNote message={error} />
      </div>
    </Modal>
  );
}
