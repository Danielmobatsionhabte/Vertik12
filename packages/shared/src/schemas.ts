import { z } from "zod";
import {
  ROLES, GENDERS, STUDENT_STATUSES, STAFF_TYPES, STAFF_STATUSES,
  ATTENDANCE_STATUSES, PAYMENT_METHODS, FEE_FREQUENCIES, ANNOUNCEMENT_AUDIENCES,
  DAYS_OF_WEEK, PAYMENT_PERIODS, EXAM_CATEGORIES, LESSON_PLAN_STATUSES,
  CALENDAR_CATEGORIES, CALENDAR_AUDIENCES, CALENDAR_EVENT_STATUSES,
  SCHEDULE_REQUEST_KINDS, STAFF_DOCUMENT_CATEGORIES, minutesOfDay,
} from "./constants";

/**
 * Zod schemas validate every mutating API request (see the API `validate`
 * middleware) and double as form validators on the web app. Types are
 * inferred from these schemas so the contract can never drift.
 */

// ---------- primitives ----------
const isoDate = z.coerce.date();
const money = z.number().int().nonnegative(); // integer minor units (cents)
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");

/**
 * Hardened free-text primitive: trimmed, length-capped, and control
 * characters (null bytes, escape sequences) rejected. Combined with
 * parameterized queries (Prisma) and React's output encoding this closes
 * the practical SQL-injection / stored-XSS input vectors.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const safeText = (max: number, min = 1) =>
  z.string().trim().min(min).max(max).refine((v) => !CONTROL_CHARS.test(v), {
    message: "Contains invalid control characters",
  });

/** Email: normalized to lowercase, RFC length cap. */
const email = z.string().trim().toLowerCase().email().max(254);

/**
 * Grade-level code. Grades are admin-configured per school (GradeLevelDef),
 * so this is a shape check only — services verify the code exists in the
 * school's ladder where it matters (admissions, class creation).
 */
export const gradeCode = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9 _.-]+$/, "Invalid grade code");

/**
 * Password policy for NEW passwords: length-bounded (a bcrypt DoS guard)
 * and requires letters + digits so admin-issued accounts can't be reset to
 * trivially guessable values.
 */
export const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

/**
 * Document attachments — assignment briefs, parent submissions, student
 * paperwork and HR files all share this shape. Only PDF, JPEG, PNG and Word
 * documents are accepted; the base64 body is capped at ~5 MB. The API
 * decodes it and stores the body in the document store.
 */
export const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx";

export const attachmentSchema = z.object({
  name: safeText(200).refine((n) => !/[\\/]/.test(n), "Invalid file name"),
  type: z.enum(ATTACHMENT_MIME_TYPES),
  // base64 inflates ~4/3, so cap the encoded length accordingly.
  dataBase64: z
    .string()
    .min(1)
    .max(Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 4, "File is too large (max 5 MB)")
    .regex(/^[A-Za-z0-9+/=]+$/, "Invalid file data"),
});
export type AttachmentInput = z.infer<typeof attachmentSchema>;

// ---------- auth ----------
export const loginSchema = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: strongPassword,
});

export const createUserSchema = z.object({
  email,
  password: strongPassword,
  firstName: safeText(100),
  lastName: safeText(100),
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

// ---------- students ----------
const phone = z.string().trim().min(5).max(30).regex(/^[+()\-\s0-9]+$/, "Invalid phone number");

export const guardianSchema = z.object({
  firstName: safeText(100),
  lastName: safeText(100),
  relation: safeText(40), // e.g. "Mother", "Father", "Guardian"
  email: email.optional().or(z.literal("")),
  phone,
  occupation: safeText(100, 0).optional(),
  isPrimary: z.boolean().default(false),
});

export const createStudentSchema = z.object({
  firstName: safeText(100),
  lastName: safeText(100),
  dateOfBirth: isoDate,
  gender: z.enum(GENDERS),
  gradeLevel: gradeCode,
  email: email.optional().or(z.literal("")),
  phone: phone.optional().or(z.literal("")),
  // Full postal address — every part optional.
  addressLine1: safeText(200, 0).optional(), // street
  addressLine2: safeText(100, 0).optional(), // unit / apartment / suite
  city: safeText(100, 0).optional(),
  state: safeText(100, 0).optional(), // state / province / region
  postalCode: safeText(20, 0).optional(), // ZIP / postal code
  country: safeText(100, 0).optional(),
  nationality: safeText(100, 0).optional(), // country of citizenship
  placeOfBirth: safeText(100, 0).optional(),
  bloodGroup: safeText(5, 0).optional(),
  medicalNotes: safeText(2_000, 0).optional(),
  photoUrl: z.string().url().max(500).optional().or(z.literal("")),
  classRoomId: id.optional(),
  guardians: z.array(guardianSchema).max(6).default([]),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = createStudentSchema
  .omit({ guardians: true })
  .partial()
  .extend({ status: z.enum(STUDENT_STATUSES).optional() });

// ---------- staff ----------

/**
 * Paperwork on an employee's file — identification, background check, work
 * authorization, contract… Filed at registration or later from the staff
 * member's management screen.
 */
export const staffDocumentSchema = z.object({
  label: safeText(100), // e.g. "Passport", "DBS certificate", "Work permit"
  category: z.enum(STAFF_DOCUMENT_CATEGORIES).default("OTHER"),
  /** Renewal date for the documents that lapse (permits, checks, medicals). */
  expiresAt: isoDate.optional(),
  note: safeText(500, 0).optional(),
  attachment: attachmentSchema, // PDF/JPG/PNG/Word, max 5 MB
});
export type StaffDocumentInput = z.infer<typeof staffDocumentSchema>;

/** Metadata-only edit (re-file under another category, set an expiry). */
export const updateStaffDocumentSchema = staffDocumentSchema
  .omit({ attachment: true })
  .partial()
  .extend({ clearExpiry: z.boolean().optional() });
export type UpdateStaffDocumentInput = z.infer<typeof updateStaffDocumentSchema>;

export const createStaffSchema = z.object({
  firstName: safeText(100),
  lastName: safeText(100),
  email,
  password: strongPassword.optional(), // omit to auto-generate
  role: z.enum(["ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"]),
  staffType: z.enum(STAFF_TYPES),
  designation: safeText(100), // e.g. "Mathematics Teacher"
  department: safeText(100, 0).optional(),
  phone: phone.optional().or(z.literal("")),
  joinDate: isoDate,
  qualifications: safeText(500, 0).optional(),
  /**
   * HR paperwork collected during registration (ID, background check, work
   * authorization…). Optional — anything missing on the day can be added
   * later from the staff member's management screen.
   */
  documents: z.array(staffDocumentSchema).max(10).default([]),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = createStaffSchema
  .omit({ password: true, email: true, role: true })
  .partial()
  .extend({ status: z.enum(STAFF_STATUSES).optional() });

// ---------- academics ----------
export const createAcademicYearSchema = z.object({
  name: z.string().min(4), // e.g. "2026-2027"
  startDate: isoDate,
  endDate: isoDate,
  isActive: z.boolean().default(false),
});

export const createTermSchema = z.object({
  name: z.string().min(1), // e.g. "Term 1"
  academicYearId: id,
  startDate: isoDate,
  endDate: isoDate,
});

export const createClassRoomSchema = z.object({
  name: z.string().min(1), // e.g. "Grade 5 — A", "KG1 — B (West Campus)"
  gradeLevel: gradeCode,
  section: z.string().min(1).default("A"),
  branch: z.string().optional().or(z.literal("")), // campus/branch label
  capacity: z.coerce.number().int().positive().default(30),
  academicYearId: id,
  homeroomTeacherId: id.optional(),
});

export const createSubjectSchema = z.object({
  code: z.string().min(2), // e.g. "MATH"
  name: z.string().min(2),
  description: z.string().optional(),
  gradeLevel: gradeCode.optional(), // omit = offered in all grades
});

export const assignSubjectSchema = z.object({
  classRoomId: id,
  subjectId: id,
  teacherId: id.optional(),
});

/** 24-hour clock time, e.g. "08:00". */
export const clockTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Expected a time like 08:00");

export const timetableSlotSchema = z
  .object({
    classRoomId: id,
    subjectId: id,
    teacherId: id.optional(),
    dayOfWeek: z.enum(DAYS_OF_WEEK),
    startTime: clockTime,
    endTime: clockTime,
    room: safeText(60, 0).optional(),
    note: safeText(300, 0).optional(),
  })
  // A period that ends before it starts would slip past every overlap check.
  .refine((v) => minutesOfDay(v.endTime) > minutesOfDay(v.startTime), {
    message: "The end time must be after the start time",
    path: ["endTime"],
  });
export type TimetableSlotInput = z.infer<typeof timetableSlotSchema>;

/**
 * Moving an existing period. Every field is optional (the service merges
 * with the stored slot), so the end-after-start rule is re-checked in the
 * service against the merged result rather than here.
 */
export const updateTimetableSlotSchema = z.object({
  classRoomId: id.optional(),
  subjectId: id.optional(),
  teacherId: id.nullable().optional(),
  dayOfWeek: z.enum(DAYS_OF_WEEK).optional(),
  startTime: clockTime.optional(),
  endTime: clockTime.optional(),
  room: safeText(60, 0).nullable().optional(),
  note: safeText(300, 0).nullable().optional(),
});
export type UpdateTimetableSlotInput = z.infer<typeof updateTimetableSlotSchema>;

/** Filters for reading the timetable (week grid, teacher load, room usage). */
export const timetableQuerySchema = z.object({
  academicYearId: id.optional(), // omit = the active year
  classRoomId: id.optional(),
  teacherId: id.optional(),
  subjectId: id.optional(),
  dayOfWeek: z.enum(DAYS_OF_WEEK).optional(),
});
export type TimetableQuery = z.infer<typeof timetableQuerySchema>;

/**
 * "Who is free at this time?" — powers the availability picker the
 * registrar uses when placing or rescheduling a period.
 */
export const availabilityQuerySchema = z.object({
  academicYearId: id.optional(),
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  startTime: clockTime,
  endTime: clockTime,
  /** Ignore this slot when checking — the one being moved. */
  excludeSlotId: id.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

// ---------- schedule change requests ----------

/**
 * A teacher asking the registrar to move a period they can't make. The
 * proposed day/time is optional — "any time on Thursday works" is a valid
 * request, and the registrar decides.
 */
export const scheduleChangeRequestSchema = z
  .object({
    slotId: id,
    kind: z.enum(SCHEDULE_REQUEST_KINDS).default("CHANGE"),
    reason: safeText(1_000),
    proposedDayOfWeek: z.enum(DAYS_OF_WEEK).optional(),
    proposedStartTime: clockTime.optional(),
    proposedEndTime: clockTime.optional(),
    proposedTeacherId: id.optional(),
  })
  .refine((v) => !(v.proposedStartTime && !v.proposedEndTime) && !(v.proposedEndTime && !v.proposedStartTime), {
    message: "Give both a start and an end time, or neither",
    path: ["proposedEndTime"],
  })
  .refine(
    (v) => !v.proposedStartTime || !v.proposedEndTime || minutesOfDay(v.proposedEndTime) > minutesOfDay(v.proposedStartTime),
    { message: "The end time must be after the start time", path: ["proposedEndTime"] },
  )
  .refine((v) => v.kind !== "SWAP" || !!v.proposedTeacherId, {
    message: "Choose the colleague who will cover the period",
    path: ["proposedTeacherId"],
  });
export type ScheduleChangeRequestInput = z.infer<typeof scheduleChangeRequestSchema>;

/**
 * Registrar/admin decision. Approving a CHANGE applies the move — either
 * the teacher's proposal or the reviewer's own override — and re-runs the
 * conflict checks, so an approval can never break the timetable.
 */
export const reviewScheduleRequestSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: safeText(500, 0).optional(),
  dayOfWeek: z.enum(DAYS_OF_WEEK).optional(),
  startTime: clockTime.optional(),
  endTime: clockTime.optional(),
  teacherId: id.nullable().optional(),
  room: safeText(60, 0).nullable().optional(),
});
export type ReviewScheduleRequestInput = z.infer<typeof reviewScheduleRequestSchema>;

// ---------- school calendar ----------

/**
 * A school-calendar event. Dates are inclusive; a single-day event sends
 * the same date twice (the API defaults endDate to startDate when omitted).
 */
export const calendarEventSchema = z
  .object({
    title: safeText(200),
    description: safeText(5_000, 0).optional(),
    category: z.enum(CALENDAR_CATEGORIES).default("OTHER"),
    audience: z.enum(CALENDAR_AUDIENCES).default("ALL"),
    startDate: isoDate,
    endDate: isoDate.optional(), // omit = single-day event
    allDay: z.boolean().default(true),
    startTime: clockTime.optional(),
    endTime: clockTime.optional(),
    location: safeText(200, 0).optional(),
    academicYearId: id.optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: "The end date cannot be before the start date",
    path: ["endDate"],
  })
  .refine((v) => v.allDay || (!!v.startTime && !!v.endTime), {
    message: "A timed event needs a start and an end time",
    path: ["startTime"],
  })
  .refine(
    (v) => v.allDay || !v.startTime || !v.endTime || minutesOfDay(v.endTime) > minutesOfDay(v.startTime),
    { message: "The end time must be after the start time", path: ["endTime"] },
  );
export type CalendarEventInput = z.infer<typeof calendarEventSchema>;

export const updateCalendarEventSchema = z.object({
  title: safeText(200).optional(),
  description: safeText(5_000, 0).nullable().optional(),
  category: z.enum(CALENDAR_CATEGORIES).optional(),
  audience: z.enum(CALENDAR_AUDIENCES).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  allDay: z.boolean().optional(),
  startTime: clockTime.nullable().optional(),
  endTime: clockTime.nullable().optional(),
  location: safeText(200, 0).nullable().optional(),
  academicYearId: id.nullable().optional(),
});
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventSchema>;

/** Admin sign-off on an event proposed by a teacher, parent or student. */
export const reviewCalendarEventSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: safeText(500, 0).optional(),
});
export type ReviewCalendarEventInput = z.infer<typeof reviewCalendarEventSchema>;

/** Calendar reads are always "everything overlapping this window". */
export const calendarQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: z.enum(CALENDAR_CATEGORIES).optional(),
  academicYearId: id.optional(),
  /** Admins only — "PENDING" opens the proposal review queue. */
  status: z.enum(CALENDAR_EVENT_STATUSES).optional(),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

/**
 * Enrol existing students into a class of a given academic year (bulk).
 * Used for new-year rollover: assign last year's students to this year's
 * classes. Admin/Registrar only.
 */
export const bulkEnrollSchema = z.object({
  classRoomId: id,
  studentIds: z.array(id).min(1, "Select at least one student"),
});
export type BulkEnrollInput = z.infer<typeof bulkEnrollSchema>;

// ---------- attendance ----------
export const markAttendanceSchema = z.object({
  classRoomId: id,
  subjectId: id.optional(), // teachers must mark for a subject they teach; omit = general/homeroom
  date: isoDate,
  records: z
    .array(z.object({ studentId: id, status: z.enum(ATTENDANCE_STATUSES), note: z.string().optional() }))
    .min(1),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

// ---------- exams & grades ----------
export const createExamSchema = z.object({
  name: z.string().min(1), // e.g. "Term 1 Exam", "Weekly Test 3"
  // Free string validated against the admin-managed ExamType list server-side.
  category: z.string().min(1).default("OTHER"),
  termId: id,
  weight: z.number().min(0).max(100).default(100), // % contribution to final grade
  startDate: isoDate.optional(),
});

export const updateExamSchema = createExamSchema.partial();

export const examTypeSchema = z.object({ name: z.string().min(2).max(40) });

/** Teacher sends one class × subject × assessment's marks to the registrar. */
export const submitResultsSchema = z.object({
  examId: id,
  classRoomId: id,
  subjectId: id,
});

export const reviewSubmissionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(500).optional(),
});

// ---------- assignments (teacher → students/parents) ----------

export const createAssignmentSchema = z.object({
  classSubjectId: id,
  title: safeText(200),
  instructions: safeText(10_000),
  dueDate: isoDate,
  attachment: attachmentSchema.optional(),
});
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

/** Teachers may modify what they sent; `removeAttachment` clears the file. */
export const updateAssignmentSchema = z.object({
  title: safeText(200).optional(),
  instructions: safeText(10_000).optional(),
  dueDate: isoDate.optional(),
  attachment: attachmentSchema.optional(),
  removeAttachment: z.boolean().optional(),
});
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const submitAssignmentSchema = z
  .object({
    assignmentId: id,
    studentId: id,
    content: safeText(50_000, 0).default(""), // stored in the document store
    linkUrl: z.string().url().max(500).optional().or(z.literal("")),
    attachment: attachmentSchema.optional(),
  })
  .refine((v) => v.content.trim().length > 0 || v.attachment, {
    message: "Write the work or attach a document",
    path: ["content"],
  });
export type SubmitAssignmentInput = z.infer<typeof submitAssignmentSchema>;

export const feedbackSchema = z.object({
  feedback: safeText(2_000),
  grade: safeText(10, 0).optional(),
});

export const recordResultsSchema = z.object({
  examId: id,
  subjectId: id,
  classRoomId: id,
  maxMarks: z.number().positive().default(100),
  results: z
    .array(z.object({ studentId: id, marks: z.number().min(0), remark: z.string().optional() }))
    .min(1),
});
export type RecordResultsInput = z.infer<typeof recordResultsSchema>;

// ---------- finance ----------
export const createFeeStructureSchema = z.object({
  name: safeText(150), // e.g. "Tuition — Grade 5"
  gradeLevel: gradeCode.optional(), // undefined = applies to all grades
  amount: money.refine((v) => v > 0, "Amount must be positive"),
  frequency: z.enum(FEE_FREQUENCIES),
  academicYearId: id,
  description: safeText(500, 0).optional(),
});

export const createInvoiceSchema = z.object({
  studentId: id,
  dueDate: isoDate,
  items: z
    .array(z.object({ description: safeText(200), amount: money, feeStructureId: id.optional() }))
    .min(1)
    .max(50),
  notes: safeText(1_000, 0).optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Generate one invoice per active student of a grade from fee structures. */
export const bulkInvoiceSchema = z.object({
  gradeLevel: gradeCode,
  feeStructureIds: z.array(id).min(1),
  dueDate: isoDate,
});

export const recordPaymentSchema = z.object({
  invoiceId: id,
  amount: money.refine((v) => v > 0, "Amount must be positive"),
  method: z.enum(PAYMENT_METHODS),
  reference: safeText(100, 0).optional(), // receipt no / bank ref
  note: safeText(500, 0).optional(),
  paidAt: isoDate.optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** SUPER_ADMIN-only: reverse a succeeded payment. */
export const refundPaymentSchema = z.object({
  reason: safeText(500),
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

export const checkoutSchema = z.object({
  invoiceId: id,
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/**
 * Registrar cashier flow: invoice + payment in one step. MONTHLY bills the
 * grade's monthly fee structures once; YEARLY bills 12 months (plus annual
 * fees) with the admin-configured yearly discount applied.
 */
export const collectPaymentSchema = z.object({
  studentId: id,
  period: z.enum(PAYMENT_PERIODS),
  /** MONTHLY only: pay several months ahead at once (no yearly discount). */
  months: z.coerce.number().int().min(1).max(12).default(1),
  method: z.enum(PAYMENT_METHODS),
  reference: safeText(100, 0).optional(),
  /**
   * Override of the admin's per-grade preset: when provided, this exact
   * amount (cents) is billed instead of the fee-structure computation.
   */
  customAmount: money.refine((v) => v > 0, "Amount must be positive").optional(),
  /**
   * Additional one-off charges collected together with the fee (uniform,
   * books, trip, registration…). Each becomes its own line item on the
   * invoice/receipt and is added on top of the fee amount. Cents.
   */
  extras: z
    .array(z.object({
      description: safeText(200),
      amount: money.refine((v) => v > 0, "Amount must be positive"),
    }))
    .max(10)
    .optional(),
  /** Free-text note shown on the receipt / transaction detail. */
  note: safeText(500, 0).optional(),
});
export type CollectPaymentInput = z.infer<typeof collectPaymentSchema>;

// ---------- payroll ----------
export const salaryComponentSchema = z.object({
  name: z.string().min(1), // e.g. "Housing Allowance", "Income Tax"
  amount: money,
});

export const upsertSalaryStructureSchema = z.object({
  staffId: id,
  basicSalary: money,
  payFrequency: z.enum(["MONTHLY", "BIWEEKLY"]).default("MONTHLY"),
  currency: z.string().length(3).default("USD"),
  allowances: z.array(salaryComponentSchema).default([]),
  deductions: z.array(salaryComponentSchema).default([]),
  effectiveFrom: isoDate.optional(),
});

/** One-off bonus on a payslip while its run is still a draft. */
export const payslipBonusSchema = z.object({ bonus: money });

/** Create the parent's web-portal login from a student's guardian record. */
export const guardianPortalAccountSchema = z.object({
  email: z.string().email(),
});
export type UpsertSalaryStructureInput = z.infer<typeof upsertSalaryStructureSchema>;

export const createPayrollRunSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  notes: z.string().optional(),
});
export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>;

/**
 * Advanced payslip filter powering the payroll report. Period bounds are
 * inclusive "YYYY-MM" keys (matching <input type="month">); every filter
 * combines with AND. Amounts are integer cents like the rest of the API.
 */
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
export const payrollReportQuerySchema = z.object({
  from: monthKey.optional(),
  to: monthKey.optional(),
  /** Matches staff no, designation, first or last name. */
  search: z.string().trim().min(1).max(100).optional(),
  department: z.string().trim().min(1).max(100).optional(),
  staffType: z.enum(["TEACHING", "NON_TEACHING"]).optional(),
  runStatus: z.enum(["DRAFT", "APPROVED", "PAID"]).optional(),
  payslipStatus: z.enum(["PENDING", "PAID"]).optional(),
  minNet: z.coerce.number().int().nonnegative().optional(),
  maxNet: z.coerce.number().int().nonnegative().optional(),
});
export type PayrollReportQuery = z.infer<typeof payrollReportQuerySchema>;

/**
 * Admin edits a payslip's amounts while its run is still a draft. Omitted
 * fields keep their current value; component lists are replaced wholesale.
 * Gross, total deductions and net always recompute server-side.
 */
export const updatePayslipSchema = z
  .object({
    basicSalary: money.optional(),
    bonus: money.optional(),
    allowances: z.array(salaryComponentSchema).optional(),
    deductions: z.array(salaryComponentSchema).optional(),
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: "Provide at least one field to change",
  });
export type UpdatePayslipInput = z.infer<typeof updatePayslipSchema>;

// ---------- announcements ----------
export const createAnnouncementSchema = z.object({
  title: safeText(200),
  body: safeText(10_000),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  pinned: z.boolean().default(false),
});

// ---------- administration (Super Admin) ----------
export const adminUpdateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
});

export const schoolSettingsSchema = z.object({
  schoolName: z.string().min(1),
  motto: z.string().optional().or(z.literal("")),
  logoUrl: z.string().url().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  currency: z.string().length(3),
  timezone: z.string().min(1),
  passwordMinLength: z.coerce.number().int().min(8).max(64),
  sessionTimeoutMinutes: z.coerce.number().int().min(5).max(720),
  yearlyDiscountPercent: z.coerce.number().min(0).max(100),
  /**
   * Master switch for the public "Register" form on the landing page. The
   * admission window is a season, not a permanent state — the admin opens
   * it when intake starts and closes it when the period is over, at which
   * point the public form stops accepting submissions entirely.
   */
  onlineRegistrationOpen: z.boolean().default(false),
  /** Shown to families on the public form (deadline, required papers…). */
  onlineRegistrationNote: safeText(1_000, 0).optional().or(z.literal("")),
});
export type SchoolSettingsInput = z.infer<typeof schoolSettingsSchema>;

// ---------- outgoing mail server (Administration › Email) ----------

/**
 * The school's own SMTP server. Vertik12 is deployed per school, each
 * sending from its own domain, so this is configured in the app rather
 * than through environment variables.
 *
 * `password` is write-only: reads never return it (they report
 * `hasPassword` instead), and saving without it keeps the stored one — so
 * editing the port doesn't force the admin to retype the password.
 */
export const mailSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    host: z.string().trim().max(255).optional().or(z.literal("")),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    /** True = implicit TLS (port 465). False = STARTTLS, the 587 default. */
    secure: z.boolean().default(false),
    username: z.string().trim().max(255).optional().or(z.literal("")),
    password: z.string().max(512).optional(),
    /** Omit to keep the stored password; true to remove it entirely. */
    clearPassword: z.boolean().optional(),
    fromName: safeText(100, 0).optional(),
    fromEmail: email.optional().or(z.literal("")),
    replyTo: email.optional().or(z.literal("")),
  })
  // Turning the switch on without a server would silently swallow every
  // email, so the two must be consistent before the row is saved.
  .refine((v) => !v.enabled || !!v.host, {
    message: "Enter the mail server host before enabling delivery",
    path: ["host"],
  })
  .refine((v) => !v.enabled || !!v.fromEmail, {
    message: "Enter the address emails are sent from",
    path: ["fromEmail"],
  });
export type MailSettingsInput = z.infer<typeof mailSettingsSchema>;

/** "Send a test email to…" — proves the configuration end to end. */
export const testMailSchema = z.object({ to: email });
export type TestMailInput = z.infer<typeof testMailSchema>;

/** Admin › Grading: the whole scale is replaced atomically. */
export const gradeBandsSchema = z.object({
  bands: z
    .array(z.object({
      letter: z.string().min(1).max(3),
      minPercent: z.number().min(0).max(100),
      points: z.number().min(0).max(5),
    }))
    .min(2, "A grading scale needs at least two bands")
    .refine((bands) => new Set(bands.map((b) => b.minPercent)).size === bands.length, {
      message: "Each band needs a distinct minimum percentage",
    }),
});
export type GradeBandsInput = z.infer<typeof gradeBandsSchema>;

// ---------- messaging ----------
export const composeMessageSchema = z.object({
  recipientId: id,
  subject: safeText(200),
  body: safeText(10_000),
});
export type ComposeMessageInput = z.infer<typeof composeMessageSchema>;

// ---------- payroll: paystub email ----------
export const emailPayslipSchema = z.object({
  /** Defaults to the staff member's account email when omitted. */
  email: email.optional(),
});
export type EmailPayslipInput = z.infer<typeof emailPayslipSchema>;

/**
 * Email a payroll report (e.g. the yearly summary: from 2026-01 to 2026-12).
 * Same filters as the on-screen report so what is emailed is what is shown.
 */
export const emailPayrollReportSchema = payrollReportQuerySchema.extend({
  /** Defaults to the signed-in admin's email when omitted. */
  email: email.optional(),
});
export type EmailPayrollReportInput = z.infer<typeof emailPayrollReportSchema>;

// ---------- grade levels (admin-configured ladder) ----------
export const gradeDefSchema = z.object({
  code: gradeCode, // stored on students/classes/subjects/fees
  name: safeText(60), // display label, e.g. "Year 7", "KG 1"
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export type GradeDefInput = z.infer<typeof gradeDefSchema>;

// ---------- lesson plans ----------
export const createLessonPlanSchema = z.object({
  gradeLevel: gradeCode,
  subjectId: id,
  week: z.coerce.number().int().min(1).max(52).optional(),
  title: safeText(200),
  objectives: safeText(5_000),
  materials: safeText(2_000, 0).optional(),
  activities: safeText(10_000),
  assessment: safeText(2_000, 0).optional(),
  notes: safeText(2_000, 0).optional(),
  status: z.enum(LESSON_PLAN_STATUSES).default("PUBLISHED"),
  attachment: attachmentSchema.optional(),
});
export type CreateLessonPlanInput = z.infer<typeof createLessonPlanSchema>;

export const updateLessonPlanSchema = createLessonPlanSchema
  .omit({ attachment: true })
  .partial()
  .extend({
    attachment: attachmentSchema.optional(),
    removeAttachment: z.boolean().optional(),
  });
export type UpdateLessonPlanInput = z.infer<typeof updateLessonPlanSchema>;

/** Admin sign-off on a teacher's submitted plan. */
export const reviewLessonPlanSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: safeText(500, 0).optional(),
});
export type ReviewLessonPlanInput = z.infer<typeof reviewLessonPlanSchema>;

// ---------- student documents (guardian ID, certificates…) ----------
export const studentDocumentSchema = z.object({
  label: safeText(100), // e.g. "Guardian ID — Father", "Birth certificate"
  attachment: attachmentSchema, // PDF/JPG/PNG/Word, max 5 MB (webcam shots are JPEG)
});
export type StudentDocumentInput = z.infer<typeof studentDocumentSchema>;

// ---------- student photo ----------
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const studentPhotoSchema = z.object({
  name: safeText(200).refine((n) => !/[\\/]/.test(n), "Invalid file name"),
  type: z.enum(PHOTO_MIME_TYPES),
  dataBase64: z
    .string()
    .min(1)
    .max(Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4, "Photo is too large (max 2 MB)")
    .regex(/^[A-Za-z0-9+/=]+$/, "Invalid file data"),
});
export type StudentPhotoInput = z.infer<typeof studentPhotoSchema>;

// ---------- public (parent) registration ----------

/**
 * A family registering their own child from the public site, with no
 * account and no session. It is the registrar's admission form minus the
 * decisions that belong to the school (class placement, status), plus the
 * files carried in the same request — an anonymous submitter cannot make
 * the follow-up upload calls the staff form makes.
 *
 * Everything lands as a PENDING student for a registrar to review.
 */
export const PUBLIC_REGISTRATION_MAX_DOCUMENTS = 6;

/**
 * Ceiling on the encoded bytes in one submission, kept under the API's 8 MB
 * body cap so an over-stuffed form gets this explained rejection instead of
 * the body parser's bare 413.
 */
export const PUBLIC_REGISTRATION_MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

export const publicRegistrationSchema = createStudentSchema
  // Placement is the registrar's call once the application is approved.
  .omit({ classRoomId: true, guardians: true })
  .extend({
    /**
     * Families are asked outright whether the child already attends the
     * school, so a returning pupil's paperwork is matched to the record
     * that exists instead of being filed as a duplicate admission.
     */
    isReturning: z.boolean().default(false),
    /** The child's existing admission number, when the family has it. */
    priorAdmissionNo: safeText(40, 0).optional(),
    // Unlike staff admission, a family must name at least one guardian —
    // there is no front-office record to fall back on.
    guardians: z.array(guardianSchema).min(1, "At least one parent/guardian is required").max(6),
    photo: studentPhotoSchema.optional(),
    documents: z.array(studentDocumentSchema).max(PUBLIC_REGISTRATION_MAX_DOCUMENTS).default([]),
  })
  .refine(
    (v) =>
      (v.photo?.dataBase64.length ?? 0) + v.documents.reduce((n, d) => n + d.attachment.dataBase64.length, 0) <=
      Math.ceil((PUBLIC_REGISTRATION_MAX_UPLOAD_BYTES * 4) / 3),
    { message: "The photo and documents are too large together — remove one or upload smaller scans", path: ["documents"] },
  );
export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;

// ---------- list queries ----------
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;
