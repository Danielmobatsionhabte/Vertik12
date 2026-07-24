/**
 * Domain constants shared by the API and the web app.
 *
 * The database (SQLite in dev) stores these as plain strings, so these
 * const arrays + Zod enums are the single source of truth for allowed values.
 * When migrating to PostgreSQL you can promote them to native Prisma enums.
 */

export const ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "REGISTRAR",
  "TEACHER",
  "ACCOUNTANT",
  "STUDENT",
  "PARENT",
] as const;
export type Role = (typeof ROLES)[number];

/** Roles allowed to sign in to the staff/admin portal. */
export const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"];

/**
 * Family portal roles. They READ the school calendar like everyone else but
 * never write to it — a parent or student cannot propose an event, so the
 * administration's review queue only ever holds staff suggestions.
 */
export const FAMILY_ROLES: Role[] = ["PARENT", "STUDENT"];

/**
 * Module-level access per role — the single source of truth for both the
 * web sidebar and a human-readable summary of the API guards.
 *
 *  - SUPER_ADMIN: everything, plus the Administration module (users, audit
 *    logs, school configuration).
 *  - ADMIN: day-to-day school management (no system administration).
 *  - REGISTRAR: student records, admissions/enrolment, attendance reports,
 *    transcripts & report cards, scheduling support. No finance, no HR.
 *  - TEACHER: own classes — attendance, exams/gradebook, read-only student
 *    records, announcements. No finance, HR, or user management.
 *  - ACCOUNTANT: finance + payroll, read-only people records.
 *  - PARENT: the parent portal only (children, grades, attendance, fees).
 */
export const MODULES = [
  "dashboard", "students", "staff", "classes", "attendance", "exams", "assignments",
  "lessons", "calendar", "schedule", "finance", "payroll", "announcements", "messages", "admin", "portal",
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const ROLE_MODULES: Record<Role, ModuleKey[]> = {
  SUPER_ADMIN: ["dashboard", "students", "staff", "classes", "attendance", "exams", "assignments", "lessons", "calendar", "schedule", "finance", "payroll", "announcements", "messages", "admin"],
  ADMIN: ["dashboard", "students", "staff", "classes", "attendance", "exams", "assignments", "lessons", "calendar", "schedule", "finance", "payroll", "announcements", "messages"],
  // Registrar processes student fee payments (finance), but not payroll/HR.
  // Lessons is read-only for them (published plans + the calendar view).
  // Timetabling is core registrar work — they build it alongside the admin.
  REGISTRAR: ["dashboard", "students", "classes", "attendance", "exams", "lessons", "calendar", "schedule", "finance", "announcements", "messages"],
  // Teachers: academics only — no finance, payroll, HR or student admission.
  // Schedule is read-only for them: their own periods, plus the change
  // request they file when they can't make one.
  TEACHER: ["dashboard", "students", "classes", "attendance", "exams", "assignments", "lessons", "calendar", "schedule", "announcements", "messages"],
  ACCOUNTANT: ["dashboard", "students", "staff", "calendar", "finance", "payroll", "announcements", "messages"],
  // Families also get Messages so the school can write to them directly
  // (and they can reply) — with the same unread badge as staff.
  // The school calendar is visible to every stakeholder, in every portal.
  PARENT: ["portal", "calendar", "messages", "announcements"],
  STUDENT: ["portal", "calendar", "messages", "announcements"],
};

/**
 * Lesson-plan workflow. Teachers submit (PENDING) and wait for admin
 * approval; admins publish directly. REJECTED goes back to the author with
 * a note. DRAFT stays private to the author.
 */
export const LESSON_PLAN_STATUSES = ["DRAFT", "PENDING", "PUBLISHED", "REJECTED"] as const;
export type LessonPlanStatus = (typeof LESSON_PLAN_STATUSES)[number];

export const PAYMENT_PERIODS = ["MONTHLY", "YEARLY"] as const;
export type PaymentPeriod = (typeof PAYMENT_PERIODS)[number];

/** Default assessment types; admins manage the live list in the database. */
export const EXAM_CATEGORIES = ["ASSIGNMENT", "WEEKLY_TEST", "TERM_EXAM", "FINAL_EXAM", "OTHER"] as const;
export type ExamCategory = (typeof EXAM_CATEGORIES)[number];

export const PAY_FREQUENCIES = ["MONTHLY", "BIWEEKLY"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

/**
 * Teacher → Registrar result sign-off. No submission = draft (editable by
 * the teacher). SUBMITTED/APPROVED lock editing; REJECTED reopens it.
 */
export const RESULT_SUBMISSION_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"] as const;
export type ResultSubmissionStatus = (typeof RESULT_SUBMISSION_STATUSES)[number];

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  SUPER_ADMIN: "/dashboard",
  ADMIN: "/dashboard",
  REGISTRAR: "/dashboard",
  TEACHER: "/dashboard",
  ACCOUNTANT: "/dashboard",
  PARENT: "/portal",
  STUDENT: "/portal",
};

/**
 * DEFAULT grade ladder (K = Kindergarten). Grade levels are now
 * admin-configurable per school (GradeLevelDef in the database) because
 * naming varies by country — this constant only seeds the defaults for a
 * fresh installation and orders legacy data.
 */
export const GRADE_LEVELS = [
  "K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

/** Country names for the citizenship / place-of-birth dropdowns. */
export const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia",
  "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium",
  "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria",
  "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad",
  "Chile", "China", "Colombia", "Comoros", "Congo (Republic)", "Congo (DRC)", "Costa Rica", "Côte d'Ivoire",
  "Croatia", "Cuba", "Cyprus", "Czechia", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador",
  "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland",
  "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea",
  "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq",
  "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kosovo",
  "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein",
  "Lithuania", "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands",
  "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco",
  "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger",
  "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama",
  "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia",
  "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino",
  "São Tomé and Príncipe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
  "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea", "South Sudan", "Spain",
  "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
  "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan",
  "Tuvalu", "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
  "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
] as const;

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * PENDING is where a family's own online registration lands: the record
 * exists and is reviewable, but the child is not a student yet — every
 * ACTIVE-only query (dashboard counts, fee generation, payment collection,
 * year rollover) skips them until a registrar or admin promotes the record.
 */
export const STUDENT_STATUSES = ["PENDING", "ACTIVE", "GRADUATED", "TRANSFERRED", "WITHDRAWN", "SUSPENDED"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** Who filed the record: the front office, or the family on the public site. */
export const REGISTRATION_SOURCES = ["OFFICE", "ONLINE"] as const;
export type RegistrationSource = (typeof REGISTRATION_SOURCES)[number];

export const STAFF_TYPES = ["TEACHING", "NON_TEACHING"] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export const STAFF_STATUSES = ["ACTIVE", "ON_LEAVE", "TERMINATED", "RESIGNED"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

/**
 * HR paperwork filed against an employee. The category drives grouping and
 * the expiry chase-list — work permits, background checks and medical
 * clearances are the ones that lapse.
 */
export const STAFF_DOCUMENT_CATEGORIES = [
  "IDENTIFICATION", "BACKGROUND_CHECK", "WORK_AUTHORIZATION", "QUALIFICATION",
  "CONTRACT", "MEDICAL", "REFERENCE", "OTHER",
] as const;
export type StaffDocumentCategory = (typeof STAFF_DOCUMENT_CATEGORIES)[number];

/** Human labels — the enum names are terse for storage, not for people. */
export const STAFF_DOCUMENT_CATEGORY_LABELS: Record<StaffDocumentCategory, string> = {
  IDENTIFICATION: "Identification",
  BACKGROUND_CHECK: "Background check",
  WORK_AUTHORIZATION: "Work authorization",
  QUALIFICATION: "Qualification / certificate",
  CONTRACT: "Contract",
  MEDICAL: "Medical clearance",
  REFERENCE: "Reference",
  OTHER: "Other",
};

/** Categories that routinely expire — the UI nudges for a date on these. */
export const EXPIRING_STAFF_DOCUMENT_CATEGORIES: StaffDocumentCategory[] = [
  "BACKGROUND_CHECK", "WORK_AUTHORIZATION", "MEDICAL", "IDENTIFICATION",
];

/** A document is "expiring soon" inside this window (days). */
export const STAFF_DOCUMENT_EXPIRY_WARNING_DAYS = 60;

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["CARD", "BANK_TRANSFER", "CASH", "CHEQUE", "MOBILE_MONEY"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FEE_FREQUENCIES = ["ONE_TIME", "MONTHLY", "TERMLY", "ANNUAL"] as const;
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number];

export const PAYROLL_RUN_STATUSES = ["DRAFT", "APPROVED", "PAID"] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYSLIP_STATUSES = ["PENDING", "PAID"] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];

export const ANNOUNCEMENT_AUDIENCES = ["ALL", "STAFF", "STUDENTS", "PARENTS"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const DAYS_OF_WEEK = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

// ============================== school calendar ==============================

/**
 * Event types on the school calendar. The category drives the colour every
 * portal renders the event in (see CALENDAR_CATEGORY_TONES).
 */
export const CALENDAR_CATEGORIES = [
  "TERM", "HOLIDAY", "EXAM", "MEETING", "ACTIVITY", "SPORTS", "TRAINING", "DEADLINE", "OTHER",
] as const;
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number];

/** Category → badge tone, shared so every portal colours events identically. */
export const CALENDAR_CATEGORY_TONES: Record<CalendarCategory, string> = {
  TERM: "brand",
  HOLIDAY: "green",
  EXAM: "red",
  MEETING: "blue",
  ACTIVITY: "yellow",
  SPORTS: "green",
  TRAINING: "blue",
  DEADLINE: "red",
  OTHER: "gray",
};

/** Who a calendar event is addressed to (same shape as announcements). */
export const CALENDAR_AUDIENCES = ["ALL", "STAFF", "STUDENTS", "PARENTS"] as const;
export type CalendarAudience = (typeof CALENDAR_AUDIENCES)[number];

/**
 * Calendar workflow. The administration publishes directly; every other
 * stakeholder's event lands as PENDING for an admin to approve or reject.
 */
export const CALENDAR_EVENT_STATUSES = ["PUBLISHED", "PENDING", "REJECTED"] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

/** Roles whose calendar events are published without review. */
export const CALENDAR_PUBLISHER_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN"];

// ============================== timetabling ==============================

/**
 * What a teacher is asking for when they can't make a period.
 *  - CHANGE: move it to another day/time (optionally proposing one)
 *  - SWAP:   hand it to a named colleague
 *  - CANCEL: drop the period from their load entirely
 */
export const SCHEDULE_REQUEST_KINDS = ["CHANGE", "SWAP", "CANCEL"] as const;
export type ScheduleRequestKind = (typeof SCHEDULE_REQUEST_KINDS)[number];

export const SCHEDULE_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type ScheduleRequestStatus = (typeof SCHEDULE_REQUEST_STATUSES)[number];

/** Roles that build and approve the timetable. */
export const SCHEDULE_MANAGER_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "REGISTRAR"];

/**
 * Why a proposed period cannot be placed. The API returns these so the UI
 * can explain the clash precisely instead of "save failed".
 */
export type ScheduleConflictKind = "CLASS" | "TEACHER" | "ROOM";

export interface ScheduleConflict {
  kind: ScheduleConflictKind;
  message: string;
  slotId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  className: string;
  subjectName: string;
  teacherName: string | null;
  room: string | null;
}

// ---------- time helpers (shared so API and web agree exactly) ----------

/** "08:45" → 525 minutes past midnight. Returns NaN for malformed input. */
export function minutesOfDay(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.NaN;
  return hours * 60 + minutes;
}

/**
 * Do two periods on the same day overlap?
 *
 * Half-open intervals: a period ending at 09:00 and one starting at 09:00
 * are back-to-back, not a clash — which is exactly how school periods run.
 */
export function periodsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const [as, ae, bs, be] = [minutesOfDay(aStart), minutesOfDay(aEnd), minutesOfDay(bStart), minutesOfDay(bEnd)];
  if ([as, ae, bs, be].some(Number.isNaN)) return false;
  return as < be && bs < ae;
}

/** "08:00"–"08:45" → "08:00 — 08:45". */
export function formatPeriod(startTime: string, endTime: string): string {
  return `${startTime} — ${endTime}`;
}

/** Letter grade bands used for report cards. Percentage lower bounds, checked in order. */
export const GRADE_BANDS: ReadonlyArray<{ letter: string; min: number; points: number }> = [
  { letter: "A+", min: 97, points: 4.0 },
  { letter: "A", min: 93, points: 4.0 },
  { letter: "A-", min: 90, points: 3.7 },
  { letter: "B+", min: 87, points: 3.3 },
  { letter: "B", min: 83, points: 3.0 },
  { letter: "B-", min: 80, points: 2.7 },
  { letter: "C+", min: 77, points: 2.3 },
  { letter: "C", min: 73, points: 2.0 },
  { letter: "C-", min: 70, points: 1.7 },
  { letter: "D", min: 60, points: 1.0 },
  { letter: "F", min: 0, points: 0.0 },
];

export function letterGradeFor(percentage: number): { letter: string; points: number } {
  const band = GRADE_BANDS.find((b) => percentage >= b.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1]!;
  return { letter: band.letter, points: band.points };
}

/** All money values are stored as integer minor units (e.g. cents). */
export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export const BRAND = {
  appName: "Vertik12",
  poweredBy: "CloudPunkt LLC",
  tagline: "The global Student Information Management System",
} as const;
