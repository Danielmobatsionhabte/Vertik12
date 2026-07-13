export { formatMoney } from "@vertik12/shared";

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  // Date-only values (attendance days, due dates) are stored at midnight
  // UTC. Formatting them in the viewer's timezone shifts them a day in
  // either direction — always render such values in UTC.
  const isMidnightUtc =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(isMidnightUtc ? { timeZone: "UTC" } : {}),
  });
}

/**
 * A date as YYYY-MM-DD in the USER'S timezone (for <input type="date">).
 * Never use `toISOString().slice(0, 10)` for "today": that returns the UTC
 * calendar date, which is one day ahead (or behind) around midnight in any
 * non-UTC timezone — the cause of attendance showing the wrong day.
 */
export function localDateIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthLabel(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`;
}

/** "GRADE_LEVEL" → "Grade level" for enum-ish strings. */
export function humanize(value: string): string {
  const s = value.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function gradeLabel(gradeLevel: string): string {
  return gradeLevel === "K" ? "Kindergarten" : `Grade ${gradeLevel}`;
}
