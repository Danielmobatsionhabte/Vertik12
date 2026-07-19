import type { AttachmentInput, CreateLessonPlanInput, PaginationQuery, UpdateLessonPlanInput } from "@vertik12/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { paginate, toSkipTake } from "../../lib/pagination";
import { documentStore } from "../../lib/document-store";
import { assertGradeExists } from "../academics/academics.service";

const ATTACHMENTS = "lesson-plan-attachments"; // document-store collection

type Actor = { userId: string; role: string };

const storeAttachment = (file: AttachmentInput) =>
  documentStore.put(ATTACHMENTS, { name: file.name, type: file.type, data: file.dataBase64 });

/**
 * Curriculum lesson plans, per grade × subject.
 *
 * Ownership rules:
 *  - ADMIN / SUPER_ADMIN publish the plans every teacher of that grade and
 *    subject follows, and may edit or remove ANY plan.
 *  - TEACHERS may add plans too, but only modify/remove their own.
 *  - DRAFT plans are visible to their author and the administration only;
 *    PUBLISHED plans are visible to all staff who can open the module.
 */

const isAdmin = (role: string) => role === "ADMIN" || role === "SUPER_ADMIN";

/**
 * The subject × grade pairs this teacher is assigned to (via ClassSubject
 * in the active year). Teachers only ever see/manage lesson plans inside
 * their own pairs — another teacher's subjects stay invisible to them.
 */
async function teachingPairs(userId: string): Promise<Array<{ subjectId: string; gradeLevel: string }>> {
  const assignments = await prisma.classSubject.findMany({
    where: { teacher: { is: { userId } }, classRoom: { academicYear: { isActive: true } } },
    select: { subjectId: true, classRoom: { select: { gradeLevel: true } } },
  });
  const seen = new Set<string>();
  const pairs: Array<{ subjectId: string; gradeLevel: string }> = [];
  for (const a of assignments) {
    const key = `${a.subjectId}:${a.classRoom.gradeLevel}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ subjectId: a.subjectId, gradeLevel: a.classRoom.gradeLevel });
    }
  }
  return pairs;
}

/** Global editing lock — the admin closes the curriculum once complete. */
export async function getLock(): Promise<boolean> {
  const settings = await prisma.schoolSettings.findUnique({ where: { id: "school" }, select: { lessonPlansLocked: true } });
  return settings?.lessonPlansLocked ?? false;
}

export async function setLock(locked: boolean) {
  await prisma.schoolSettings.upsert({
    where: { id: "school" },
    create: { id: "school", lessonPlansLocked: locked },
    update: { lessonPlansLocked: locked },
  });
  return { locked };
}

/** Teachers are blocked while the admin has editing locked; admins never are. */
async function assertNotLocked(actor: Actor) {
  if (isAdmin(actor.role)) return;
  if (await getLock()) {
    throw ApiError.forbidden(
      "Lesson-plan editing is locked by the administration. Ask an administrator to re-open it if changes are needed.",
    );
  }
}

export async function listPlans(
  actor: Actor,
  q: PaginationQuery & { gradeLevel?: string; subjectId?: string; status?: string; week?: number; mine?: boolean },
) {
  // Advanced search/filter: every condition is AND-combined, and the
  // visibility rule (non-admins see published plans + their own work in any
  // state) always applies regardless of the other filters.
  const conditions: Prisma.LessonPlanWhereInput[] = [];
  if (q.gradeLevel) conditions.push({ gradeLevel: q.gradeLevel });
  if (q.subjectId) conditions.push({ subjectId: q.subjectId });
  if (q.status) conditions.push({ status: q.status });
  if (q.week) conditions.push({ week: q.week });
  if (q.mine) conditions.push({ createdById: actor.userId });
  if (q.search) {
    conditions.push({
      OR: [
        { title: { contains: q.search } },
        { objectives: { contains: q.search } },
        { activities: { contains: q.search } },
        { materials: { contains: q.search } },
        { assessment: { contains: q.search } },
        { notes: { contains: q.search } },
      ],
    });
  }
  if (actor.role === "REGISTRAR") {
    // Registrars are read-only observers of the curriculum: they see every
    // published plan (for the calendar/printout) but never drafts or
    // pending submissions, and they cannot manage anything.
    conditions.push({ status: "PUBLISHED" });
  } else if (!isAdmin(actor.role)) {
    // Teachers only see plans for the subject × grade pairs THEY teach
    // (published ones), plus everything they authored themselves. Other
    // teachers' subjects are invisible to them.
    const pairs = await teachingPairs(actor.userId);
    conditions.push({
      OR: [
        { createdById: actor.userId },
        ...pairs.map((p) => ({ status: "PUBLISHED", subjectId: p.subjectId, gradeLevel: p.gradeLevel })),
      ],
    });
  }
  const where: Prisma.LessonPlanWhereInput = conditions.length ? { AND: conditions } : {};

  const [items, total] = await Promise.all([
    prisma.lessonPlan.findMany({
      where,
      orderBy: [{ gradeLevel: "asc" }, { week: "asc" }, { updatedAt: "desc" }],
      ...toSkipTake(q),
      include: { subject: { select: { id: true, code: true, name: true } } },
    }),
    prisma.lessonPlan.count({ where }),
  ]);

  // Resolve author names in one query for the list display.
  const authorIds = [...new Set(items.map((p) => p.createdById))];
  const authors = authorIds.length
    ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, firstName: true, lastName: true, role: true } })
    : [];
  const withAuthors = items.map((p) => {
    const a = authors.find((u) => u.id === p.createdById);
    return {
      ...p,
      author: a ? { name: `${a.firstName} ${a.lastName}`, role: a.role } : null,
      canManage: isAdmin(actor.role) || p.createdById === actor.userId,
    };
  });
  return paginate(withAuthors, total, q);
}

async function assertCanManage(planId: string, actor: Actor) {
  const plan = await prisma.lessonPlan.findUnique({ where: { id: planId } });
  if (!plan) throw ApiError.notFound("Lesson plan");
  if (!isAdmin(actor.role) && plan.createdById !== actor.userId) {
    throw ApiError.forbidden("Only the author or an administrator can change this lesson plan");
  }
  return plan;
}

/**
 * Teachers never publish directly: anything they submit becomes PENDING and
 * waits for admin approval. Their private DRAFTs stay drafts. Admins
 * publish (or draft) immediately.
 */
function effectiveStatus(requested: string | undefined, actor: Actor): string {
  if (isAdmin(actor.role)) return requested ?? "PUBLISHED";
  return requested === "DRAFT" ? "DRAFT" : "PENDING";
}

/** Teachers may only write plans inside their own subject × grade pairs. */
async function assertOwnPair(actor: Actor, subjectId: string, gradeLevel: string) {
  if (isAdmin(actor.role)) return;
  const pairs = await teachingPairs(actor.userId);
  if (!pairs.some((p) => p.subjectId === subjectId && p.gradeLevel === gradeLevel)) {
    throw ApiError.forbidden("You can only add lesson plans for the subjects and grades assigned to you");
  }
}

export async function createPlan(input: CreateLessonPlanInput, actor: Actor) {
  await assertNotLocked(actor);
  await assertGradeExists(input.gradeLevel);
  const subject = await prisma.subject.findUnique({ where: { id: input.subjectId } });
  if (!subject) throw ApiError.notFound("Subject");
  // A grade-scoped subject can only carry plans for its own grade.
  if (subject.gradeLevel && subject.gradeLevel !== input.gradeLevel) {
    throw ApiError.badRequest(`${subject.name} is a grade ${subject.gradeLevel} subject`);
  }
  await assertOwnPair(actor, input.subjectId, input.gradeLevel);
  const { attachment, ...data } = input;
  const attachmentRef = attachment ? await storeAttachment(attachment) : null;
  return prisma.lessonPlan.create({
    data: {
      ...data,
      status: effectiveStatus(input.status, actor),
      createdById: actor.userId,
      attachmentRef,
      attachmentName: attachment?.name ?? null,
      attachmentType: attachment?.type ?? null,
    },
  });
}

export async function updatePlan(planId: string, input: UpdateLessonPlanInput, actor: Actor) {
  await assertNotLocked(actor);
  const existing = await assertCanManage(planId, actor);
  if (input.gradeLevel) await assertGradeExists(input.gradeLevel);
  // Re-targeting a plan must stay inside the teacher's own assignments.
  if (input.subjectId || input.gradeLevel) {
    await assertOwnPair(actor, input.subjectId ?? existing.subjectId, input.gradeLevel ?? existing.gradeLevel);
  }
  const { attachment, removeAttachment, ...data } = input;
  const attachmentRef = attachment ? await storeAttachment(attachment) : undefined;
  return prisma.lessonPlan.update({
    where: { id: planId },
    data: {
      ...data,
      // A teacher's modification un-publishes the plan until an admin
      // re-approves it (previous verdict cleared). Admins only change the
      // status when they explicitly set one.
      ...(isAdmin(actor.role)
        ? input.status
          ? { status: input.status }
          : {}
        : {
            status: input.status === "DRAFT" ? "DRAFT" : "PENDING",
            reviewNote: null,
            reviewedById: null,
            reviewedAt: null,
          }),
      ...(attachment
        ? { attachmentRef, attachmentName: attachment.name, attachmentType: attachment.type }
        : removeAttachment
          ? { attachmentRef: null, attachmentName: null, attachmentType: null }
          : {}),
    },
  });
}

/** Admin verdict on a PENDING submission: APPROVE → PUBLISHED, REJECT → back to the author. */
export async function reviewPlan(planId: string, action: "APPROVE" | "REJECT", note: string | undefined, actor: Actor) {
  const plan = await prisma.lessonPlan.findUnique({ where: { id: planId } });
  if (!plan) throw ApiError.notFound("Lesson plan");
  if (plan.status !== "PENDING") {
    throw ApiError.badRequest(`Only pending submissions can be reviewed (this plan is ${plan.status.toLowerCase()})`);
  }
  return prisma.lessonPlan.update({
    where: { id: planId },
    data: {
      status: action === "APPROVE" ? "PUBLISHED" : "REJECTED",
      reviewNote: note ?? null,
      reviewedById: actor.userId,
      reviewedAt: new Date(),
    },
  });
}

export async function deletePlan(planId: string, actor: Actor) {
  await assertNotLocked(actor);
  await assertCanManage(planId, actor);
  return prisma.lessonPlan.delete({ where: { id: planId } });
}

/** Download the plan's attached worksheet/resource file. */
export async function planAttachment(planId: string, actor: Actor) {
  const plan = await prisma.lessonPlan.findUnique({ where: { id: planId } });
  if (!plan) throw ApiError.notFound("Lesson plan");
  // Readable by admins and the author; registrars for any published plan;
  // other teachers only when it is published AND belongs to a subject ×
  // grade pair they teach.
  if (!isAdmin(actor.role) && plan.createdById !== actor.userId) {
    if (plan.status !== "PUBLISHED") {
      throw ApiError.forbidden("This lesson plan has not been published yet");
    }
    if (actor.role !== "REGISTRAR") {
      const pairs = await teachingPairs(actor.userId);
      if (!pairs.some((p) => p.subjectId === plan.subjectId && p.gradeLevel === plan.gradeLevel)) {
        throw ApiError.forbidden("This lesson plan is not for a subject you teach");
      }
    }
  }
  if (!plan.attachmentRef) throw ApiError.notFound("Attachment");
  const doc = await documentStore.get(ATTACHMENTS, plan.attachmentRef);
  if (!doc) throw ApiError.notFound("Attachment");
  return {
    name: (doc.name as string) ?? "attachment",
    type: (doc.type as string) ?? "application/octet-stream",
    buffer: Buffer.from((doc.data as string) ?? "", "base64"),
  };
}
