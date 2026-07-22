"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouteId } from "@/lib/use-route-id";
import Link from "next/link";
import { STUDENT_STATUSES, COUNTRIES, ATTACHMENT_ACCEPT } from "@vertik12/shared";
import { useGrades } from "@/lib/grades";
import { get, post, put, patch, del, getSession, ApiClientError } from "@/lib/api";
import { fileToPhoto, fileToAttachment, downloadAttachment } from "@/lib/files";
import { formatDate, formatMoney, fullName, gradeLabel, humanize } from "@/lib/format";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, StatCard } from "@/components/ui";
import { DataTable } from "@/components/data-table";
import { StudentPhoto } from "@/components/student-photo";
import { WebcamCaptureModal } from "@/components/webcam-capture";
import { Icon } from "@/components/icons";

/** A class of the active year, with its occupancy so a full section shows it. */
interface SectionOption {
  id: string;
  name: string;
  gradeLevel: string;
  capacity: number;
  _count: { enrollments: number };
}

interface StudentProfile {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  gradeLevel: string;
  status: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  nationality?: string | null;
  placeOfBirth?: string | null;
  photoRef?: string | null;
  attendanceRate: number | null;
  // null when the viewer's role may not see this data (teacher ⇒ no finance,
  // accountant ⇒ no results) — the API strips it server-side.
  financeSummary: { invoiced: number; paid: number; outstanding: number } | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  medicalNotes?: string | null;
  guardians: Array<{ relation: string; isPrimary: boolean; guardian: { id: string; firstName: string; lastName: string; phone: string; email?: string | null; userId?: string | null } }>;
  enrollments: Array<{ id: string; classRoom: { id: string; name: string }; academicYear: { name: string }; status: string }>;
  invoices: Array<{ id: string; number: string; status: string; dueDate: string; items: Array<{ amount: number }> }> | null;
  /** Every payment taken against this student's invoices for the viewed year. */
  transactions: Array<{
    id: string;
    amount: number;
    method: string;
    status: string;
    paidAt: string | null;
    createdAt: string;
    invoice: { id: string; number: string; currency: string };
  }> | null;
  examResults: Array<{ id: string; marks: number; maxMarks: number; grade: string; subject: { name: string }; exam: { name: string; term: { name: string } } }> | null;
  /** The school's admin-configured billing currency — every money value uses it. */
  currency: string;
  /** The academic year the invoices/summary cover (defaults to the active year). */
  financeYear: { id: string; name: string; isActive: boolean } | null;
}

export default function StudentProfilePage() {
  const id = useRouteId("id", "students");
  if (!id) return null;
  return <StudentProfileView id={id} />;
}

function StudentProfileView({ id }: { id: string }) {
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [portalFor, setPortalFor] = useState<StudentProfile["guardians"][number] | null>(null);
  const [guardianModal, setGuardianModal] = useState<
    { mode: "add" } | { mode: "edit"; link: StudentProfile["guardians"][number] } | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [webcamFor, setWebcamFor] = useState<"photo" | "doc" | null>(null);
  const [docs, setDocs] = useState<Array<{ id: string; label: string; fileName: string; fileType: string; createdAt: string }> | null>(null);
  const [docLabel, setDocLabel] = useState("Guardian ID");
  // Billing follows the admin's active year by default; the selector on the
  // Invoices card switches to any other year (previous ones included).
  const [financeYearId, setFinanceYearId] = useState("");
  const [years, setYears] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);

  useEffect(() => {
    get<Array<{ id: string; name: string; isActive: boolean }>>("/academics/years")
      .then(setYears)
      .catch(() => setYears([]));
  }, []);

  const canManage = ["SUPER_ADMIN", "ADMIN", "REGISTRAR"].includes(getSession()?.user.role ?? "");

  const loadDocs = useCallback(
    () => get<Array<{ id: string; label: string; fileName: string; fileType: string; createdAt: string }>>(`/students/${id}/documents`)
      .then(setDocs)
      .catch(() => setDocs([])),
    [id],
  );
  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  /** Save an already-encoded photo (from a file pick or a webcam capture). */
  async function savePhoto(photo: { name: string; type: string; dataBase64: string }) {
    setPhotoBusy(true);
    setNotice(null);
    try {
      await put(`/students/${id}/photo`, photo);
      setPhotoVersion((v) => v + 1);
      setNotice("Student photo updated.");
      await load();
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Failed to upload the photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  /** Upload or replace the student picture (also handles phone-camera captures). */
  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNotice(null);
    try {
      await savePhoto(await fileToPhoto(file));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to upload the photo");
    } finally {
      e.target.value = "";
    }
  }

  /** Add a document (guardian ID, certificate…) from a picked file. */
  async function pickDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setNotice(null);
    try {
      const attachment = await fileToAttachment(file);
      await post(`/students/${id}/documents`, { label: docLabel.trim() || "Document", attachment });
      setDocLabel("Guardian ID");
      setNotice("Document saved to the student's file.");
      await loadDocs();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to save the document");
    } finally {
      e.target.value = "";
    }
  }

  async function removeDoc(doc: { id: string; label: string }) {
    if (!window.confirm(`Remove "${doc.label}" from the student's file?`)) return;
    try {
      await del(`/students/${id}/documents/${doc.id}`);
      await loadDocs();
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Failed to remove the document");
    }
  }

  async function removePhoto() {
    if (!window.confirm("Remove this student's photo?")) return;
    setPhotoBusy(true);
    try {
      await del(`/students/${id}/photo`);
      setPhotoVersion((v) => v + 1);
      setNotice("Student photo removed.");
      await load();
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : "Failed to remove the photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  const load = useCallback(
    () =>
      get<StudentProfile>(`/students/${id}${financeYearId ? `?academicYearId=${financeYearId}` : ""}`)
        .then(setStudent)
        .catch((e) => setError(e.message)),
    [id, financeYearId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!student)
    return (
      <div className="flex justify-center py-24 text-brand-600">
        <Spinner />
      </div>
    );

  return (
    <div>
      <PageHeader
        title={fullName(student)}
        subtitle={`${student.admissionNo} · ${gradeLabel(student.gradeLevel)} · ${student.enrollments[0]?.classRoom.name ?? "No class"}`}
        actions={
          <div className="flex items-center gap-3">
            {canManage && <Button variant="secondary" onClick={() => setShowEdit(true)}>Edit student</Button>}
            <Link href={`/students/${student.id}/report-card`}>
              <Button variant="secondary">Report card</Button>
            </Link>
            <Badge>{student.status}</Badge>
          </div>
        }
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice} <button className="ml-2 underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Attendance rate" value={student.attendanceRate === null ? "—" : `${student.attendanceRate}%`} />
        {student.financeSummary && (
          <>
            <StatCard label="Invoiced" value={formatMoney(student.financeSummary.invoiced, student.currency)} detail={student.financeYear?.name ?? "all years"} />
            <StatCard label="Paid" value={formatMoney(student.financeSummary.paid, student.currency)} detail={student.financeYear?.name ?? "all years"} />
            <StatCard label="Outstanding" value={formatMoney(student.financeSummary.outstanding, student.currency)} detail={student.financeYear?.name ?? "all years"} />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Finance data is absent for teachers (not their responsibility). */}
          {student.invoices && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-3">
                <h2 className="text-sm font-semibold text-slate-700">
                  Invoices{student.financeYear ? ` — ${student.financeYear.name}` : ""}
                </h2>
                {years.length > 0 && (
                  <Select
                    className="!w-48"
                    value={financeYearId || student.financeYear?.id || ""}
                    onChange={(e) => setFinanceYearId(e.target.value)}
                    title="Show this student's billing for another academic year"
                  >
                    {years.map((y) => (
                      <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>
                    ))}
                  </Select>
                )}
              </div>
              <DataTable
                rows={student.invoices}
                keyFor={(i) => i.id}
                emptyTitle={`No invoices${student.financeYear ? ` in ${student.financeYear.name}` : ""}`}
                columns={[
                  { header: "Number", cell: (i) => <span className="font-mono text-xs">{i.number}</span> },
                  { header: "Due", cell: (i) => formatDate(i.dueDate) },
                  { header: "Amount", align: "right", cell: (i) => formatMoney(i.items.reduce((s, it) => s + it.amount, 0), student.currency) },
                  { header: "Status", cell: (i) => <Badge>{i.status}</Badge> },
                ]}
              />
            </Card>
          )}

          {/* Payments taken against this student — a collection shows here the
              moment it is recorded, tied to this student's personal record. */}
          {student.transactions && (
            <Card>
              <h2 className="border-b border-slate-100 px-6 py-3 text-sm font-semibold text-slate-700">
                Transactions{student.financeYear ? ` — ${student.financeYear.name}` : ""}
              </h2>
              <DataTable
                rows={student.transactions}
                keyFor={(t) => t.id}
                emptyTitle={`No payments${student.financeYear ? ` in ${student.financeYear.name}` : ""}`}
                columns={[
                  { header: "Date", cell: (t) => formatDate(t.paidAt ?? t.createdAt) },
                  { header: "Invoice", cell: (t) => <span className="font-mono text-xs">{t.invoice.number}</span> },
                  { header: "Method", cell: (t) => humanize(t.method) },
                  { header: "Amount", align: "right", cell: (t) => <span className="font-medium text-emerald-600">{formatMoney(t.amount, t.invoice.currency || student.currency)}</span> },
                  { header: "Status", cell: (t) => <Badge>{t.status}</Badge> },
                ]}
              />
            </Card>
          )}

          {/* Exam results are absent for accountants (not their responsibility). */}
          {student.examResults && (
            <Card>
              <h2 className="border-b border-slate-100 px-6 py-4 text-sm font-semibold text-slate-700">Recent exam results</h2>
              <DataTable
                rows={student.examResults}
                keyFor={(r) => r.id}
                emptyTitle="No results recorded"
                columns={[
                  { header: "Subject", cell: (r) => r.subject.name },
                  { header: "Exam", cell: (r) => `${r.exam.name} (${r.exam.term.name})` },
                  { header: "Marks", align: "right", cell: (r) => `${r.marks}/${r.maxMarks}` },
                  { header: "Grade", cell: (r) => <Badge tone="brand">{r.grade}</Badge> },
                ]}
              />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Personal</h2>

            {/* Photo — optional; the registrar/admin can upload, capture or replace it any time. */}
            <div className="mb-4 flex items-center gap-4">
              <StudentPhoto
                studentId={student.id}
                hasPhoto={!!student.photoRef}
                name={student}
                version={photoVersion}
                className="h-20 w-20 rounded-xl text-xl"
              />
              {canManage && (
                <div className="space-y-1.5 text-xs">
                  <label className="block cursor-pointer font-medium text-brand-600 hover:underline">
                    {photoBusy ? "Uploading…" : (<><Icon name="camera" className="mr-1 inline h-3.5 w-3.5" />{student.photoRef ? "Change photo" : "Add photo"}</>)}
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      capture="user"
                      className="hidden"
                      disabled={photoBusy}
                      onChange={(e) => void pickPhoto(e)}
                    />
                  </label>
                  <button className="block font-medium text-brand-600 hover:underline" disabled={photoBusy} onClick={() => setWebcamFor("photo")}>
                    <Icon name="camera" className="mr-1 inline h-3.5 w-3.5" />Shoot with webcam
                  </button>
                  {student.photoRef && (
                    <button className="block font-medium text-rose-600 hover:underline" disabled={photoBusy} onClick={() => void removePhoto()}>
                      Remove photo
                    </button>
                  )}
                  <p className="text-slate-400">JPG/PNG, max 2 MB — phones open the camera</p>
                </div>
              )}
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Date of birth</dt><dd>{formatDate(student.dateOfBirth)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Gender</dt><dd className="capitalize">{student.gender.toLowerCase()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Citizenship</dt><dd>{student.nationality ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Place of birth</dt><dd>{student.placeOfBirth ?? "—"}</dd></div>
              <div className="flex justify-between gap-4">
                <dt className="shrink-0 text-slate-500">Address</dt>
                <dd className="text-right">
                  {[
                    [student.addressLine1, student.addressLine2].filter(Boolean).join(", "),
                    [student.city, student.state, student.postalCode].filter(Boolean).join(", "),
                    student.country,
                  ].filter(Boolean).join(" · ") || "—"}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Documents on file — guardian ID, certificates… (staff view; registrar/admin manage) */}
          <Card className="p-6">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Documents on file</h2>
            {!docs ? (
              <div className="flex justify-center py-6 text-brand-600"><Spinner /></div>
            ) : docs.length === 0 ? (
              <p className="py-2 text-sm text-slate-400">No documents yet.</p>
            ) : (
              <ul className="list-scroll divide-y divide-slate-100">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-2 text-sm">
                    <Icon name="file" className="h-4 w-4 text-slate-400" />
                    <button
                      className="min-w-0 flex-1 truncate text-left font-medium text-brand-600 hover:underline"
                      title={`${d.fileName} · ${formatDate(d.createdAt)}`}
                      onClick={() => downloadAttachment(`/students/${id}/documents/${d.id}`, d.fileName).catch((e) => setNotice(e.message))}
                    >
                      {d.label}
                    </button>
                    {canManage && (
                      <button className="text-xs font-medium text-rose-600 hover:underline" onClick={() => void removeDoc(d)}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <Input value={docLabel} onChange={(e) => setDocLabel(e.target.value)} maxLength={100} placeholder="Document label, e.g. Guardian ID — Father" />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="cursor-pointer font-medium text-brand-600 hover:underline">
                    <Icon name="paperclip" className="mr-1 inline h-3.5 w-3.5" />Upload file
                    <input type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => void pickDocFile(e)} />
                  </label>
                  <button className="font-medium text-brand-600 hover:underline" onClick={() => setWebcamFor("doc")}>
                    <Icon name="camera" className="mr-1 inline h-3.5 w-3.5" />Photograph with webcam
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Guardians & parent portal</h2>
              {canManage && (
                <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setGuardianModal({ mode: "add" })}>
                  + Add guardian
                </button>
              )}
            </div>
            <ul className="space-y-4">
              {student.guardians.map((g, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium text-slate-800">
                    {g.guardian.firstName} {g.guardian.lastName}{" "}
                    {g.isPrimary && <Badge tone="brand">Primary</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{g.relation} · {g.guardian.phone}</p>
                  {g.guardian.email && <p className="text-xs text-slate-400">{g.guardian.email}</p>}
                  <p className="mt-1 flex items-center gap-3">
                    {g.guardian.userId ? (
                      <Badge tone="green">Portal access active</Badge>
                    ) : canManage ? (
                      <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setPortalFor(g)}>
                        Register parent portal account
                      </button>
                    ) : (
                      <Badge tone="gray">No portal access</Badge>
                    )}
                    {canManage && (
                      <button className="text-xs font-medium text-slate-500 hover:underline" onClick={() => setGuardianModal({ mode: "edit", link: g })}>
                        Edit
                      </button>
                    )}
                  </p>
                </li>
              ))}
              {student.guardians.length === 0 && <p className="text-sm text-slate-400">None on record.</p>}
            </ul>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Enrolment history</h2>
            <ul className="space-y-3">
              {student.enrollments.map((e) => (
                <li key={e.id} className="flex items-center justify-between text-sm">
                  <span>{e.classRoom.name} <span className="text-xs text-slate-400">({e.academicYear.name})</span></span>
                  <Badge>{e.status}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {showEdit && (
        <EditStudentModal
          student={student}
          onClose={() => setShowEdit(false)}
          onSaved={async () => {
            setShowEdit(false);
            setNotice("Student record updated.");
            await load();
          }}
        />
      )}
      {guardianModal && (
        <GuardianModal
          studentId={student.id}
          link={guardianModal.mode === "edit" ? guardianModal.link : null}
          onClose={() => setGuardianModal(null)}
          onSaved={async () => {
            setGuardianModal(null);
            setNotice("Guardian saved.");
            await load();
          }}
        />
      )}
      {portalFor && (
        <PortalAccountModal
          studentId={student.id}
          link={portalFor}
          onClose={() => setPortalFor(null)}
          onCreated={async (email, tempPassword) => {
            setPortalFor(null);
            setNotice(`Parent portal account created for ${email}. Temporary password: ${tempPassword} — share it securely; they sign in at the same address and see only their own children.`);
            await load();
          }}
        />
      )}
      {webcamFor && (
        <WebcamCaptureModal
          title={webcamFor === "photo" ? "Take the student's photo" : `Photograph: ${docLabel.trim() || "Document"}`}
          onClose={() => setWebcamFor(null)}
          onCapture={(image) => {
            if (webcamFor === "photo") {
              void savePhoto(image);
            } else {
              void post(`/students/${id}/documents`, { label: docLabel.trim() || "Document", attachment: image })
                .then(async () => {
                  setDocLabel("Guardian ID");
                  setNotice("Document saved to the student's file.");
                  await loadDocs();
                })
                .catch((err) => setNotice(err instanceof ApiClientError ? err.message : "Failed to save the document"));
            }
          }}
        />
      )}
    </div>
  );
}

/** Admin/Registrar: modify the student's information. */
function EditStudentModal({ student, onClose, onSaved }: {
  student: StudentProfile;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const grades = useGrades();
  // Sections of the active year, so the registrar can move the student
  // between them (Grade 5 — A → Grade 5 — B) from the same form that owns
  // the grade level. The list narrows to the grade currently selected,
  // because the API refuses a section of any other grade.
  const [classes, setClasses] = useState<SectionOption[]>([]);
  const [form, setForm] = useState({
    firstName: student.firstName,
    lastName: student.lastName,
    gradeLevel: student.gradeLevel,
    classRoomId: student.enrollments[0]?.classRoom.id ?? "",
    status: student.status,
    phone: student.phone ?? "",
    email: student.email ?? "",
    addressLine1: student.addressLine1 ?? "",
    addressLine2: student.addressLine2 ?? "",
    city: student.city ?? "",
    state: student.state ?? "",
    postalCode: student.postalCode ?? "",
    country: student.country ?? "",
    nationality: student.nationality ?? "",
    placeOfBirth: student.placeOfBirth ?? "",
    medicalNotes: student.medicalNotes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    // No academicYearId ⇒ the active year, which is the only one a student
    // can be moved within from here.
    get<SectionOption[]>("/academics/classes").then(setClasses).catch(() => setClasses([]));
  }, []);

  // Changing the grade invalidates the chosen section, so clear it rather
  // than submit a pair the API will (correctly) reject.
  const sectionsForGrade = classes.filter((c) => c.gradeLevel === form.gradeLevel);
  useEffect(() => {
    setForm((f) =>
      f.classRoomId && !classes.some((c) => c.id === f.classRoomId && c.gradeLevel === f.gradeLevel)
        ? { ...f, classRoomId: "" }
        : f,
    );
  }, [classes, form.gradeLevel]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await patch(`/students/${student.id}`, {
        ...form,
        // Omitted entirely when blank, so saving other fields never clears
        // an existing enrollment.
        classRoomId: form.classRoomId || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        addressLine1: form.addressLine1 || undefined,
        addressLine2: form.addressLine2 || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        postalCode: form.postalCode || undefined,
        country: form.country || undefined,
        nationality: form.nationality || undefined,
        placeOfBirth: form.placeOfBirth || undefined,
        medicalNotes: form.medicalNotes || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Edit — ${fullName(student)}`} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} required /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} required /></Field>
          <Field label="Grade level">
            <Select value={form.gradeLevel} onChange={set("gradeLevel")}>
              {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
            </Select>
          </Field>
          <Field
            label="Class / section"
            hint={
              sectionsForGrade.length === 0
                ? `No sections exist for ${gradeLabel(form.gradeLevel)} in the current year`
                : "Moving a student here reassigns them in the current academic year"
            }
          >
            <Select value={form.classRoomId} onChange={set("classRoomId")}>
              <option value="">— Not assigned —</option>
              {sectionsForGrade.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c._count.enrollments}/{c.capacity})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
          </Field>
          <Field label="Phone"><Input value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Street address"><Input value={form.addressLine1} onChange={set("addressLine1")} /></Field>
          <Field label="Unit / Apt / Suite"><Input value={form.addressLine2} onChange={set("addressLine2")} /></Field>
          <Field label="City"><Input value={form.city} onChange={set("city")} /></Field>
          <Field label="State / Province"><Input value={form.state} onChange={set("state")} /></Field>
          <Field label="ZIP / Postal code"><Input value={form.postalCode} onChange={set("postalCode")} maxLength={20} /></Field>
          <Field label="Country">
            <Select value={form.country} onChange={set("country")}>
              <option value="">— Select —</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Country of citizenship">
            <Select value={form.nationality} onChange={set("nationality")}>
              <option value="">— Select —</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Place of birth">
            <Select value={form.placeOfBirth} onChange={set("placeOfBirth")}>
              <option value="">— Select —</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Medical notes">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            rows={2}
            value={form.medicalNotes}
            onChange={(e) => setForm((f) => ({ ...f, medicalNotes: e.target.value }))}
          />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Add a guardian, or edit one — including the login email, which stays in
 * sync with their portal account if they already have one.
 */
function GuardianModal({ studentId, link, onClose, onSaved }: {
  studentId: string;
  link: StudentProfile["guardians"][number] | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    firstName: link?.guardian.firstName ?? "",
    lastName: link?.guardian.lastName ?? "",
    relation: link?.relation ?? "Mother",
    phone: link?.guardian.phone ?? "",
    email: link?.guardian.email ?? "",
    isPrimary: link?.isPrimary ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = { ...form, email: form.email || undefined };
    try {
      if (link) await patch(`/students/${studentId}/guardians/${link.guardian.id}`, payload);
      else await post(`/students/${studentId}/guardians`, payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save guardian");
      setSaving(false);
    }
  }

  return (
    <Modal open title={link ? `Edit guardian — ${link.guardian.firstName}` : "Add a guardian"} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} required /></Field>
          <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} required /></Field>
          <Field label="Relation">
            <Select value={form.relation} onChange={set("relation")}>
              {["Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Phone"><Input value={form.phone} onChange={set("phone")} required /></Field>
        </div>
        <Field
          label="Email (login email)"
          hint={link?.guardian.userId ? "Changing this also changes their portal sign-in email" : "Used when registering their portal account"}
        >
          <Input type="email" value={form.email} onChange={set("email")} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.isPrimary}
            onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} />
          Primary contact
        </label>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{link ? "Save changes" : "Add guardian"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Registrar: turn a guardian record into a parent portal login. */
function PortalAccountModal({ studentId, link, onClose, onCreated }: {
  studentId: string;
  link: StudentProfile["guardians"][number];
  onClose: () => void;
  onCreated: (email: string, tempPassword: string) => Promise<void>;
}) {
  const [email, setEmail] = useState(link.guardian.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await post<{ email: string; temporaryPassword: string }>(
        `/students/${studentId}/guardians/${link.guardian.id}/portal-account`,
        { email },
      );
      await onCreated(result.email, result.temporaryPassword);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to create account");
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Parent portal — ${link.guardian.firstName} ${link.guardian.lastName}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Creates the web-portal login for this {link.relation.toLowerCase()}. Once registered, they can sign in and
          see <strong>only their own children's</strong> grades, attendance, assignments and fees.
        </p>
        <Field label="Login email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Create portal account</Button>
        </div>
      </form>
    </Modal>
  );
}
