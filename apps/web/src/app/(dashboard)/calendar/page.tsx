"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CALENDAR_CATEGORIES, CALENDAR_CATEGORY_TONES, CALENDAR_AUDIENCES,
  type CalendarCategory,
} from "@vertik12/shared";
import { get, post, patch, del, getSession, ApiClientError } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, cx } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * The school calendar — the one page every portal shares.
 *
 * Staff, teachers, parents and students all read the same month grid
 * (filtered to the events addressed to them). Everyone can add to it:
 * the administration publishes straight away, everyone else's entry is a
 * proposal that lands in the admin's review queue on this same page.
 */

interface CalendarEventRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  audience: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  academicYearId: string | null;
  status: string;
  reviewNote: string | null;
  createdById: string;
  createdAt: string;
  academicYear?: { id: string; name: string } | null;
  author: { id: string; firstName: string; lastName: string; role: string } | null;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Calendar dates are stored at midnight UTC — build the grid in UTC too, or days drift. */
const utcDay = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day));
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The month laid out as Monday-first weeks, padded with the surrounding
 * months' days so every row has seven cells. Trailing rows that belong
 * entirely to the next month are dropped, so a short month doesn't render
 * a dead week.
 */
function monthGrid(year: number, month: number): Date[][] {
  // getUTCDay() is 0=Sunday; shift so Monday starts the week.
  const lead = (utcDay(year, month, 1).getUTCDay() + 6) % 7;
  const weeks = Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => utcDay(year, month, 1 - lead + week * 7 + day)),
  );
  return weeks.filter((week) => week.some((d) => d.getUTCMonth() === month));
}

const toneFor = (category: string) =>
  (CALENDAR_CATEGORY_TONES[category as CalendarCategory] ?? "gray") as "green" | "yellow" | "red" | "blue" | "gray" | "brand";

/** Left border colour of an event chip, matching its category badge. */
const chipTone: Record<string, string> = {
  green: "border-l-emerald-400 bg-emerald-50 text-emerald-800",
  yellow: "border-l-amber-400 bg-amber-50 text-amber-800",
  red: "border-l-rose-400 bg-rose-50 text-rose-800",
  blue: "border-l-sky-400 bg-sky-50 text-sky-800",
  brand: "border-l-brand-400 bg-brand-50 text-brand-700",
  gray: "border-l-slate-300 bg-slate-50 text-slate-700",
};

function eventTimeLabel(event: CalendarEventRow): string {
  if (event.allDay) return "All day";
  return `${event.startTime ?? ""} — ${event.endTime ?? ""}`;
}

function eventDateLabel(event: CalendarEventRow): string {
  const span = event.startDate.slice(0, 10) === event.endDate.slice(0, 10)
    ? formatDate(event.startDate)
    : `${formatDate(event.startDate)} → ${formatDate(event.endDate)}`;
  return event.allDay ? span : `${span} · ${eventTimeLabel(event)}`;
}

const emptyForm = {
  title: "",
  description: "",
  category: "MEETING" as string,
  audience: "ALL" as string,
  startDate: "",
  endDate: "",
  allDay: true,
  startTime: "09:00",
  endTime: "10:00",
  location: "",
};

export default function CalendarPage() {
  const session = getSession();
  const role = session?.user.role;
  // The administration publishes directly and reviews everyone else's
  // proposals; every other role proposes. The API enforces the same split.
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";

  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => ({ year: today.getUTCFullYear(), month: today.getUTCMonth() }));
  const [events, setEvents] = useState<CalendarEventRow[] | null>(null);
  const [pending, setPending] = useState<CalendarEventRow[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [detail, setDetail] = useState<CalendarEventRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CalendarEventRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);

  const load = useCallback(async () => {
    // Fetch the whole visible grid, not just the month, so events bleeding
    // in from the neighbouring months still render in their padding cells.
    const from = weeks[0]![0]!;
    const to = weeks[weeks.length - 1]![6]!;
    const params = new URLSearchParams({ from: isoDay(from), to: isoDay(to) });
    if (categoryFilter) params.set("category", categoryFilter);
    const list = await get<CalendarEventRow[]>(`/calendar?${params}`);
    setEvents(list);
    if (isAdmin) {
      await get<CalendarEventRow[]>("/calendar?status=PENDING").then(setPending).catch(() => setPending([]));
    }
  }, [weeks, categoryFilter, isAdmin]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiClientError ? err.message : "Failed to load the calendar"));
  }, [load]);

  /** Published events (plus your own pending ones) that cover a given day. */
  const eventsOn = useCallback(
    (day: Date) => {
      const key = isoDay(day);
      return (events ?? []).filter((e) => e.startDate.slice(0, 10) <= key && key <= e.endDate.slice(0, 10));
    },
    [events],
  );

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1))
    .toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const next = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
    setSelectedDay(null);
  }

  function openCreate(day?: string) {
    setEditing(null);
    setForm({ ...emptyForm, startDate: day ?? isoDay(today), endDate: day ?? isoDay(today) });
    setError(null);
    setShowForm(true);
  }

  function openEdit(event: CalendarEventRow) {
    setEditing(event);
    setForm({
      title: event.title,
      description: event.description ?? "",
      category: event.category,
      audience: event.audience,
      startDate: event.startDate.slice(0, 10),
      endDate: event.endDate.slice(0, 10),
      allDay: event.allDay,
      startTime: event.startTime ?? "09:00",
      endTime: event.endTime ?? "10:00",
      location: event.location ?? "",
    });
    setError(null);
    setDetail(null);
    setShowForm(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      title: form.title,
      description: form.description || undefined,
      category: form.category,
      audience: form.audience,
      startDate: form.startDate,
      endDate: form.endDate || form.startDate,
      allDay: form.allDay,
      ...(form.allDay ? {} : { startTime: form.startTime, endTime: form.endTime }),
      location: form.location || undefined,
    };
    try {
      if (editing) {
        await patch(`/calendar/${editing.id}`, payload);
        setNotice("Event updated");
      } else {
        await post("/calendar", payload);
        setNotice(isAdmin ? "Event added to the school calendar" : "Proposal sent — an administrator will review it");
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to save the event");
    } finally {
      setSaving(false);
    }
  }

  async function review(event: CalendarEventRow, action: "APPROVE" | "REJECT") {
    const note = action === "REJECT" ? window.prompt("Reason (optional) — the author will see this") ?? "" : "";
    try {
      await post(`/calendar/${event.id}/review`, { action, note: note || undefined });
      setNotice(action === "APPROVE" ? `"${event.title}" published` : `"${event.title}" rejected`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to review the proposal");
    }
  }

  async function remove(event: CalendarEventRow) {
    if (!window.confirm(`Remove "${event.title}" from the calendar?`)) return;
    try {
      await del(`/calendar/${event.id}`);
      setDetail(null);
      setNotice("Event removed");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to remove the event");
    }
  }

  const canEdit = (event: CalendarEventRow) =>
    isAdmin || (event.createdById === session?.user.id && event.status === "PENDING");

  const dayEvents = selectedDay
    ? (events ?? []).filter((e) => e.startDate.slice(0, 10) <= selectedDay && selectedDay <= e.endDate.slice(0, 10))
    : [];

  const upcoming = (events ?? [])
    .filter((e) => e.status === "PUBLISHED" && e.endDate.slice(0, 10) >= isoDay(today))
    .slice(0, 6);

  return (
    <div>
      <PageHeader
        title="School calendar"
        subtitle={
          isAdmin
            ? "Term dates, holidays, exams and meetings — visible to every portal"
            : "Everything happening at school. Anything you add is reviewed by the administration."
        }
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && pending.length > 0 && (
              <Button variant="secondary" onClick={() => setShowQueue(true)}>
                <Icon name="clock" className="h-4 w-4" />
                {pending.length} proposal{pending.length === 1 ? "" : "s"}
              </Button>
            )}
            <Button onClick={() => openCreate()}>+ {isAdmin ? "Add event" : "Propose event"}</Button>
          </div>
        }
      />

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      <div className="mb-4"><ErrorNote message={error} /></div>

      {/* Month navigation + category filter */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftMonth(-1)}
            className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="Previous month"
          >
            <Icon name="chevron-left" className="h-4 w-4" />
          </button>
          <span className="min-w-44 text-center text-sm font-semibold text-slate-800">{monthLabel}</span>
          <button
            onClick={() => shiftMonth(1)}
            className="rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="Next month"
          >
            <Icon name="chevron-right" className="h-4 w-4" />
          </button>
          <Button
            variant="ghost"
            onClick={() => setCursor({ year: today.getUTCFullYear(), month: today.getUTCMonth() })}
          >
            Today
          </Button>
        </div>
        <div className="w-52">
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {CALENDAR_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
          </Select>
        </div>
      </Card>

      {!events ? (
        <div className="flex justify-center py-24 text-brand-600"><Spinner /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Month grid */}
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {weeks.flat().map((day) => {
                const key = isoDay(day);
                const inMonth = day.getUTCMonth() === cursor.month;
                const isToday = key === isoDay(today);
                const dayItems = eventsOn(day);
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDay(key)}
                    className={cx(
                      "min-h-24 border-b border-r border-slate-100 p-1.5 text-left align-top transition-colors hover:bg-brand-50/40",
                      !inMonth && "bg-slate-50/60",
                      selectedDay === key && "ring-2 ring-inset ring-brand-400",
                    )}
                  >
                    <span
                      className={cx(
                        "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums",
                        isToday ? "bg-brand-gradient font-bold text-white" : inMonth ? "text-slate-700" : "text-slate-400",
                      )}
                    >
                      {day.getUTCDate()}
                    </span>
                    <span className="block space-y-0.5">
                      {dayItems.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          title={`${e.title} · ${eventTimeLabel(e)}`}
                          className={cx(
                            "block truncate rounded border-l-2 px-1 py-0.5 text-[10px] leading-tight",
                            chipTone[toneFor(e.category)],
                            e.status === "PENDING" && "opacity-60 italic",
                          )}
                        >
                          {!e.allDay && <span className="font-semibold tabular-nums">{e.startTime} </span>}
                          {e.title}
                        </span>
                      ))}
                      {dayItems.length > 3 && (
                        <span className="block px-1 text-[10px] text-slate-500">+{dayItems.length - 3} more</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Side panel: the selected day, or what's coming up */}
          <div className="space-y-4">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">
                  {selectedDay ? formatDate(selectedDay) : "Coming up"}
                </h2>
                {selectedDay && (
                  <button onClick={() => setSelectedDay(null)} className="text-xs text-slate-500 hover:text-slate-700">
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {(selectedDay ? dayEvents : upcoming).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setDetail(e)}
                    className={cx("block w-full rounded-lg border-l-4 px-3 py-2 text-left", chipTone[toneFor(e.category)])}
                  >
                    <span className="block text-sm font-medium">{e.title}</span>
                    <span className="block text-xs opacity-80">
                      {selectedDay ? eventTimeLabel(e) : eventDateLabel(e)}
                    </span>
                    {e.status === "PENDING" && (
                      <span className="mt-1 inline-block text-[10px] font-semibold uppercase">Awaiting approval</span>
                    )}
                  </button>
                ))}
                {(selectedDay ? dayEvents : upcoming).length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400">
                    {selectedDay ? "Nothing scheduled." : "No upcoming events."}
                  </p>
                )}
              </div>
              {selectedDay && (
                <Button variant="secondary" className="mt-3 w-full" onClick={() => openCreate(selectedDay)}>
                  + {isAdmin ? "Add" : "Propose"} on this day
                </Button>
              )}
            </Card>

            {/* Category key — the colours used across every portal */}
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">Categories</h2>
              <div className="flex flex-wrap gap-1.5">
                {CALENDAR_CATEGORIES.map((c) => (
                  <Badge key={c} tone={toneFor(c)}>{humanize(c)}</Badge>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Event detail */}
      <Modal open={!!detail} title={detail?.title ?? ""} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={toneFor(detail.category)}>{humanize(detail.category)}</Badge>
              <Badge tone="gray">{humanize(detail.audience)}</Badge>
              {detail.status !== "PUBLISHED" && <Badge tone={detail.status === "PENDING" ? "yellow" : "red"}>{humanize(detail.status)}</Badge>}
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-slate-500">When</dt>
                <dd className="text-slate-800">{eventDateLabel(detail)}</dd>
              </div>
              {detail.location && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-500">Where</dt>
                  <dd className="text-slate-800">{detail.location}</dd>
                </div>
              )}
              {detail.academicYear && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-slate-500">Year</dt>
                  <dd className="text-slate-800">{detail.academicYear.name}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-slate-500">Added by</dt>
                <dd className="text-slate-800">
                  {detail.author ? `${detail.author.firstName} ${detail.author.lastName}` : "—"}
                  <span className="text-slate-400"> · {humanize(detail.author?.role ?? "")}</span>
                </dd>
              </div>
            </dl>
            {detail.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{detail.description}</p>}
            {detail.reviewNote && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Administrator&apos;s note: {detail.reviewNote}
              </div>
            )}
            {canEdit(detail) && (
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button variant="danger" onClick={() => remove(detail)}>Remove</Button>
                <Button variant="secondary" onClick={() => openEdit(detail)}>Edit</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Add / edit */}
      <Modal
        open={showForm}
        title={editing ? "Edit event" : isAdmin ? "Add calendar event" : "Propose a calendar event"}
        onClose={() => setShowForm(false)}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {!isAdmin && !editing && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Your event is sent to the administration for approval before it appears on everyone&apos;s calendar.
            </p>
          )}
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required maxLength={200} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {CALENDAR_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
              </Select>
            </Field>
            <Field label="Audience" hint="Who sees this on their calendar">
              <Select value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
                {CALENDAR_AUDIENCES.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts">
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({
                  ...f,
                  startDate: e.target.value,
                  // A single-day event is the common case: keep the end date
                  // in step until the user deliberately extends it.
                  endDate: !f.endDate || f.endDate < e.target.value ? e.target.value : f.endDate,
                }))}
                required
              />
            </Field>
            <Field label="Ends" hint="Same day for a one-day event">
              <Input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                required
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) => setForm((f) => ({ ...f, allDay: e.target.checked }))}
            />
            All-day event
          </label>
          {!form.allDay && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start time">
                <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} required />
              </Field>
              <Field label="End time">
                <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} required />
              </Field>
            </div>
          )}
          <Field label="Location" hint="Optional — hall, field, campus…">
            <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} maxLength={200} />
          </Field>
          <Field label="Details" hint="Optional">
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>
              {editing ? "Save changes" : isAdmin ? "Publish" : "Send for approval"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Admin review queue */}
      <Modal open={showQueue} title="Proposed events" onClose={() => setShowQueue(false)} wide>
        <div className="space-y-3">
          {pending.length === 0 && <EmptyState title="Nothing waiting" hint="Proposals from staff and families appear here." />}
          {pending.map((e) => (
            <Card key={e.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{e.title}</p>
                  <p className="text-sm text-slate-500">{eventDateLabel(e)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Proposed by {e.author ? `${e.author.firstName} ${e.author.lastName}` : "—"}
                    {e.author && <span> · {humanize(e.author.role)}</span>}
                  </p>
                  {e.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{e.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={toneFor(e.category)}>{humanize(e.category)}</Badge>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Button variant="secondary" onClick={() => review(e, "REJECT")}>Reject</Button>
                <Button onClick={() => review(e, "APPROVE")}>Approve &amp; publish</Button>
              </div>
            </Card>
          ))}
        </div>
      </Modal>
    </div>
  );
}
