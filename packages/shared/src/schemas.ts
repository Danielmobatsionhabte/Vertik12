import { z } from "zod";
import {
  ROLES, GRADE_LEVELS, GENDERS, STUDENT_STATUSES, STAFF_TYPES, STAFF_STATUSES,
  ATTENDANCE_STATUSES, PAYMENT_METHODS, FEE_FREQUENCIES, ANNOUNCEMENT_AUDIENCES,
  DAYS_OF_WEEK, PAYMENT_PERIODS, EXAM_CATEGORIES,
} from "./constants";

/**
 * Zod schemas validate every mutating API request (see the API `validate`
 * middleware) and double as form validators on the web app. Types are
 * inferred from these schemas so the contract can never drift.
 */

// ---------- primitives ----------
const isoDate = z.coerce.date();
const money = z.number().int().nonnegative(); // integer minor units (cents)
const id = z.string().min(1);

// ---------- auth ----------
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

// ---------- students ----------
export const guardianSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  relation: z.string().min(1), // e.g. "Mother", "Father", "Guardian"
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().min(5),
  occupation: z.string().optional(),
  isPrimary: z.boolean().default(false),
});

export const createStudentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: isoDate,
  gender: z.enum(GENDERS),
  gradeLevel: z.enum(GRADE_LEVELS),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  nationality: z.string().optional(),
  bloodGroup: z.string().optional(),
  medicalNotes: z.string().optional(),
  photoUrl: z.string().url().optional().or(z.literal("")),
  classRoomId: id.optional(),
  guardians: z.array(guardianSchema).default([]),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = createStudentSchema
  .omit({ guardians: true })
  .partial()
  .extend({ status: z.enum(STUDENT_STATUSES).optional() });

// ---------- staff ----------
export const createStaffSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).optional(), // omit to auto-generate
  role: z.enum(["ADMIN", "REGISTRAR", "TEACHER", "ACCOUNTANT"]),
  staffType: z.enum(STAFF_TYPES),
  designation: z.string().min(1), // e.g. "Mathematics Teacher"
  department: z.string().optional(),
  phone: z.string().optional(),
  joinDate: isoDate,
  qualifications: z.string().optional(),
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
  gradeLevel: z.enum(GRADE_LEVELS),
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
  gradeLevel: z.enum(GRADE_LEVELS).optional(), // omit = offered in all grades
});

export const assignSubjectSchema = z.object({
  classRoomId: id,
  subjectId: id,
  teacherId: id.optional(),
});

export const timetableSlotSchema = z.object({
  classRoomId: id,
  subjectId: id,
  teacherId: id.optional(),
  dayOfWeek: z.enum(DAYS_OF_WEEK),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:MM"),
});

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
  title: z.string().min(1).max(200),
  instructions: z.string().min(1).max(10_000),
  dueDate: isoDate,
});
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const submitAssignmentSchema = z.object({
  assignmentId: id,
  studentId: id,
  content: z.string().min(1).max(50_000), // stored in the document store
  linkUrl: z.string().url().optional().or(z.literal("")),
});
export type SubmitAssignmentInput = z.infer<typeof submitAssignmentSchema>;

export const feedbackSchema = z.object({
  feedback: z.string().min(1).max(2_000),
  grade: z.string().max(10).optional(),
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
  name: z.string().min(1), // e.g. "Tuition — Grade 5"
  gradeLevel: z.enum(GRADE_LEVELS).optional(), // undefined = applies to all grades
  amount: money,
  frequency: z.enum(FEE_FREQUENCIES),
  academicYearId: id,
  description: z.string().optional(),
});

export const createInvoiceSchema = z.object({
  studentId: id,
  dueDate: isoDate,
  items: z
    .array(z.object({ description: z.string().min(1), amount: money, feeStructureId: id.optional() }))
    .min(1),
  notes: z.string().optional(),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Generate one invoice per active student of a grade from fee structures. */
export const bulkInvoiceSchema = z.object({
  gradeLevel: z.enum(GRADE_LEVELS),
  feeStructureIds: z.array(id).min(1),
  dueDate: isoDate,
});

export const recordPaymentSchema = z.object({
  invoiceId: id,
  amount: money.refine((v) => v > 0, "Amount must be positive"),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().optional(), // receipt no / bank ref
  paidAt: isoDate.optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

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
  reference: z.string().optional(),
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

// ---------- announcements ----------
export const createAnnouncementSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
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
});
export type SchoolSettingsInput = z.infer<typeof schoolSettingsSchema>;

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
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});
export type ComposeMessageInput = z.infer<typeof composeMessageSchema>;

// ---------- list queries ----------
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;
