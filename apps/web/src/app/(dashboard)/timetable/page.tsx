"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  DAYS_OF_WEEK, SCHEDULE_REQUEST_KINDS, minutesOfDay, formatPeriod,
  type DayOfWeek, type ScheduleConflict,
} from "@vertik12/shared";
import { get, post, patch, del, getSession, ApiClientError } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, StatCard, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Teacher timetable.
 *
 *  - ADMIN / REGISTRAR get the builder: pick a class, drop periods into the
 *    week, and every placement is checked against the class, the teacher and
 *    the room before it is saved — the API refuses a clash, and this page
 *    shows it before they even press save.
 *  - TEACHERs get their own week, their teaching load, and the button that
 *    started all this: "I can't make this period" → a request the registrar
 *    approves, which moves the period for real.
 */

interface Slot {
  id: string;
  classRoomId: string;
  subjectId: string;
  teacherId: string | null;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  room: string | null;
  note: string | null;
  subject: { id: string; code: string; name: string };
  teacher: { id: string; user: { id: string; firstName: string; lastName: string } } | null;
  classRoom: { id: string; name: string; gradeLevel: string; section: string; academicYear: { id: string; name: string } };
}

interface ChangeRequest {
  id: string;
  slotId: string;
  staffId: string;
  requestedById: string;
  kind: string;
  reason: string;
  proposedDayOfWeek: string | null;
  proposedStartTime: string | null;
  proposedEndTime: string | null;
  proposedTeacherId: string | null;
  status: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  slot: Slot | null;
  teacherName: string;
}

interface AcademicYear { id: string; name: string; isActive: boolean }
interface ClassRow { id: string; name: string; gradeLevel: string; section: string }
interface ClassDetail {
  id: string;
  name: string;
  classSubjects: Array<{
    id: string;
    subjectId: string;
    teacherId: string | null;
    subject: { id: string; code: string; name: string };
    teacher: { id: string; user: { firstName: string; lastName: string } } | null;
  }>;
}
interface TeacherAvailability {
  staffId: string;
  name: string;
  designation: string;
  free: boolean;
  busyWith: string | null;
}

const dayLabel = (day: string) => day.charAt(0) + day.slice(1).toLowerCase();
const teacherLabel = (slot: Slot) => (slot.teacher ? `${slot.teacher.user.firstName} ${slot.teacher.user.lastName}` : "Unassigned");

/** Weekdays always shown; the weekend appears only when it is actually used. */
function daysToRender(slots: Slot[]): DayOfWeek[] {
  const used = new Set(slots.map((s) => s.dayOfWeek));
  return DAYS_OF_WEEK.filter((d) => (d !== "SATURDAY" && d !== "SUNDAY") || used.has(d));
}

export default function TimetablePage() {
  const role = getSession()?.user.role;
  const isManager = role === "SUPER_ADMIN" || role === "ADMIN" || role === "REGISTRAR";
  const [tab, setTab] = useState<"grid" | "requests">("grid");
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(() => {
    void get<{ pending: number }>("/schedule/requests/pending-count")
      .then((d) => setPendingCount(d.pending))
      .catch(() => setPendingCount(0));
  }, []);
  useEffect(refreshPending, [refreshPending]);

  return (
    <div>
      <PageHeader
        title="Timetable"
        subtitle={
          isManager
            ? "Build the weekly schedule — clashes with a class, a teacher or a room are refused"
            : "Your teaching week. Can't make a period? Ask the registrar to move it."
        }
      />

      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {([["grid", isManager ? "Weekly schedule" : "My week"], ["requests", "Change requests"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cx(
              "-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === key ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700",
            )}
          >
            {label}
            {key === "requests" && isManager && pendingCount > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "grid"
        ? isManager ? <ScheduleBuilder onRequestsChanged={refreshPending} /> : <MyWeek onRequestFiled={refreshPending} />
        : <RequestList isManager={isManager} onReviewed={refreshPending} />}
    </div>
  );
}

// ============================ admin / registrar ============================

function ScheduleBuilder({ onRequestsChanged }: { onRequestsChanged: () => void }) {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearId, setYearId] = useState("");
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [adding, setAdding] = useState<DayOfWeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void get<AcademicYear[]>("/academics/years").then((list) => {
      setYears(list);
      setYearId((current) => current || list.find((y) => y.isActive)?.id || list[0]?.id || "");
    });
  }, []);

  useEffect(() => {
    if (!yearId) return;
    void get<ClassRow[]>(`/academics/classes?academicYearId=${yearId}`).then((list) => {
      setClasses(list);
      // Keep the chosen class only while it belongs to the selected year.
      setClassId((current) => (list.some((c) => c.id === current) ? current : list[0]?.id ?? ""));
    });
  }, [yearId]);

  const load = useCallback(async () => {
    if (!yearId || !classId) return;
    setSlots(null);
    const params = new URLSearchParams({ academicYearId: yearId, classRoomId: classId });
    const data = await get<{ slots: Slot[] }>(`/schedule/slots?${params}`);
    setSlots(data.slots);
  }, [yearId, classId]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiClientError ? err.message : "Failed to load the timetable"));
  }, [load]);

  async function removeSlot(slot: Slot) {
    if (!window.confirm(`Remove ${slot.subject.name} (${dayLabel(slot.dayOfWeek)} ${formatPeriod(slot.startTime, slot.endTime)})?`)) return;
    try {
      await del(`/schedule/slots/${slot.id}`);
      setEditing(null);
      setNotice("Period removed");
      await load();
      onRequestsChanged();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to remove the period");
    }
  }

  const selectedClass = classes.find((c) => c.id === classId);

  return (
    <div>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="w-48">
          <Field label="Academic year">
            <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
              {years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isActive ? " (active)" : ""}</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-56">
          <Field label="Class">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.length === 0 && <option value="">No classes in this year</option>}
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Button onClick={() => setAdding("MONDAY")} disabled={!classId}>+ Add period</Button>
      </Card>

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>
      )}
      <div className="mb-4"><ErrorNote message={error} /></div>

      {!classId ? (
        <EmptyState title="No class selected" hint="Create a class for this academic year first (Classes)." />
      ) : !slots ? (
        <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>
      ) : (
        <WeekGrid
          slots={slots}
          emptyHint={`${selectedClass?.name ?? "This class"} has no periods yet — add the first one.`}
          renderSlot={(slot) => (
            <button
              key={slot.id}
              onClick={() => setEditing(slot)}
              className="block w-full rounded-lg border border-slate-200 bg-white p-2 text-left shadow-sm transition-shadow hover:shadow-brand-glow"
            >
              <span className="block text-[11px] font-semibold tabular-nums text-brand-700">
                {formatPeriod(slot.startTime, slot.endTime)}
              </span>
              <span className="block truncate text-xs font-medium text-slate-800">{slot.subject.name}</span>
              <span className="block truncate text-[11px] text-slate-500">{teacherLabel(slot)}</span>
              {slot.room && <span className="block truncate text-[11px] text-slate-400">{slot.room}</span>}
            </button>
          )}
          onAddDay={(day) => setAdding(day)}
        />
      )}

      {(adding || editing) && (
        <SlotForm
          yearId={yearId}
          classId={classId}
          day={adding ?? (editing!.dayOfWeek as DayOfWeek)}
          slot={editing}
          onClose={() => { setAdding(null); setEditing(null); }}
          onSaved={async (message) => {
            setAdding(null);
            setEditing(null);
            setNotice(message);
            await load();
          }}
          onDelete={editing ? () => removeSlot(editing) : undefined}
        />
      )}
    </div>
  );
}

/**
 * Add or move a period. The clash check runs as the form changes, so the
 * registrar sees "Ms Bello is teaching Grade 6 then" while they are still
 * choosing the time — not after a failed save.
 */
function SlotForm({ yearId, classId, day, slot, onClose, onSaved, onDelete }: {
  yearId: string;
  classId: string;
  day: DayOfWeek;
  slot: Slot | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onDelete?: () => void;
}) {
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [form, setForm] = useState({
    subjectId: slot?.subjectId ?? "",
    teacherId: slot?.teacherId ?? "",
    dayOfWeek: (slot?.dayOfWeek ?? day) as DayOfWeek,
    startTime: slot?.startTime ?? "08:00",
    endTime: slot?.endTime ?? "08:45",
    room: slot?.room ?? "",
    note: slot?.note ?? "",
  });
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [availability, setAvailability] = useState<TeacherAvailability[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<ClassDetail>(`/academics/classes/${classId}`).then((d) => {
      setDetail(d);
      setForm((f) => (f.subjectId ? f : { ...f, subjectId: d.classSubjects[0]?.subjectId ?? "" }));
    });
  }, [classId]);

  // Choosing a subject offers its assigned teacher by default — the usual
  // case needs no extra decision, and a substitute is one dropdown away.
  useEffect(() => {
    if (slot || !detail || !form.subjectId) return;
    const assigned = detail.classSubjects.find((cs) => cs.subjectId === form.subjectId);
    setForm((f) => ({ ...f, teacherId: assigned?.teacherId ?? "" }));
  }, [detail, form.subjectId, slot]);

  const timesValid = minutesOfDay(form.endTime) > minutesOfDay(form.startTime);

  // Live clash check + "who is free then?", debounced so typing a time
  // doesn't fire a request per keystroke.
  useEffect(() => {
    if (!form.subjectId || !timesValid) {
      setConflicts([]);
      setAvailability(null);
      return;
    }
    const timer = setTimeout(() => {
      setChecking(true);
      const candidate = {
        classRoomId: classId,
        subjectId: form.subjectId,
        ...(form.teacherId ? { teacherId: form.teacherId } : {}),
        dayOfWeek: form.dayOfWeek,
        startTime: form.startTime,
        endTime: form.endTime,
        ...(form.room ? { room: form.room } : {}),
        academicYearId: yearId,
        ...(slot ? { excludeSlotId: slot.id } : {}),
      };
      const params = new URLSearchParams({
        academicYearId: yearId,
        dayOfWeek: form.dayOfWeek,
        startTime: form.startTime,
        endTime: form.endTime,
        ...(slot ? { excludeSlotId: slot.id } : {}),
      });
      void Promise.all([
        post<{ ok: boolean; conflicts: ScheduleConflict[] }>("/schedule/check", candidate).catch(() => null),
        get<TeacherAvailability[]>(`/schedule/availability?${params}`).catch(() => null),
      ]).then(([check, free]) => {
        if (check) setConflicts(check.conflicts);
        if (free) setAvailability(free);
        setChecking(false);
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [classId, yearId, slot, form.subjectId, form.teacherId, form.dayOfWeek, form.startTime, form.endTime, form.room, timesValid]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      classRoomId: classId,
      subjectId: form.subjectId,
      ...(form.teacherId ? { teacherId: form.teacherId } : {}),
      dayOfWeek: form.dayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      ...(form.room ? { room: form.room } : {}),
      ...(form.note ? { note: form.note } : {}),
    };
    try {
      if (slot) {
        // PATCH takes nulls to clear a room/teacher the registrar emptied.
        await patch(`/schedule/slots/${slot.id}`, {
          ...payload,
          teacherId: form.teacherId || null,
          room: form.room || null,
          note: form.note || null,
        });
        await onSaved("Period updated");
      } else {
        await post("/schedule/slots", payload);
        await onSaved("Period added to the timetable");
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save the period");
    } finally {
      setSaving(false);
    }
  }

  const busyTeacherIds = new Set((availability ?? []).filter((t) => !t.free).map((t) => t.staffId));

  return (
    <Modal open title={slot ? "Edit period" : "Add period"} onClose={onClose} wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Subject" hint="Only subjects assigned to this class">
            <Select value={form.subjectId} onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))} required>
              <option value="">Select a subject…</option>
              {(detail?.classSubjects ?? []).map((cs) => (
                <option key={cs.id} value={cs.subjectId}>{cs.subject.name} ({cs.subject.code})</option>
              ))}
            </Select>
          </Field>
          <Field label="Teacher" hint="Teachers already booked at this time are marked busy">
            <Select value={form.teacherId} onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}>
              <option value="">Unassigned</option>
              {(availability ?? []).map((t) => (
                <option key={t.staffId} value={t.staffId}>
                  {t.name}{t.free ? "" : ` — busy: ${t.busyWith}`}
                </option>
              ))}
              {/* Before a time is picked there is no availability list yet;
                  keep the currently assigned teacher selectable regardless. */}
              {!availability && form.teacherId && <option value={form.teacherId}>Current teacher</option>}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Day">
            <Select value={form.dayOfWeek} onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: e.target.value as DayOfWeek }))}>
              {DAYS_OF_WEEK.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </Select>
          </Field>
          <Field label="Starts">
            <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} required />
          </Field>
          <Field label="Ends">
            <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} required />
          </Field>
          <Field label="Room" hint="Optional">
            <Input value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} placeholder="Lab 2" maxLength={60} />
          </Field>
        </div>

        {!timesValid && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The period must end after it starts.
          </div>
        )}

        {/* Live clash report — the whole point of the feature */}
        {timesValid && (
          <div
            className={cx(
              "rounded-lg border px-3 py-2 text-sm",
              checking ? "border-slate-200 bg-slate-50 text-slate-500"
              : conflicts.length === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800",
            )}
          >
            {checking ? (
              <span className="flex items-center gap-2"><Spinner className="h-4 w-4" /> Checking for clashes…</span>
            ) : conflicts.length === 0 ? (
              <span className="flex items-center gap-2"><Icon name="check-circle" className="h-4 w-4" /> This slot is free.</span>
            ) : (
              <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium">
                  <Icon name="warning" className="h-4 w-4" />
                  {conflicts.length} clash{conflicts.length === 1 ? "" : "es"} — this period cannot be saved:
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {conflicts.map((c) => (
                    <li key={`${c.kind}-${c.slotId}`}>
                      <span className="font-semibold">{humanize(c.kind)}:</span> {c.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <Field label="Note" hint="Optional — shown on the teacher's schedule">
          <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={300} />
        </Field>

        <ErrorNote message={error} />
        <div className="flex justify-between gap-3">
          <div>{onDelete && <Button type="button" variant="danger" onClick={onDelete}>Remove period</Button>}</div>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              loading={saving}
              disabled={!timesValid || conflicts.length > 0 || busyTeacherIds.has(form.teacherId)}
            >
              {slot ? "Save changes" : "Add period"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ================================ teacher ================================

function MyWeek({ onRequestFiled }: { onRequestFiled: () => void }) {
  const [data, setData] = useState<{ slots: Slot[]; load: { periods: number; minutes: number } } | null>(null);
  const [requesting, setRequesting] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () => get<{ slots: Slot[]; load: { periods: number; minutes: number } }>("/schedule/my").then(setData),
    [],
  );
  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiClientError ? err.message : "Failed to load your schedule"));
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>;

  const hours = Math.floor(data.load.minutes / 60);
  const minutes = data.load.minutes % 60;

  return (
    <div>
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Periods a week" value={data.load.periods} />
        <StatCard label="Teaching time" value={`${hours}h ${minutes}m`} detail="Per week" />
        <StatCard
          label="Classes"
          value={new Set(data.slots.map((s) => s.classRoomId)).size}
          detail="Distinct classes you teach"
        />
      </div>

      <WeekGrid
        slots={data.slots}
        emptyHint="You have no periods scheduled yet. The registrar builds the timetable."
        renderSlot={(slot) => (
          <button
            key={slot.id}
            onClick={() => setRequesting(slot)}
            title="Ask the registrar to change this period"
            className="block w-full rounded-lg border border-slate-200 bg-white p-2 text-left shadow-sm transition-shadow hover:shadow-brand-glow"
          >
            <span className="block text-[11px] font-semibold tabular-nums text-brand-700">
              {formatPeriod(slot.startTime, slot.endTime)}
            </span>
            <span className="block truncate text-xs font-medium text-slate-800">{slot.subject.name}</span>
            <span className="block truncate text-[11px] text-slate-500">{slot.classRoom.name}</span>
            {slot.room && <span className="block truncate text-[11px] text-slate-400">{slot.room}</span>}
            {slot.note && <span className="block truncate text-[11px] italic text-slate-400">{slot.note}</span>}
          </button>
        )}
      />

      {requesting && (
        <RequestForm
          slot={requesting}
          onClose={() => setRequesting(null)}
          onSent={() => {
            setRequesting(null);
            setNotice("Your request was sent to the registrar — you'll get a message when it's decided.");
            onRequestFiled();
          }}
        />
      )}
    </div>
  );
}

/** "I can't make this period" — the teacher's side of the workflow. */
function RequestForm({ slot, onClose, onSent }: { slot: Slot; onClose: () => void; onSent: () => void }) {
  const [form, setForm] = useState({
    kind: "CHANGE" as string,
    reason: "",
    proposeTime: false,
    proposedDayOfWeek: slot.dayOfWeek as DayOfWeek,
    proposedStartTime: slot.startTime,
    proposedEndTime: slot.endTime,
    proposedTeacherId: "",
  });
  const [colleagues, setColleagues] = useState<TeacherAvailability[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A SWAP needs a colleague to hand the period to; the availability list is
  // registrar-only, so teachers name a colleague from the same class's roster
  // instead — the registrar confirms who actually covers it.
  useEffect(() => {
    if (form.kind !== "SWAP" || colleagues) return;
    void get<ClassDetail>(`/academics/classes/${slot.classRoomId}`)
      .then((d) =>
        setColleagues(
          d.classSubjects
            .filter((cs) => cs.teacher && cs.teacherId !== slot.teacherId)
            .map((cs) => ({
              staffId: cs.teacherId!,
              name: `${cs.teacher!.user.firstName} ${cs.teacher!.user.lastName}`,
              designation: cs.subject.name,
              free: true,
              busyWith: null,
            })),
        ),
      )
      .catch(() => setColleagues([]));
  }, [form.kind, colleagues, slot.classRoomId, slot.teacherId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await post("/schedule/requests", {
        slotId: slot.id,
        kind: form.kind,
        reason: form.reason,
        ...(form.kind === "CHANGE" && form.proposeTime
          ? {
              proposedDayOfWeek: form.proposedDayOfWeek,
              proposedStartTime: form.proposedStartTime,
              proposedEndTime: form.proposedEndTime,
            }
          : {}),
        ...(form.kind === "SWAP" && form.proposedTeacherId ? { proposedTeacherId: form.proposedTeacherId } : {}),
      });
      onSent();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to send the request");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Request a schedule change" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">{slot.subject.name} · {slot.classRoom.name}</p>
          <p className="text-slate-500">{dayLabel(slot.dayOfWeek)} {formatPeriod(slot.startTime, slot.endTime)}{slot.room ? ` · ${slot.room}` : ""}</p>
        </div>

        <Field label="What do you need?">
          <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            {SCHEDULE_REQUEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "CHANGE" ? "Move it to another time" : k === "SWAP" ? "Someone else to cover it" : "Drop this period"}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Why?" hint="The registrar sees this — the more specific, the faster the answer">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={3}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            required
            maxLength={1000}
          />
        </Field>

        {form.kind === "CHANGE" && (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.proposeTime}
                onChange={(e) => setForm((f) => ({ ...f, proposeTime: e.target.checked }))}
              />
              Suggest a specific time (otherwise the registrar decides)
            </label>
            {form.proposeTime && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Day">
                  <Select
                    value={form.proposedDayOfWeek}
                    onChange={(e) => setForm((f) => ({ ...f, proposedDayOfWeek: e.target.value as DayOfWeek }))}
                  >
                    {DAYS_OF_WEEK.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                  </Select>
                </Field>
                <Field label="From">
                  <Input type="time" value={form.proposedStartTime} onChange={(e) => setForm((f) => ({ ...f, proposedStartTime: e.target.value }))} />
                </Field>
                <Field label="To">
                  <Input type="time" value={form.proposedEndTime} onChange={(e) => setForm((f) => ({ ...f, proposedEndTime: e.target.value }))} />
                </Field>
              </div>
            )}
          </>
        )}

        {form.kind === "SWAP" && (
          <Field label="Who could cover it?" hint="A colleague already teaching this class">
            <Select
              value={form.proposedTeacherId}
              onChange={(e) => setForm((f) => ({ ...f, proposedTeacherId: e.target.value }))}
              required
            >
              <option value="">Select a colleague…</option>
              {(colleagues ?? []).map((t) => <option key={t.staffId} value={t.staffId}>{t.name} — {t.designation}</option>)}
            </Select>
          </Field>
        )}

        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Send to registrar</Button>
        </div>
      </form>
    </Modal>
  );
}

// ============================ change requests ============================

function RequestList({ isManager, onReviewed }: { isManager: boolean; onReviewed: () => void }) {
  const [requests, setRequests] = useState<ChangeRequest[] | null>(null);
  const [statusFilter, setStatusFilter] = useState(isManager ? "PENDING" : "");
  const [reviewing, setReviewing] = useState<ChangeRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const query = statusFilter ? `?status=${statusFilter}` : "";
    setRequests(await get<ChangeRequest[]>(`/schedule/requests${query}`));
  }, [statusFilter]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiClientError ? err.message : "Failed to load requests"));
  }, [load]);

  async function withdraw(request: ChangeRequest) {
    if (!window.confirm("Withdraw this request?")) return;
    try {
      await post(`/schedule/requests/${request.id}/cancel`);
      setNotice("Request withdrawn");
      await load();
      onReviewed();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to withdraw the request");
    }
  }

  const kindLabel = (kind: string) =>
    kind === "CHANGE" ? "Move to another time" : kind === "SWAP" ? "Cover requested" : "Drop the period";

  return (
    <div>
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</div>
      )}
      <div className="mb-4"><ErrorNote message={error} /></div>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="w-48">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {!requests ? (
        <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No requests"
          hint={isManager ? "Teachers' schedule requests land here." : "Open your week and pick a period to request a change."}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <Card key={request.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">
                      {request.slot ? `${request.slot.subject.name} · ${request.slot.classRoom.name}` : "Period removed"}
                    </p>
                    <Badge tone={
                      request.status === "PENDING" ? "yellow"
                      : request.status === "APPROVED" ? "green"
                      : request.status === "REJECTED" ? "red" : "gray"
                    }>
                      {humanize(request.status)}
                    </Badge>
                    <Badge tone="blue">{kindLabel(request.kind)}</Badge>
                  </div>
                  {request.slot && (
                    <p className="mt-1 text-sm text-slate-500">
                      Currently {dayLabel(request.slot.dayOfWeek)} {formatPeriod(request.slot.startTime, request.slot.endTime)}
                    </p>
                  )}
                  {request.proposedDayOfWeek && request.proposedStartTime && (
                    <p className="text-sm text-brand-700">
                      Suggested: {dayLabel(request.proposedDayOfWeek)}{" "}
                      {formatPeriod(request.proposedStartTime, request.proposedEndTime ?? "")}
                    </p>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{request.reason}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    {isManager ? `${request.teacherName} · ` : ""}filed {formatDate(request.createdAt)}
                    {request.reviewedAt && ` · reviewed ${formatDate(request.reviewedAt)}`}
                  </p>
                  {request.reviewNote && (
                    <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      Registrar&apos;s note: {request.reviewNote}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {request.status === "PENDING" && isManager && request.slot && (
                    <Button onClick={() => setReviewing(request)}>Review</Button>
                  )}
                  {request.status === "PENDING" && !isManager && (
                    <Button variant="secondary" onClick={() => withdraw(request)}>Withdraw</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {reviewing?.slot && (
        <ReviewForm
          request={reviewing}
          onClose={() => setReviewing(null)}
          onDone={async (message) => {
            setReviewing(null);
            setNotice(message);
            await load();
            onReviewed();
          }}
        />
      )}
    </div>
  );
}

/**
 * The registrar's decision. Approving a move actually re-places the period,
 * so the same clash check runs — the form previews it first, and an
 * approval that would double-book is refused by the API.
 */
function ReviewForm({ request, onClose, onDone }: {
  request: ChangeRequest;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const slot = request.slot!;
  const [form, setForm] = useState({
    dayOfWeek: (request.proposedDayOfWeek ?? slot.dayOfWeek) as DayOfWeek,
    startTime: request.proposedStartTime ?? slot.startTime,
    endTime: request.proposedEndTime ?? slot.endTime,
    teacherId: request.kind === "SWAP" ? request.proposedTeacherId ?? "" : slot.teacherId ?? "",
    note: "",
  });
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [availability, setAvailability] = useState<TeacherAvailability[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCancel = request.kind === "CANCEL";
  const timesValid = minutesOfDay(form.endTime) > minutesOfDay(form.startTime);
  const yearId = slot.classRoom.academicYear.id;

  useEffect(() => {
    if (isCancel || !timesValid) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        academicYearId: yearId,
        dayOfWeek: form.dayOfWeek,
        startTime: form.startTime,
        endTime: form.endTime,
        excludeSlotId: slot.id,
      });
      void Promise.all([
        post<{ ok: boolean; conflicts: ScheduleConflict[] }>("/schedule/check", {
          classRoomId: slot.classRoomId,
          subjectId: slot.subjectId,
          ...(form.teacherId ? { teacherId: form.teacherId } : {}),
          dayOfWeek: form.dayOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          ...(slot.room ? { room: slot.room } : {}),
          academicYearId: yearId,
          excludeSlotId: slot.id,
        }).catch(() => null),
        get<TeacherAvailability[]>(`/schedule/availability?${params}`).catch(() => null),
      ]).then(([check, free]) => {
        if (check) setConflicts(check.conflicts);
        if (free) setAvailability(free);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [isCancel, timesValid, yearId, slot, form.dayOfWeek, form.startTime, form.endTime, form.teacherId]);

  async function decide(action: "APPROVE" | "REJECT") {
    setSaving(true);
    setError(null);
    try {
      await post(`/schedule/requests/${request.id}/review`, {
        action,
        note: form.note || undefined,
        ...(action === "APPROVE" && !isCancel
          ? {
              dayOfWeek: form.dayOfWeek,
              startTime: form.startTime,
              endTime: form.endTime,
              teacherId: form.teacherId || null,
            }
          : {}),
      });
      await onDone(action === "APPROVE" ? "Request approved — the timetable was updated" : "Request declined");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to record the decision");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Review schedule request" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">{request.teacherName} — {slot.subject.name} · {slot.classRoom.name}</p>
          <p className="text-slate-500">Currently {dayLabel(slot.dayOfWeek)} {formatPeriod(slot.startTime, slot.endTime)}</p>
          <p className="mt-2 whitespace-pre-wrap text-slate-600">{request.reason}</p>
        </div>

        {isCancel ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Approving removes this period from the timetable entirely.
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-700">Where does it go?</p>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Day">
                <Select value={form.dayOfWeek} onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: e.target.value as DayOfWeek }))}>
                  {DAYS_OF_WEEK.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                </Select>
              </Field>
              <Field label="From">
                <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
              </Field>
              <Field label="To">
                <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
              </Field>
              <Field label="Teacher">
                <Select value={form.teacherId} onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {(availability ?? []).map((t) => (
                    <option key={t.staffId} value={t.staffId}>{t.name}{t.free ? "" : ` — busy: ${t.busyWith}`}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <div
              className={cx(
                "rounded-lg border px-3 py-2 text-sm",
                conflicts.length === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              {conflicts.length === 0 ? (
                <span className="flex items-center gap-2"><Icon name="check-circle" className="h-4 w-4" /> The new time is free.</span>
              ) : (
                <ul className="list-inside list-disc space-y-0.5">
                  {conflicts.map((c) => <li key={`${c.kind}-${c.slotId}`}>{c.message}</li>)}
                </ul>
              )}
            </div>
          </>
        )}

        <Field label="Note to the teacher" hint="Optional — sent with the decision">
          <Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={500} />
        </Field>

        <ErrorNote message={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="button" variant="danger" loading={saving} onClick={() => decide("REJECT")}>Decline</Button>
          <Button
            type="button"
            loading={saving}
            disabled={!isCancel && (!timesValid || conflicts.length > 0)}
            onClick={() => decide("APPROVE")}
          >
            {isCancel ? "Approve & remove" : "Approve & move"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================== shared grid ==============================

/** The week laid out as day columns, each holding its periods in time order. */
function WeekGrid({ slots, renderSlot, emptyHint, onAddDay }: {
  slots: Slot[];
  renderSlot: (slot: Slot) => ReactNode;
  emptyHint: string;
  onAddDay?: (day: DayOfWeek) => void;
}) {
  const days = useMemo(() => daysToRender(slots), [slots]);

  if (slots.length === 0 && !onAddDay) return <EmptyState title="Nothing scheduled" hint={emptyHint} />;

  return (
    <div className="table-scroll">
      <div className="grid min-w-[52rem] gap-3" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((day) => {
          const daySlots = slots
            .filter((s) => s.dayOfWeek === day)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
          return (
            <div key={day} className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{dayLabel(day)}</p>
                {onAddDay && (
                  <button
                    onClick={() => onAddDay(day)}
                    className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-brand-600"
                    title={`Add a period on ${dayLabel(day)}`}
                  >
                    <Icon name="plus" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {daySlots.map(renderSlot)}
                {daySlots.length === 0 && <p className="px-1 py-4 text-center text-[11px] text-slate-400">Free</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
