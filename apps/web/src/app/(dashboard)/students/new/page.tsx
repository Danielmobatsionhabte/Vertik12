"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GENDERS, COUNTRIES, ATTACHMENT_ACCEPT, type AttachmentInput } from "@vertik12/shared";
import { get, post, put, ApiClientError } from "@/lib/api";
import { useGrades } from "@/lib/grades";
import { fileToPhoto, fileToAttachment } from "@/lib/files";
import { humanize } from "@/lib/format";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select } from "@/components/ui";
import { WebcamCaptureModal } from "@/components/webcam-capture";
import { Icon } from "@/components/icons";

interface ClassOption {
  id: string;
  name: string;
  gradeLevel: string;
  capacity: number;
  _count: { enrollments: number };
}
interface YearOption { id: string; name: string; isActive: boolean }

interface GuardianForm {
  firstName: string;
  lastName: string;
  relation: string;
  phone: string;
  email: string;
  occupation: string;
  isPrimary: boolean;
}

const emptyGuardian = (isPrimary: boolean): GuardianForm => ({
  firstName: "", lastName: "", relation: "Mother", phone: "", email: "", occupation: "", isPrimary,
});

/**
 * Registrar admission: the full student record — personal, contact,
 * medical — plus one or more parents/guardians, captured in one step.
 */
export default function AdmitStudentPage() {
  const router = useRouter();
  const grades = useGrades();
  const [years, setYears] = useState<YearOption[]>([]);
  const [academicYearId, setAcademicYearId] = useState("");
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    firstName: "", lastName: "", dateOfBirth: "", gender: "FEMALE", gradeLevel: "",
    email: "", phone: "", addressLine1: "", addressLine2: "", city: "", state: "",
    postalCode: "", country: "", nationality: "",
    placeOfBirth: "", bloodGroup: "", medicalNotes: "", classRoomId: "",
  });
  const [guardians, setGuardians] = useState<GuardianForm[]>([emptyGuardian(true)]);
  // Optional student picture — uploaded, phone-captured, or shot with the
  // webcam; saved right after the record is created and changeable later.
  const [photo, setPhoto] = useState<{ name: string; type: string; dataBase64: string } | null>(null);
  // Guardian ID, birth certificate, national ID… — any number of document
  // rows, each captured by webcam or uploaded, saved right after
  // registration. "+" adds another row.
  interface DocRow { label: string; attachment: AttachmentInput | null }
  const [docRows, setDocRows] = useState<DocRow[]>([]);
  // Which target the webcam dialog is shooting for: the student photo, or a
  // document row (by index).
  const [webcamFor, setWebcamFor] = useState<"photo" | number | null>(null);

  const setDocRow = (i: number, patch: Partial<DocRow>) =>
    setDocRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function pickDocFile(i: number, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setDocRow(i, { attachment: await fileToAttachment(file) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the document");
      e.target.value = "";
    }
  }

  // The grade ladder is admin-configured; default to its first entry.
  useEffect(() => {
    if (grades.length > 0 && !grades.some((g) => g.code === form.gradeLevel)) {
      setForm((f) => ({ ...f, gradeLevel: grades[0]!.code, classRoomId: "" }));
    }
  }, [grades]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setPhoto(await fileToPhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the photo");
      e.target.value = "";
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const setGuardian = (i: number, key: keyof GuardianForm) => (e: { target: { value: string } }) =>
    setGuardians((gs) => gs.map((g, idx) => (idx === i ? { ...g, [key]: e.target.value } : g)));

  useEffect(() => {
    get<YearOption[]>("/academics/years").then((ys) => {
      setYears(ys);
      const active = ys.find((y) => y.isActive) ?? ys[0];
      if (active) setAcademicYearId(active.id);
    });
  }, []);

  // Classes belong to an academic year — the enrollment lands in that year.
  useEffect(() => {
    if (!academicYearId) return;
    get<ClassOption[]>(`/academics/classes?academicYearId=${academicYearId}`)
      .then(setClasses)
      .catch(() => setClasses([]));
    setForm((f) => ({ ...f, classRoomId: "" }));
  }, [academicYearId]);

  const gradeClasses = classes.filter((c) => c.gradeLevel === form.gradeLevel);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const filledGuardians = guardians.filter((g) => g.firstName.trim());
    if (filledGuardians.length === 0) {
      setError("At least one parent/guardian is required for a complete registration.");
      return;
    }

    setSaving(true);
    try {
      const student = await post<{ id: string }>("/students", {
        firstName: form.firstName,
        lastName: form.lastName,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        gradeLevel: form.gradeLevel,
        email: form.email || undefined,
        phone: form.phone || undefined,
        addressLine1: form.addressLine1 || undefined,
        addressLine2: form.addressLine2 || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        postalCode: form.postalCode || undefined,
        country: form.country || undefined,
        nationality: form.nationality || undefined,
        placeOfBirth: form.placeOfBirth || undefined,
        bloodGroup: form.bloodGroup || undefined,
        medicalNotes: form.medicalNotes || undefined,
        classRoomId: form.classRoomId || undefined,
        guardians: filledGuardians.map((g, i) => ({
          firstName: g.firstName,
          lastName: g.lastName || form.lastName,
          relation: g.relation,
          phone: g.phone,
          email: g.email || undefined,
          occupation: g.occupation || undefined,
          isPrimary: i === 0 ? true : g.isPrimary,
        })),
      });
      // Photo + documents are optional extras — a failed upload must not
      // undo the admission itself.
      if (photo) {
        await put(`/students/${student.id}/photo`, photo).catch(() => undefined);
      }
      for (const row of docRows) {
        if (!row.attachment) continue;
        await post(`/students/${student.id}/documents`, {
          label: row.label.trim() || "Document",
          attachment: row.attachment,
        }).catch(() => undefined);
      }
      router.push(`/students/${student.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to admit student");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Register a student"
        subtitle="Full student record with parents/guardians and class enrolment — created in one step"
      />
      <form onSubmit={onSubmit} className="space-y-6">
        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700">Student details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} required /></Field>
            <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} required /></Field>
            <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} required /></Field>
            <Field label="Gender">
              <Select value={form.gender} onChange={set("gender")}>
                {GENDERS.map((g) => <option key={g} value={g}>{humanize(g)}</option>)}
              </Select>
            </Field>
            <Field label="Grade level">
              <Select value={form.gradeLevel} onChange={(e) => setForm((f) => ({ ...f, gradeLevel: e.target.value, classRoomId: "" }))}>
                {grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
              </Select>
            </Field>
            <Field label="Academic year" hint="The enrollment is created for this year">
              <Select value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (current)" : ""}</option>)}
              </Select>
            </Field>
            <Field
              label="Class / section (optional)"
              hint="Enrolled/capacity is shown per section — full sections can't take more students"
            >
              <Select value={form.classRoomId} onChange={set("classRoomId")}>
                <option value="">— Assign later —</option>
                {gradeClasses.map((c) => {
                  const full = c._count.enrollments >= c.capacity;
                  return (
                    <option key={c.id} value={c.id} disabled={full}>
                      {c.name} — {c._count.enrollments}/{c.capacity} students{full ? " (FULL)" : ""}
                    </option>
                  );
                })}
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
            <Field label="Blood group">
              <Select value={form.bloodGroup} onChange={set("bloodGroup")}>
                <option value="">Unknown</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}
              </Select>
            </Field>
          </div>

          {/* Optional photo — upload a file or capture with the phone camera. */}
          <Field label="Student photo (optional)" hint="JPG/PNG, max 2 MB — on a phone this opens the camera; it can be changed any time on the student's profile">
            <div className="flex items-center gap-4">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:${photo.type};base64,${photo.dataBase64}`}
                  alt="Student preview"
                  className="h-20 w-20 rounded-xl object-cover ring-2 ring-brand-200"
                />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-2xl text-slate-400"><Icon name="camera" className="h-8 w-8" /></span>
              )}
              <div className="space-y-1.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="file" accept="image/jpeg,image/png" capture="user" className="!w-auto" onChange={(e) => void pickPhoto(e)} />
                  <Button type="button" variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => setWebcamFor("photo")}>
                    <Icon name="camera" className="h-3.5 w-3.5" /> Use webcam
                  </Button>
                </div>
                {photo && (
                  <button type="button" className="text-xs font-medium text-rose-600 hover:underline" onClick={() => setPhoto(null)}>
                    Remove photo
                  </button>
                )}
              </div>
            </div>
          </Field>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700">Contact & address</h2>
          <p className="text-xs text-slate-400">All address fields are optional — fill in whatever the family provides.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Student email (optional)"><Input type="email" value={form.email} onChange={set("email")} /></Field>
            <Field label="Student phone (optional)"><Input value={form.phone} onChange={set("phone")} /></Field>
            <Field label="Street address"><Input value={form.addressLine1} onChange={set("addressLine1")} placeholder="e.g. 421 Maple Avenue" /></Field>
            <Field label="Unit / Apt / Suite"><Input value={form.addressLine2} onChange={set("addressLine2")} placeholder="e.g. Apt 4B" /></Field>
            <Field label="City"><Input value={form.city} onChange={set("city")} /></Field>
            <Field label="State / Province"><Input value={form.state} onChange={set("state")} /></Field>
            <Field label="ZIP / Postal code"><Input value={form.postalCode} onChange={set("postalCode")} maxLength={20} /></Field>
            <Field label="Country">
              <Select value={form.country} onChange={set("country")}>
                <option value="">— Select —</option>
                {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700">Medical information</h2>
          <Field label="Medical notes / allergies (optional)" hint="Visible to staff and, view-only, to the family in the parent portal">
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              rows={3}
              value={form.medicalNotes}
              onChange={(e) => setForm((f) => ({ ...f, medicalNotes: e.target.value }))}
            />
          </Field>
        </Card>

        <Card className="space-y-5 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Parents / guardians</h2>
            <button
              type="button"
              className="text-sm font-medium text-brand-600 hover:underline"
              onClick={() => setGuardians((gs) => [...gs, emptyGuardian(false)])}
            >
              + Add another guardian
            </button>
          </div>
          {guardians.map((g, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Guardian {i + 1} {i === 0 && "(primary)"}
                </p>
                {i > 0 && (
                  <button type="button" className="text-xs text-rose-600 hover:underline"
                    onClick={() => setGuardians((gs) => gs.filter((_, idx) => idx !== i))}>
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name"><Input value={g.firstName} onChange={setGuardian(i, "firstName")} required={i === 0} /></Field>
                <Field label="Last name"><Input value={g.lastName} onChange={setGuardian(i, "lastName")} placeholder="Defaults to student's" /></Field>
                <Field label="Relation">
                  <Select value={g.relation} onChange={setGuardian(i, "relation")}>
                    {["Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => <option key={r}>{r}</option>)}
                  </Select>
                </Field>
                <Field label="Phone"><Input value={g.phone} onChange={setGuardian(i, "phone")} required={!!g.firstName} /></Field>
                <Field label="Email"><Input type="email" value={g.email} onChange={setGuardian(i, "email")} /></Field>
                <Field label="Occupation"><Input value={g.occupation} onChange={setGuardian(i, "occupation")} /></Field>
              </div>
            </div>
          ))}
        </Card>

        <Card className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Documents on file (optional)</h2>
            <button
              type="button"
              className="text-sm font-medium text-brand-600 hover:underline"
              onClick={() => setDocRows((rows) => [...rows, { label: "", attachment: null }])}
            >
              + Add document
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Add as many as needed — guardian&apos;s ID, birth certificate, national ID, transfer letter,
            immunisation card… Photograph with the webcam or upload scans (PDF/JPG/PNG/Word, max 5 MB each).
            More can be added later on the student&apos;s profile.
          </p>

          {docRows.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
              No documents added — use <span className="font-medium text-brand-600">+ Add document</span> above.
            </p>
          )}

          {docRows.map((row, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Document {i + 1}</p>
                <button
                  type="button"
                  className="text-xs font-medium text-rose-600 hover:underline"
                  onClick={() => setDocRows((rows) => rows.filter((_, idx) => idx !== i))}
                >
                  <Icon name="x" className="mr-0.5 inline h-3 w-3" />Remove
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="What is this document?">
                  <Input
                    value={row.label}
                    onChange={(e) => setDocRow(i, { label: e.target.value })}
                    maxLength={100}
                    placeholder="e.g. Guardian ID — Father, Birth certificate…"
                    className="!w-64"
                  />
                </Field>
                {row.attachment ? (
                  <p className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                    <Icon name="file" className="h-4 w-4" /> <span className="font-medium">{row.attachment.name}</span>
                    <button type="button" className="text-xs text-rose-600 underline" onClick={() => setDocRow(i, { attachment: null })}>
                      change
                    </button>
                  </p>
                ) : (
                  <>
                    <Field label="Upload a file">
                      <Input type="file" accept={ATTACHMENT_ACCEPT} className="!w-auto" onChange={(e) => void pickDocFile(i, e)} />
                    </Field>
                    <Button type="button" variant="secondary" onClick={() => setWebcamFor(i)}><Icon name="camera" className="h-4 w-4" /> Webcam</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>

        <ErrorNote message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={saving}>Register student</Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>

      {webcamFor !== null && (
        <WebcamCaptureModal
          title={webcamFor === "photo"
            ? "Take the student's photo"
            : `Photograph: ${docRows[webcamFor]?.label.trim() || `Document ${webcamFor + 1}`}`}
          onClose={() => setWebcamFor(null)}
          onCapture={(image) => {
            if (webcamFor === "photo") {
              setPhoto(image);
            } else {
              setDocRow(webcamFor, { attachment: image });
            }
          }}
        />
      )}
    </div>
  );
}
