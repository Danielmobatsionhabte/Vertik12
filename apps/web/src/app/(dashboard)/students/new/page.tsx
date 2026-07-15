"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GRADE_LEVELS, GENDERS } from "@vertik12/shared";
import { get, post, ApiClientError } from "@/lib/api";
import { gradeLabel, humanize } from "@/lib/format";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Select } from "@/components/ui";

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
  const [years, setYears] = useState<YearOption[]>([]);
  const [academicYearId, setAcademicYearId] = useState("");
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    firstName: "", lastName: "", dateOfBirth: "", gender: "FEMALE", gradeLevel: "K",
    email: "", phone: "", addressLine1: "", city: "", country: "", nationality: "",
    bloodGroup: "", medicalNotes: "", classRoomId: "",
  });
  const [guardians, setGuardians] = useState<GuardianForm[]>([emptyGuardian(true)]);

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
        city: form.city || undefined,
        country: form.country || undefined,
        nationality: form.nationality || undefined,
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
                {GRADE_LEVELS.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}
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
            <Field label="Nationality"><Input value={form.nationality} onChange={set("nationality")} /></Field>
            <Field label="Blood group">
              <Select value={form.bloodGroup} onChange={set("bloodGroup")}>
                <option value="">Unknown</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b}>{b}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold text-slate-700">Contact & address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Student email (optional)"><Input type="email" value={form.email} onChange={set("email")} /></Field>
            <Field label="Student phone (optional)"><Input value={form.phone} onChange={set("phone")} /></Field>
            <Field label="Address"><Input value={form.addressLine1} onChange={set("addressLine1")} /></Field>
            <Field label="City"><Input value={form.city} onChange={set("city")} /></Field>
            <Field label="Country"><Input value={form.country} onChange={set("country")} /></Field>
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

        <ErrorNote message={error} />
        <div className="flex gap-3">
          <Button type="submit" loading={saving}>Register student</Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
