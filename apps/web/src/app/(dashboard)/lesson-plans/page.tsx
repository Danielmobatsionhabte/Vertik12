"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ATTACHMENT_ACCEPT, type AttachmentInput, type Paginated } from "@vertik12/shared";
import { get, post, patch, del, getSession, ApiClientError } from "@/lib/api";
import { useGrades, gradeName } from "@/lib/grades";
import { fileToAttachment, downloadAttachment } from "@/lib/files";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { Pager } from "@/components/data-table";

/**
 * Lesson plans, per grade × subject. The administration publishes the plan
 * every teacher of that grade/subject follows (week by week); teachers can
 * contribute their own. Admins manage everything; teachers manage theirs.
 */

interface SubjectOption {
  id: string;
  code: string;
  name: string;
  gradeLevel?: string | null;
}

/** One subject × grade pair the signed-in teacher is assigned to. */
interface TeachingPair {
  subjectId: string;
  subjectName: string;
  gradeLevel: string;
}

interface PlanRow {
  id: string;
  gradeLevel: string;
  week?: number | null;
  title: string;
  objectives: string;
  materials?: string | null;
  activities: string;
  assessment?: string | null;
  notes?: string | null;
  status: string;
  reviewNote?: string | null;
  attachmentName?: string | null;
  updatedAt: string;
  subject: { id: string; code: string; name: string };
  author: { name: string; role: string } | null;
  canManage: boolean;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "PENDING") return <Badge tone="yellow">⏳ Awaiting approval</Badge>;
  if (status === "REJECTED") return <Badge tone="red">Rejected</Badge>;
  if (status === "DRAFT") return <Badge tone="gray">Draft</Badge>;
  return null; // published needs no badge
}

export default function LessonPlansPage() {
  const grades = useGrades();
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(getSession()?.user.role ?? "");
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  // Teachers are scoped to the subject × grade pairs they teach.
  const [pairs, setPairs] = useState<TeachingPair[] | null>(null);
  const [data, setData] = useState<(Paginated<PlanRow> & { locked: boolean }) | null>(null);
  const [page, setPage] = useState(1);
  const [gradeFilter, setGradeFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [viewing, setViewing] = useState<PlanRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin) {
      get<SubjectOption[]>("/academics/subjects").then(setSubjects).catch(() => setSubjects([]));
      setPairs(null);
    } else {
      // Teachers: only their own teaching assignments drive the pickers.
      get<Array<{ subject: { id: string; name: string }; classRoom: { gradeLevel: string } }>>("/academics/my-subjects")
        .then((assignments) => {
          const seen = new Set<string>();
          const p: TeachingPair[] = [];
          for (const a of assignments) {
            const key = `${a.subject.id}:${a.classRoom.gradeLevel}`;
            if (!seen.has(key)) {
              seen.add(key);
              p.push({ subjectId: a.subject.id, subjectName: a.subject.name, gradeLevel: a.classRoom.gradeLevel });
            }
          }
          setPairs(p);
          const uniqueSubjects = new Map(p.map((x) => [x.subjectId, { id: x.subjectId, code: "", name: x.subjectName }]));
          setSubjects([...uniqueSubjects.values()]);
        })
        .catch(() => { setPairs([]); setSubjects([]); });
    }
  }, [isAdmin]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (gradeFilter) params.set("gradeLevel", gradeFilter);
    if (subjectFilter) params.set("subjectId", subjectFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (weekFilter) params.set("week", weekFilter);
    if (mineOnly) params.set("mine", "1");
    if (search) params.set("search", search);
    return get<Paginated<PlanRow> & { locked: boolean }>(`/lesson-plans?${params}`).then(setData);
  }, [page, gradeFilter, subjectFilter, statusFilter, weekFilter, mineOnly, search]);

  const locked = data?.locked ?? false;
  const teacherLocked = locked && !isAdmin;

  /** Admin closes/opens curriculum editing for teachers. */
  async function toggleLock() {
    setError(null);
    try {
      await post("/lesson-plans/lock", { locked: !locked });
      setNotice(!locked
        ? "Lesson plans are now locked — teachers can view but no longer add or modify them."
        : "Editing re-opened — teachers can add and modify lesson plans again (changes still need your approval).");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to change the lock");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  /** Admin verdict on a pending submission. */
  async function review(plan: PlanRow, action: "APPROVE" | "REJECT") {
    let note: string | undefined;
    if (action === "REJECT") {
      const input = window.prompt("Note for the author — what should change?");
      if (input === null) return;
      note = input.trim() || undefined;
    }
    setReviewBusy(plan.id);
    setError(null);
    try {
      await post(`/lesson-plans/${plan.id}/review`, { action, note });
      setNotice(action === "APPROVE"
        ? `"${plan.title}" is approved and now published to all teachers.`
        : `"${plan.title}" was sent back to ${plan.author?.name ?? "the author"}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Review failed");
    } finally {
      setReviewBusy(null);
    }
  }

  async function remove(plan: PlanRow) {
    if (!window.confirm(`Delete the lesson plan "${plan.title}"?`)) return;
    setError(null);
    try {
      await del(`/lesson-plans/${plan.id}`);
      setNotice(`"${plan.title}" was removed.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to delete the plan");
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Lesson plans"
        subtitle="The curriculum plan teachers of each grade and subject follow, week by week"
        actions={
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="secondary" onClick={() => void toggleLock()}>
                {locked ? "🔓 Re-open teacher editing" : "🔒 Lock teacher editing"}
              </Button>
            )}
            {!teacherLocked && <Button onClick={() => setShowCreate(true)}>+ New lesson plan</Button>}
          </div>
        }
      />

      {teacherLocked && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          🔒 The administration has locked lesson-plan editing — plans are read-only until an administrator re-opens it.
        </div>
      )}
      {locked && isAdmin && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          🔒 Teacher editing is currently locked. You can still add, modify and review plans yourself.
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      <ErrorNote message={error} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="max-w-[180px]" value={gradeFilter} onChange={(e) => { setGradeFilter(e.target.value); setPage(1); }}>
          <option value="">All grades</option>
          {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
        </Select>
        <Select className="max-w-[200px]" value={subjectFilter} onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }}>
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select className="max-w-[190px]" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="PUBLISHED">Published</option>
          <option value="PENDING">⏳ Awaiting approval</option>
          <option value="REJECTED">Rejected</option>
          <option value="DRAFT">Draft</option>
        </Select>
        <Input
          type="number" min={1} max={52} placeholder="Week"
          className="!w-24"
          value={weekFilter}
          onChange={(e) => { setWeekFilter(e.target.value); setPage(1); }}
        />
        <Input
          placeholder="Search title, objectives, activities…"
          className="max-w-xs"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={mineOnly} onChange={(e) => { setMineOnly(e.target.checked); setPage(1); }} />
          My plans only
        </label>
      </div>

      {!data ? (
        <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>
      ) : data.items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-400">
          No lesson plans yet — create the first one for a grade and subject.
        </Card>
      ) : (
        <div className="space-y-4">
          {data.items.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <button className="text-left font-semibold text-slate-900 hover:text-brand-600" onClick={() => setViewing(p)}>
                    {p.title}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <Badge tone="brand">{gradeName(grades, p.gradeLevel)}</Badge>
                    <Badge tone="blue">{p.subject.name}</Badge>
                    {p.week && <Badge tone="gray">Week {p.week}</Badge>}
                    <StatusBadge status={p.status} />
                    <span>{p.author ? `${p.author.name} (${humanize(p.author.role)})` : ""} · updated {formatDate(p.updatedAt)}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isAdmin && p.status === "PENDING" && (
                    <>
                      <Button className="!px-3 !py-1 text-xs" loading={reviewBusy === p.id} onClick={() => void review(p, "APPROVE")}>
                        ✓ Approve
                      </Button>
                      <Button variant="danger" className="!px-3 !py-1 text-xs" loading={reviewBusy === p.id} onClick={() => void review(p, "REJECT")}>
                        ✗ Reject
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => setViewing(p)}>Open</Button>
                  {p.canManage && !teacherLocked && (
                    <>
                      <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => setEditing(p)}>Edit</Button>
                      <Button variant="danger" className="!px-3 !py-1 text-xs" onClick={() => void remove(p)}>Delete</Button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{p.objectives}</p>
              {p.status === "REJECTED" && p.reviewNote && (
                <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <span className="font-semibold">Sent back by the administration:</span> {p.reviewNote} — edit and resubmit.
                </p>
              )}
              {p.attachmentName && (
                <button
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                  onClick={() => downloadAttachment(`/lesson-plans/${p.id}/attachment`, p.attachmentName ?? undefined).catch((e) => setError(e.message))}
                >
                  📎 {p.attachmentName}
                </button>
              )}
            </Card>
          ))}
          <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </div>
      )}

      {(showCreate || editing) && (
        <PlanModal
          subjects={subjects}
          pairs={pairs}
          editing={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={async (msg) => {
            setShowCreate(false);
            setEditing(null);
            setNotice(msg);
            await load();
          }}
        />
      )}

      {viewing && <PlanViewModal plan={viewing} onClose={() => setViewing(null)} onError={setError} />}
    </div>
  );
}

/** Full read view — what a teacher opens to follow the plan in class. */
function PlanViewModal({ plan, onClose, onError }: { plan: PlanRow; onClose: () => void; onError: (m: string) => void }) {
  const grades = useGrades();
  const sections: Array<{ label: string; value?: string | null }> = [
    { label: "Objectives", value: plan.objectives },
    { label: "Materials & resources", value: plan.materials },
    { label: "Activities / lesson flow", value: plan.activities },
    { label: "Assessment", value: plan.assessment },
    { label: "Notes", value: plan.notes },
  ];
  return (
    <Modal open title={plan.title} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Badge tone="brand">{gradeName(grades, plan.gradeLevel)}</Badge>
          <Badge tone="blue">{plan.subject.name}</Badge>
          {plan.week && <Badge tone="gray">Week {plan.week}</Badge>}
          <StatusBadge status={plan.status} />
          <span>{plan.author ? `by ${plan.author.name}` : ""}</span>
        </p>
        {sections.filter((s) => s.value?.trim()).map((s) => (
          <div key={s.label}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{s.label}</h3>
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{s.value}</p>
          </div>
        ))}
        {plan.attachmentName && (
          <button
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
            onClick={() => downloadAttachment(`/lesson-plans/${plan.id}/attachment`, plan.attachmentName ?? undefined).catch((e) => onError(e.message))}
          >
            📎 Download {plan.attachmentName}
          </button>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function PlanModal({ subjects, pairs, editing, onClose, onSaved }: {
  subjects: SubjectOption[];
  /** Teacher's subject × grade assignments; null for admins (unrestricted). */
  pairs: TeachingPair[] | null;
  editing: PlanRow | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const grades = useGrades();
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(getSession()?.user.role ?? "");
  const [form, setForm] = useState({
    gradeLevel: editing?.gradeLevel ?? "",
    subjectId: editing?.subject.id ?? "",
    week: editing?.week ? String(editing.week) : "",
    title: editing?.title ?? "",
    objectives: editing?.objectives ?? "",
    materials: editing?.materials ?? "",
    activities: editing?.activities ?? "",
    assessment: editing?.assessment ?? "",
    notes: editing?.notes ?? "",
    // Teachers submit for approval (or keep a private draft); admins publish.
    status: isAdmin
      ? (editing?.status ?? "PUBLISHED")
      : editing?.status === "DRAFT" ? "DRAFT" : "PENDING",
  });
  const [attachment, setAttachment] = useState<AttachmentInput | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Teachers only pick from the grades they actually teach; admins from the
  // whole ladder.
  const gradeOptions = pairs
    ? grades.filter((g) => pairs.some((p) => p.gradeLevel === g.code))
    : grades;

  useEffect(() => {
    if (gradeOptions.length > 0 && !gradeOptions.some((g) => g.code === form.gradeLevel)) {
      setForm((f) => ({ ...f, gradeLevel: gradeOptions[0]!.code }));
    }
  }, [grades, pairs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subjects for the chosen grade: the teacher's own assignments, or (for
  // admins) any subject taught in that grade / offered to all grades.
  const gradeSubjects: Array<{ id: string; name: string }> = pairs
    ? pairs.filter((p) => p.gradeLevel === form.gradeLevel).map((p) => ({ id: p.subjectId, name: p.subjectName }))
    : subjects.filter((s) => !s.gradeLevel || s.gradeLevel === form.gradeLevel);

  useEffect(() => {
    if (gradeSubjects.length > 0 && !gradeSubjects.some((s) => s.id === form.subjectId)) {
      setForm((f) => ({ ...f, subjectId: gradeSubjects[0]!.id }));
    }
  }, [form.gradeLevel, subjects, pairs]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setAttachment(await fileToAttachment(file));
      setRemoveAttachment(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
      e.target.value = "";
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      gradeLevel: form.gradeLevel,
      subjectId: form.subjectId,
      week: form.week ? Number(form.week) : undefined,
      title: form.title,
      objectives: form.objectives,
      materials: form.materials || undefined,
      activities: form.activities,
      assessment: form.assessment || undefined,
      notes: form.notes || undefined,
      status: form.status,
    };
    const savedMessage = isAdmin
      ? form.status === "DRAFT"
        ? "Lesson plan saved as a draft."
        : "Lesson plan published — teachers of this grade and subject can now follow it."
      : form.status === "DRAFT"
        ? "Draft saved — only you and the administration can see it."
        : "Lesson plan submitted — it goes live once the administration approves it.";
    try {
      if (editing) {
        await patch(`/lesson-plans/${editing.id}`, {
          ...payload,
          ...(attachment ? { attachment } : {}),
          ...(removeAttachment && !attachment ? { removeAttachment: true } : {}),
        });
        await onSaved(savedMessage);
      } else {
        await post("/lesson-plans", { ...payload, ...(attachment ? { attachment } : {}) });
        await onSaved(savedMessage);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save the lesson plan");
    } finally {
      setSaving(false);
    }
  }

  const currentFileLabel = attachment
    ? attachment.name
    : editing?.attachmentName && !removeAttachment
      ? editing.attachmentName
      : null;

  const area = (key: "objectives" | "materials" | "activities" | "assessment" | "notes", rows: number, required = false, placeholder = "") => (
    <textarea
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      rows={rows}
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      required={required}
      placeholder={placeholder}
    />
  );

  return (
    <Modal open title={editing ? `Edit — ${editing.title}` : "New lesson plan"} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Grade" hint={pairs ? "Only the grades you teach" : undefined}>
            <Select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value }))} required>
              {gradeOptions.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
            </Select>
          </Field>
          <Field label="Subject">
            <Select value={form.subjectId} onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))} required>
              {gradeSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Week (optional)" hint="Orders the plan through the term">
            <Input type="number" min={1} max={52} value={form.week} onChange={(e) => setForm((f) => ({ ...f, week: e.target.value }))} />
          </Field>
        </div>
        <Field label="Title">
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required maxLength={200} placeholder="e.g. Introduction to fractions" />
        </Field>
        <Field label="Learning objectives" hint="What students should know or be able to do afterwards">
          {area("objectives", 3, true)}
        </Field>
        <Field label="Materials & resources (optional)">
          {area("materials", 2, false, "Textbook ch. 4, worksheets, ruler…")}
        </Field>
        <Field label="Activities / lesson flow" hint="Intro, main activity, practice, wrap-up…">
          {area("activities", 5, true)}
        </Field>
        <Field label="Assessment (optional)">
          {area("assessment", 2, false, "Exit quiz, homework review…")}
        </Field>
        <Field label="Notes for teachers (optional)">
          {area("notes", 2)}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={isAdmin ? "Visibility" : "Submission"}
            hint={isAdmin
              ? "Published plans are followed by all teachers of this grade & subject"
              : "Submitted plans wait for the administration's approval before teachers see them"}
          >
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {isAdmin ? (
                <>
                  <option value="PUBLISHED">Publish now</option>
                  <option value="DRAFT">Draft (only me)</option>
                </>
              ) : (
                <>
                  <option value="PENDING">Submit for approval</option>
                  <option value="DRAFT">Draft (only me)</option>
                </>
              )}
            </Select>
          </Field>
          <Field label="Attach a file (optional)" hint="Worksheet or resource — PDF, JPG, PNG or Word, max 5 MB">
            <div className="space-y-1">
              <Input type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => void pickFile(e)} />
              {currentFileLabel && (
                <p className="flex items-center gap-2 text-xs text-slate-600">
                  📎 {currentFileLabel}
                  <button type="button" className="text-rose-600 underline" onClick={() => { setAttachment(null); setRemoveAttachment(true); }}>
                    Remove
                  </button>
                </p>
              )}
            </div>
          </Field>
        </div>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? "Save changes" : "Save lesson plan"}</Button>
        </div>
      </form>
    </Modal>
  );
}
