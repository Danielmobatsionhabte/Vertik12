import { z } from "zod";
import {
  ROLES, GENDERS, STUDENT_STATUSES, STAFF_TYPES, STAFF_STATUSES,
  ATTENDANCE_STATUSES, PAYMENT_METHODS, FEE_FREQUENCIES, ANNOUNCEMENT_AUDIENCES,
  DAYS_OF_WEEK, PAYMENT_PERIODS, EXAM_CATEGORIES, LESSON_PLAN_STATUSES,
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

/**
 * Document attachments (teacher's assignment brief, parent's submission).
 * Only PDF, JPEG, PNG and Word documents are accepted; the base64 body is
 * capped at ~5 MB. The API decodes and stores it in the document store.
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

// ---------- list queries ----------
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;
