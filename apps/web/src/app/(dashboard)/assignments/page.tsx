"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ATTACHMENT_ACCEPT, type AttachmentInput, type Paginated } from "@vertik12/shared";
import { get, post, patch, del, ApiClientError } from "@/lib/api";
import { fileToAttachment, downloadAttachment } from "@/lib/files";
import { formatDate, fullName, localDateIso } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { Pager } from "@/components/data-table";

/**
 * Teacher › Assignments: send homework to a class (parents see it in the
 * portal and submit on their child's behalf), review submissions and leave
 * feedback/grades. Teachers can also modify or remove what they sent, and
 * attach a PDF/JPG/DOC brief that families download from the portal.
 */

interface AssignmentRow {
  id: string;
  title: string;
  instructions: string;
  dueDate: string;
  attachmentName?: string | null;
  classSubject: {
    id: string;
    subject: { name: string; code: string };
    classRoom: { name: string; _count: { enrollments: number } };
  };
  _count: { submissions: number };
}

interface MySubject {
  id: string;
  subject: { name: string };
  classRoom: { name: string; _count: { enrollments: number } };
}

interface SubmissionDetail {
  id: string;
  submittedAt: string;
  content: string;
  linkUrl?: string | null;
  attachmentName?: string | null;
  feedback?: string | null;
  grade?: string | null;
  student: { firstName: string; lastName: string; admissionNo: string };
}

export default function AssignmentsPage() {
  const [data, setData] = useState<Paginated<AssignmentRow> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [mySubjects, setMySubjects] = useState<MySubject[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [viewing, setViewing] = useState<AssignmentRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (search) params.set("search", search);
    return get<Paginated<AssignmentRow>>(`/assignments?${params}`).then(setData);
  }, [page, search]);
  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useEffect(() => {
    get<MySubject[]>("/academics/my-subjects").then(setMySubjects);
  }, []);
  const rows = data?.items ?? null;

  async function removeAssignment(a: AssignmentRow) {
    if (!window.confirm(`Delete "${a.title}"? Submissions received for it are removed too.`)) return;
    setError(null);
    try {
      await del(`/assignments/${a.id}`);
      setNotice(`"${a.title}" was removed — it no longer appears in the parent portal.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to delete assignment");
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Assignments"
        subtitle="Homework you send to your classes — parents see and submit it in the portal"
        actions={<Button onClick={() => setShowCreate(true)}>+ New assignment</Button>}
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      <ErrorNote message={error} />

      <Input
        placeholder="Search assignments by title…"
        className="mb-4 max-w-xs"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
      />

      {!rows ? (
        <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-slate-400">No assignments yet — create one for any of your classes.</Card>
      ) : (
        <div className="space-y-4">
          {rows.map((a) => {
            const total = a.classSubject.classRoom._count.enrollments;
            const overdue = new Date(a.dueDate) < new Date();
            return (
              <Card key={a.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">{a.title}</h2>
                    <p className="text-xs text-slate-500">
                      {a.classSubject.subject.name} · {a.classSubject.classRoom.name} · due {formatDate(a.dueDate)}
                      {overdue && <Badge tone="red">Past due</Badge>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a._count.submissions >= total ? "green" : "blue"}>
                      {a._count.submissions}/{total} submitted
                    </Badge>
                    <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => setViewing(a)}>
                      Review submissions
                    </Button>
                    <Button variant="secondary" className="!px-3 !py-1 text-xs" onClick={() => setEditing(a)}>
                      Edit
                    </Button>
                    <Button variant="danger" className="!px-3 !py-1 text-xs" onClick={() => void removeAssignment(a)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{a.instructions}</p>
                {a.attachmentName && (
                  <button
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                    onClick={() => downloadAttachment(`/assignments/${a.id}/attachment`, a.attachmentName ?? undefined).catch((e) => setError(e.message))}
                  >
                    📎 {a.attachmentName}
                  </button>
                )}
              </Card>
            );
          })}
          {data && <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />}
        </div>
      )}

      {(showCreate || editing) && (
        <AssignmentModal
          mySubjects={mySubjects}
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
      {viewing && <SubmissionsModal assignment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function AssignmentModal({ mySubjects, editing, onClose, onSaved }: {
  mySubjects: MySubject[];
  editing: AssignmentRow | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    classSubjectId: editing?.classSubject.id ?? mySubjects[0]?.id ?? "",
    title: editing?.title ?? "",
    instructions: editing?.instructions ?? "",
    dueDate: editing ? localDateIso(new Date(editing.dueDate)) : "",
  });
  const [attachment, setAttachment] = useState<AttachmentInput | null>(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    try {
      if (editing) {
        await patch(`/assignments/${editing.id}`, {
          title: form.title,
          instructions: form.instructions,
          dueDate: form.dueDate,
          ...(attachment ? { attachment } : {}),
          ...(removeAttachment && !attachment ? { removeAttachment: true } : {}),
        });
        await onSaved("Assignment updated — the change is live in the parent portal.");
      } else {
        await post("/assignments", { ...form, ...(attachment ? { attachment } : {}) });
        await onSaved("Assignment sent to the class.");
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save assignment");
    } finally {
      setSaving(false);
    }
  }

  const currentFileLabel = attachment
    ? attachment.name
    : editing?.attachmentName && !removeAttachment
      ? editing.attachmentName
      : null;

  return (
    <Modal open title={editing ? `Edit — ${editing.title}` : "Send an assignment"} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        {!editing && (
          <Field label="Subject · class" hint="Only the classes and subjects assigned to you">
            <Select value={form.classSubjectId} onChange={(e) => setForm((f) => ({ ...f, classSubjectId: e.target.value }))} required>
              {mySubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subject.name} — {s.classRoom.name} ({s.classRoom._count.enrollments} students)
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Title">
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required maxLength={200} />
        </Field>
        <Field label="Instructions" hint="Parents see this in the portal exactly as written">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={6}
            value={form.instructions}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            required
          />
        </Field>
        <Field label="Due date">
          <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} required />
        </Field>
        <Field label="Attach a document (optional)" hint="PDF, JPG, PNG or Word — max 5 MB; families download it from the portal">
          <div className="space-y-2">
            <Input type="file" accept={ATTACHMENT_ACCEPT} onChange={(e) => void pickFile(e)} />
            {currentFileLabel && (
              <p className="flex items-center gap-2 text-xs text-slate-600">
                📎 {currentFileLabel}
                <button
                  type="button"
                  className="text-rose-600 underline"
                  onClick={() => { setAttachment(null); setRemoveAttachment(true); }}
                >
                  Remove
                </button>
              </p>
            )}
          </div>
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? "Save changes" : "Send to class"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function SubmissionsModal({ assignment, onClose }: { assignment: AssignmentRow; onClose: () => void }) {
  const [detail, setDetail] = useState<{ submissions: SubmissionDetail[] } | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [grade, setGrade] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () => get<{ submissions: SubmissionDetail[] }>(`/assignments/${assignment.id}/submissions`).then(setDetail),
    [assignment.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function saveFeedback(submissionId: string) {
    setSaving(true);
    setError(null);
    try {
      await post(`/assignments/submissions/${submissionId}/feedback`, { feedback, grade: grade || undefined });
      setFeedbackFor(null);
      setFeedback("");
      setGrade("");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save feedback");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Submissions — ${assignment.title}`} onClose={onClose} wide>
      {!detail ? (
        <div className="flex justify-center py-12 text-brand-600"><Spinner /></div>
      ) : detail.submissions.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">No submissions yet.</p>
      ) : (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <ErrorNote message={error} />
          {detail.submissions.map((s) => (
            <div key={s.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-800">
                  {fullName(s.student)} <span className="text-xs font-normal text-slate-400">{s.student.admissionNo}</span>
                </p>
                <p className="text-xs text-slate-400">{new Date(s.submittedAt).toLocaleString()}</p>
              </div>
              {s.content && <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm text-slate-700">{s.content}</p>}
              <div className="mt-1 flex flex-wrap gap-3">
                {s.attachmentName && (
                  <button
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
                    onClick={() => downloadAttachment(`/assignments/submissions/${s.id}/attachment`, s.attachmentName ?? undefined).catch((e) => setError(e.message))}
                  >
                    📎 {s.attachmentName}
                  </button>
                )}
                {s.linkUrl && (
                  <a href={s.linkUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-brand-600 underline">
                    Attached link
                  </a>
                )}
              </div>
              {s.feedback ? (
                <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <p className="text-emerald-800">
                    <span className="font-semibold">Your feedback:</span> {s.feedback}
                    {s.grade && <Badge tone="brand">{s.grade}</Badge>}
                  </p>
                </div>
              ) : feedbackFor === s.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                    rows={2}
                    placeholder="Feedback for the student and their parents…"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Input placeholder="Grade (optional)" className="!w-32" value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={10} />
                    <Button className="!px-3 !py-1.5 text-xs" loading={saving} onClick={() => void saveFeedback(s.id)} disabled={!feedback}>
                      Save feedback
                    </Button>
                    <Button variant="ghost" className="!px-3 !py-1.5 text-xs" onClick={() => setFeedbackFor(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <button className="mt-2 text-xs font-medium text-brand-600 hover:underline" onClick={() => setFeedbackFor(s.id)}>
                  Give feedback
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
