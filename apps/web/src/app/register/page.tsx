"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  BRAND, GENDERS, COUNTRIES, ATTACHMENT_ACCEPT,
  PUBLIC_REGISTRATION_MAX_DOCUMENTS, PUBLIC_REGISTRATION_MAX_UPLOAD_BYTES,
  type AttachmentInput,
} from "@vertik12/shared";
import { get, post, ApiClientError } from "@/lib/api";
import { fileToPhoto, fileToAttachment } from "@/lib/files";
import { humanize } from "@/lib/format";
import { Button, ErrorNote, Field, Input, Select, Spinner, cx } from "@/components/ui";
import { WebcamCaptureModal } from "@/components/webcam-capture";
import { Icon } from "@/components/icons";

/**
 * Public admissions form — the only page where someone with no account
 * writes to the system.
 *
 * Parents register a child themselves while the school's registration
 * window is open. Everything the office needs is captured in one pass
 * (details, guardians, photo, supporting documents) because the family
 * gets no session to come back and finish with: the submission is a single
 * request, and it lands as a PENDING record for the registrar to review.
 */

interface RegistrationStatus {
  open: boolean;
  note?: string | null;
  schoolName: string;
  grades: Array<{ code: string; name: string }>;
}

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

interface DocRow { label: string; attachment: AttachmentInput | null }

export default function RegisterPage() {
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ reference: string; studentName: string; emailedTo: string[] } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The question the school asks first: is this a child already on the
  // roll, or a brand-new applicant? It changes what the registrar does with
  // the submission, so it is answered before anything else is filled in.
  const [isReturning, setIsReturning] = useState<boolean | null>(null);
  const [priorAdmissionNo, setPriorAdmissionNo] = useState("");

  const [form, setForm] = useState({
    firstName: "", lastName: "", dateOfBirth: "", gender: "FEMALE", gradeLevel: "",
    email: "", phone: "", addressLine1: "", addressLine2: "", city: "", state: "",
    postalCode: "", country: "", nationality: "", placeOfBirth: "", bloodGroup: "", medicalNotes: "",
  });
  const [guardians, setGuardians] = useState<GuardianForm[]>([emptyGuardian(true)]);
  const [photo, setPhoto] = useState<{ name: string; type: string; dataBase64: string } | null>(null);
  const [docRows, setDocRows] = useState<DocRow[]>([]);
  const [webcamFor, setWebcamFor] = useState<"photo" | number | null>(null);

  useEffect(() => {
    get<RegistrationStatus>("/registration/status")
      .then((s) => {
        setStatus(s);
        // Default to the school's first grade so the dropdown is never blank.
        if (s.grades[0]) setForm((f) => ({ ...f, gradeLevel: s.grades[0]!.code }));
      })
      .catch(() => setStatusError("We could not reach the school's registration service. Please try again shortly."));
  }, []);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const setGuardian = (i: number, key: keyof GuardianForm) => (e: { target: { value: string } }) =>
    setGuardians((gs) => gs.map((g, idx) => (idx === i ? { ...g, [key]: e.target.value } : g)));

  const setDocRow = (i: number, patch: Partial<DocRow>) =>
    setDocRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

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

  // Everything travels in one request, so the running total is worth showing
  // — a family finds out before submitting, not after a rejected upload.
  const uploadedBase64 =
    (photo?.dataBase64.length ?? 0) + docRows.reduce((n, r) => n + (r.attachment?.dataBase64.length ?? 0), 0);
  const uploadedBytes = Math.round((uploadedBase64 * 3) / 4);
  const overUploadLimit = uploadedBytes > PUBLIC_REGISTRATION_MAX_UPLOAD_BYTES;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (isReturning === null) {
      setError("Please tell us first whether this is a new or an existing student.");
      return;
    }
    const filledGuardians = guardians.filter((g) => g.firstName.trim());
    if (filledGuardians.length === 0) {
      setError("At least one parent or guardian is required.");
      return;
    }
    if (!filledGuardians.some((g) => g.email.trim())) {
      setError("Please give an email address for at least one parent/guardian — that is where your confirmation is sent.");
      return;
    }
    const unlabelled = docRows.filter((r) => r.attachment && !r.label.trim());
    if (unlabelled.length > 0) {
      setError("Please say what each uploaded document is (e.g. “Birth certificate”).");
      return;
    }
    if (overUploadLimit) {
      setError("The photo and documents are too large together — remove one or upload smaller scans.");
      return;
    }

    setSaving(true);
    try {
      const result = await post<{ reference: string; studentName: string; emailedTo: string[] }>("/registration", {
        firstName: form.firstName,
        lastName: form.lastName,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        gradeLevel: form.gradeLevel,
        isReturning,
        priorAdmissionNo: isReturning && priorAdmissionNo.trim() ? priorAdmissionNo.trim() : undefined,
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
        guardians: filledGuardians.map((g, i) => ({
          firstName: g.firstName,
          lastName: g.lastName || form.lastName,
          relation: g.relation,
          phone: g.phone,
          email: g.email || undefined,
          occupation: g.occupation || undefined,
          isPrimary: i === 0 ? true : g.isPrimary,
        })),
        photo: photo ?? undefined,
        documents: docRows
          .filter((r) => r.attachment)
          .map((r) => ({ label: r.label.trim(), attachment: r.attachment! })),
      });
      setSubmitted(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "We could not submit the registration. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-brand-night px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand-500/25 blur-3xl animate-float" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-40 h-[32rem] w-[32rem] rounded-full bg-accent-500/25 blur-3xl animate-float" style={{ animationDelay: "-4s" }} />

      <div className="relative mx-auto w-full max-w-3xl">
        <header className="mb-8 text-center animate-fade-up">
          <Link href="/" className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient bg-gradient-animated text-2xl font-bold text-white shadow-brand-glow ring-1 ring-white/20 animate-gradient-pan">
            V
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-white">Student registration</h1>
          <p className="mt-1.5 text-sm text-brand-200">
            {status?.schoolName ?? BRAND.appName} · register your child online
          </p>
        </header>

        {submitted ? (
          <SubmittedPanel {...submitted} />
        ) : statusError ? (
          <Panel>
            <ErrorNote message={statusError} />
            <BackHome />
          </Panel>
        ) : !status ? (
          <Panel>
            <div className="flex justify-center py-12 text-brand-600"><Spinner className="h-8 w-8" /></div>
          </Panel>
        ) : !status.open ? (
          <ClosedPanel note={status.note} schoolName={status.schoolName} />
        ) : (
          <form onSubmit={onSubmit} className="space-y-5 animate-fade-up" style={{ animationDelay: "0.1s" }}>
            {status.note && (
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 text-sm text-brand-100 backdrop-blur-sm">
                <p className="flex items-start gap-2">
                  <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{status.note}</span>
                </p>
              </div>
            )}

            {/* ---------- 1. new or existing ---------- */}
            <Section step={1} title="Is this a new or an existing student?" subtitle="This tells the registrar whether to open a new file or update one that already exists.">
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceTile
                  selected={isReturning === false}
                  onSelect={() => setIsReturning(false)}
                  icon="plus"
                  title="New student"
                  text="My child has never been enrolled at this school."
                />
                <ChoiceTile
                  selected={isReturning === true}
                  onSelect={() => setIsReturning(true)}
                  icon="users"
                  title="Existing student"
                  text="My child already attends (or previously attended) this school."
                />
              </div>
              {isReturning === true && (
                <Field
                  label="Current admission number (optional)"
                  hint="If you have it, it lets the office match this form to your child's existing record straight away."
                >
                  <Input
                    value={priorAdmissionNo}
                    onChange={(e) => setPriorAdmissionNo(e.target.value)}
                    maxLength={40}
                    placeholder="e.g. VRT-2025-0148"
                  />
                </Field>
              )}
            </Section>

            {/* ---------- 2. the student ---------- */}
            <Section step={2} title="About the student">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} required maxLength={100} /></Field>
                <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} required maxLength={100} /></Field>
                <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} required /></Field>
                <Field label="Gender">
                  <Select value={form.gender} onChange={set("gender")}>
                    {GENDERS.map((g) => <option key={g} value={g}>{humanize(g)}</option>)}
                  </Select>
                </Field>
                <Field label="Grade applying for" hint="The school confirms the final placement after review.">
                  <Select value={form.gradeLevel} onChange={set("gradeLevel")} required>
                    {status.grades.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
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
              <Field label="Medical notes / allergies (optional)" hint="Anything the school should know to keep your child safe.">
                <textarea
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  rows={3}
                  maxLength={2000}
                  value={form.medicalNotes}
                  onChange={(e) => setForm((f) => ({ ...f, medicalNotes: e.target.value }))}
                />
              </Field>
            </Section>

            {/* ---------- 3. contact ---------- */}
            <Section step={3} title="Contact & home address" subtitle="Every field here is optional — fill in what applies.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Student email"><Input type="email" value={form.email} onChange={set("email")} maxLength={254} /></Field>
                <Field label="Student phone"><Input value={form.phone} onChange={set("phone")} maxLength={30} /></Field>
                <Field label="Street address"><Input value={form.addressLine1} onChange={set("addressLine1")} maxLength={200} /></Field>
                <Field label="Unit / Apt / Suite"><Input value={form.addressLine2} onChange={set("addressLine2")} maxLength={100} /></Field>
                <Field label="City"><Input value={form.city} onChange={set("city")} maxLength={100} /></Field>
                <Field label="State / Province"><Input value={form.state} onChange={set("state")} maxLength={100} /></Field>
                <Field label="ZIP / Postal code"><Input value={form.postalCode} onChange={set("postalCode")} maxLength={20} /></Field>
                <Field label="Country">
                  <Select value={form.country} onChange={set("country")}>
                    <option value="">— Select —</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              </div>
            </Section>

            {/* ---------- 4. guardians ---------- */}
            <Section
              step={4}
              title="Parents / guardians"
              subtitle="The first one listed is the school's main contact. Your confirmation is emailed to the addresses you give here."
              action={
                guardians.length < 6 ? (
                  <button type="button" className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={() => setGuardians((gs) => [...gs, emptyGuardian(false)])}>
                    + Add another
                  </button>
                ) : undefined
              }
            >
              {guardians.map((g, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Guardian {i + 1}{i === 0 && " (main contact)"}
                    </p>
                    {i > 0 && (
                      <button type="button" className="text-xs text-rose-600 hover:underline"
                        onClick={() => setGuardians((gs) => gs.filter((_, idx) => idx !== i))}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name"><Input value={g.firstName} onChange={setGuardian(i, "firstName")} required={i === 0} maxLength={100} /></Field>
                    <Field label="Last name"><Input value={g.lastName} onChange={setGuardian(i, "lastName")} placeholder="Defaults to the student's" maxLength={100} /></Field>
                    <Field label="Relation">
                      <Select value={g.relation} onChange={setGuardian(i, "relation")}>
                        {["Mother", "Father", "Guardian", "Grandparent", "Other"].map((r) => <option key={r}>{r}</option>)}
                      </Select>
                    </Field>
                    <Field label="Phone"><Input value={g.phone} onChange={setGuardian(i, "phone")} required={!!g.firstName} maxLength={30} /></Field>
                    <Field label="Email" hint={i === 0 ? "Your confirmation and reference number go here" : undefined}>
                      <Input type="email" value={g.email} onChange={setGuardian(i, "email")} required={i === 0} maxLength={254} />
                    </Field>
                    <Field label="Occupation"><Input value={g.occupation} onChange={setGuardian(i, "occupation")} maxLength={100} /></Field>
                  </div>
                </div>
              ))}
            </Section>

            {/* ---------- 5. photo & documents ---------- */}
            <Section step={5} title="Photo & documents" subtitle="Upload scans or photograph the papers with your camera — the school needs them to complete the registration.">
              <Field label="Student photo (optional)" hint="JPG or PNG, up to 2 MB. On a phone this opens the camera.">
                <div className="flex items-center gap-4">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:${photo.type};base64,${photo.dataBase64}`} alt="Student preview"
                      className="h-20 w-20 rounded-xl object-cover ring-2 ring-brand-200" />
                  ) : (
                    <span className="flex h-20 w-20 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                      <Icon name="camera" className="h-8 w-8" />
                    </span>
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

              <div className="flex items-center justify-between pt-2">
                <p className="text-sm font-medium text-slate-700">Supporting documents</p>
                {docRows.length < PUBLIC_REGISTRATION_MAX_DOCUMENTS && (
                  <button type="button" className="text-sm font-medium text-brand-600 hover:underline"
                    onClick={() => setDocRows((rows) => [...rows, { label: "", attachment: null }])}>
                    + Add document
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Birth certificate, parent/guardian ID, previous school report or transfer letter, immunisation card…
                PDF, JPG, PNG or Word, up to 5 MB each and {PUBLIC_REGISTRATION_MAX_DOCUMENTS} in total.
              </p>

              {docRows.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
                  No documents attached yet — use <span className="font-medium text-brand-600">+ Add document</span> above.
                </p>
              )}

              {docRows.map((row, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Document {i + 1}</p>
                    <button type="button" className="text-xs font-medium text-rose-600 hover:underline"
                      onClick={() => setDocRows((rows) => rows.filter((_, idx) => idx !== i))}>
                      <Icon name="x" className="mr-0.5 inline h-3 w-3" />Remove
                    </button>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="What is this document?">
                      <Input value={row.label} onChange={(e) => setDocRow(i, { label: e.target.value })} maxLength={100}
                        placeholder="e.g. Birth certificate" className="!w-64" />
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
                        <Button type="button" variant="secondary" onClick={() => setWebcamFor(i)}>
                          <Icon name="camera" className="h-4 w-4" /> Camera
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}

              {uploadedBytes > 0 && (
                <p className={cx("text-xs", overUploadLimit ? "font-medium text-rose-600" : "text-slate-400")}>
                  {(uploadedBytes / (1024 * 1024)).toFixed(1)} MB attached of{" "}
                  {(PUBLIC_REGISTRATION_MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)} MB allowed in one submission.
                </p>
              )}
            </Section>

            <div className="rounded-2xl border border-white/15 bg-white/95 p-6 shadow-2xl backdrop-blur-xl">
              <p className="text-sm text-slate-600">
                Submitting sends this registration to the school for review. It is <span className="font-semibold">not</span> an
                admission yet — the registrar checks the details and documents, and you will hear back from the school.
              </p>
              <div className="mt-4">
                <ErrorNote message={error} />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="submit" loading={saving} disabled={overUploadLimit}>Submit registration</Button>
                <Link href="/">
                  <Button type="button" variant="secondary">Cancel</Button>
                </Link>
              </div>
            </div>
          </form>
        )}

        <p className="mt-8 text-center text-xs text-brand-300/70">
          Powered by <span className="font-semibold text-brand-200">{BRAND.poweredBy}</span>
        </p>
      </div>

      {webcamFor !== null && (
        <WebcamCaptureModal
          title={webcamFor === "photo"
            ? "Take the student's photo"
            : `Photograph: ${docRows[webcamFor]?.label.trim() || `Document ${webcamFor + 1}`}`}
          onClose={() => setWebcamFor(null)}
          onCapture={(image) => {
            if (webcamFor === "photo") setPhoto(image);
            else setDocRow(webcamFor, { attachment: image });
          }}
        />
      )}
    </div>
  );
}

// ============================ layout pieces ============================

/** The white card every block of this page sits on, over the dark backdrop. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-hidden rounded-2xl border border-white/15 bg-white/95 shadow-2xl backdrop-blur-xl", className)}>
      <div aria-hidden className="h-1.5 w-full bg-brand-gradient" />
      <div className="space-y-4 p-6 sm:p-8">{children}</div>
    </div>
  );
}

function Section({ step, title, subtitle, action, children }: {
  step: number;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
            {step}
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </Panel>
  );
}

/** Big tappable answer to the new-or-existing question. */
function ChoiceTile({ selected, onSelect, icon, title, text }: {
  selected: boolean;
  onSelect: () => void;
  icon: "plus" | "users";
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition",
        selected
          ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/30"
          : "border-slate-200 hover:border-brand-300 hover:bg-slate-50",
      )}
    >
      <span className={cx(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
        selected ? "bg-brand-gradient text-white" : "bg-slate-100 text-slate-500",
      )}>
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
      </span>
    </button>
  );
}

function BackHome() {
  return (
    <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline">
      ← Back to the home page
    </Link>
  );
}

/** The window is shut: say so plainly and point at the office. */
function ClosedPanel({ note, schoolName }: { note?: string | null; schoolName: string }) {
  return (
    <Panel>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <Icon name="lock" className="h-7 w-7 text-amber-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Online registration is closed</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          {note || `${schoolName} is not accepting online registrations at the moment. Please contact the school office to register your child, or check back when the next admission period opens.`}
        </p>
        <div className="mt-6"><BackHome /></div>
      </div>
    </Panel>
  );
}

/** Receipt: the reference the office will ask for, and what happens next. */
function SubmittedPanel({ reference, studentName, emailedTo }: { reference: string; studentName: string; emailedTo: string[] }) {
  return (
    <Panel>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
          <Icon name="check" className="h-7 w-7 text-emerald-600" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Registration received</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          Thank you — {studentName}&apos;s registration is now with the school registrar for review.
        </p>

        <div className="mx-auto mt-6 max-w-sm rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Your reference</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-900">{reference}</p>
          <p className="mt-2 text-xs text-slate-500">Quote this whenever you contact the school about this registration.</p>
        </div>

        <div className="mx-auto mt-5 max-w-md rounded-lg bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
          <p className="font-medium">What happens next</p>
          <p className="mt-1 text-xs">
            The registration is <span className="font-semibold">pending review</span> — it is not an admission yet. The
            registrar checks the details and documents you sent and the school gets in touch with you
            {emailedTo.length > 0 ? <> (a confirmation is on its way to {emailedTo.join(", ")})</> : null}.
          </p>
        </div>

        <div className="mt-6"><BackHome /></div>
      </div>
    </Panel>
  );
}
