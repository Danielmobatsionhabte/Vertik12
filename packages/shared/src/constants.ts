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
  "finance", "payroll", "announcements", "messages", "admin", "portal",
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const ROLE_MODULES: Record<Role, ModuleKey[]> = {
  SUPER_ADMIN: ["dashboard", "students", "staff", "classes", "attendance", "exams", "assignments", "finance", "payroll", "announcements", "messages", "admin"],
  ADMIN: ["dashboard", "students", "staff", "classes", "attendance", "exams", "assignments", "finance", "payroll", "announcements", "messages"],
  // Registrar processes student fee payments (finance), but not payroll/HR.
  REGISTRAR: ["dashboard", "students", "classes", "attendance", "exams", "finance", "announcements", "messages"],
  // Teachers: academics only — no finance, payroll, HR or student admission.
  TEACHER: ["dashboard", "students", "classes", "attendance", "exams", "assignments", "announcements", "messages"],
  ACCOUNTANT: ["dashboard", "students", "staff", "finance", "payroll", "announcements", "messages"],
  // Families also get Messages so the school can write to them directly
  // (and they can reply) — with the same unread badge as staff.
  PARENT: ["portal", "messages", "announcements"],
  STUDENT: ["portal", "messages", "announcements"],
};

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

/** K-12 grade levels, ordered. "K" = Kindergarten. */
export const GRADE_LEVELS = [
  "K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
] as const;
export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export type Gender = (typeof GENDERS)[number];

export const STUDENT_STATUSES = ["ACTIVE", "GRADUATED", "TRANSFERRED", "WITHDRAWN", "SUSPENDED"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const STAFF_TYPES = ["TEACHING", "NON_TEACHING"] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export const STAFF_STATUSES = ["ACTIVE", "ON_LEAVE", "TERMINATED", "RESIGNED"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

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
  poweredBy: "CloudPunkt",
  tagline: "The global K-12 Student Information Management System",
} as const;
