import type { PublicRegistrationInput } from "@vertik12/shared";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { sendMail } from "../../lib/mailer";
import { registrationReceivedEmail } from "../../lib/email-templates";
import { documentStore } from "../../lib/document-store";
import { assertGradeExists, listGrades } from "../academics/academics.service";
import { getSettings } from "../admin/admin.service";

// Same document-store collections the staff admission path writes to, so a
// registrar opening the record sees the family's uploads exactly as if the
// front office had scanned them in.
const PHOTOS = "student-photos";
const DOCUMENTS = "student-documents";

/**
 * What the public site is allowed to know before anyone submits anything:
 * whether the window is open, the school's own wording for it, and the
 * grade ladder the form's dropdown needs. Nothing else about the school
 * leaks through this unauthenticated route.
 */
export async function registrationStatus() {
  const settings = await getSettings();
  // Grades are only worth loading when the form can actually be used.
  const grades = settings.onlineRegistrationOpen ? await listGrades() : [];
  return {
    open: settings.onlineRegistrationOpen,
    note: settings.onlineRegistrationNote,
    schoolName: settings.schoolName,
    grades: grades.map((g) => ({ code: g.code, name: g.name })),
  };
}

/**
 * A family's own registration of their child.
 *
 * The record is created as PENDING and marked ONLINE: it is visible to the
 * registrar immediately but counts as a student nowhere — dashboard totals,
 * fee generation, payment collection and year rollover all filter on
 * ACTIVE. Only a registrar or admin changing the status admits the child.
 */
export async function submitRegistration(input: PublicRegistrationInput) {
  const settings = await getSettings();
  // Re-checked here, not just on the form: the window can close between the
  // page load and the submit, and this route is reachable without the page.
  if (!settings.onlineRegistrationOpen) {
    throw ApiError.badRequest(
      "Online registration is closed at the moment. Please contact the school office to register your child.",
    );
  }

  const { guardians, photo, documents, isReturning, priorAdmissionNo, ...data } = input;
  await assertGradeExists(input.gradeLevel); // ladder is admin-configured

  // A family that submits twice (impatient re-click, or a second try after a
  // network error) must not create two applications for the same child.
  const dateOfBirth = new Date(input.dateOfBirth);
  const duplicate = await prisma.student.findFirst({
    where: {
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth,
      status: "PENDING",
    },
  });
  if (duplicate) {
    throw ApiError.conflict(
      `A registration for ${input.firstName} ${input.lastName} is already awaiting review (reference ${duplicate.admissionNo}). ` +
      `Please contact the school office instead of submitting again.`,
    );
  }

  const student = await prisma.$transaction(async (tx) => {
    // Sequential per year, like the front office's — same counter, so a
    // reviewed application keeps the number the family was already given.
    const year = new Date().getFullYear();
    const count = await tx.student.count({ where: { admissionNo: { startsWith: `VRT-${year}-` } } });
    const admissionNo = `VRT-${year}-${String(count + 1).padStart(4, "0")}`;

    const created = await tx.student.create({
      data: {
        ...data,
        dateOfBirth,
        email: data.email || null,
        photoUrl: data.photoUrl || null,
        admissionNo,
        status: "PENDING",
        registrationSource: "ONLINE",
        isReturning,
        priorAdmissionNo: priorAdmissionNo || null,
      },
    });

    for (const g of guardians) {
      const { relation, isPrimary, ...guardianData } = g;
      const guardian = await tx.guardian.create({ data: { ...guardianData, email: guardianData.email || null } });
      await tx.studentGuardian.create({
        data: { studentId: created.id, guardianId: guardian.id, relation, isPrimary },
      });
    }
    return created;
  });

  // Uploads are stored after the record exists, so a document-store outage
  // costs the family their attachments, never the registration itself —
  // the registrar can still see the application and ask for the papers.
  if (photo) {
    try {
      const photoRef = await documentStore.put(PHOTOS, { name: photo.name, type: photo.type, data: photo.dataBase64 });
      await prisma.student.update({ where: { id: student.id }, data: { photoRef, photoType: photo.type } });
    } catch (err) {
      console.error("[registration] photo upload failed:", err);
    }
  }

  for (const doc of documents) {
    try {
      const fileRef = await documentStore.put(DOCUMENTS, {
        name: doc.attachment.name,
        type: doc.attachment.type,
        data: doc.attachment.dataBase64,
      });
      await prisma.studentDocument.create({
        data: {
          studentId: student.id,
          label: doc.label,
          fileRef,
          fileName: doc.attachment.name,
          fileType: doc.attachment.type,
          // No uploader: nobody was signed in. The record's ONLINE source
          // is what says where the file came from.
          uploadedById: null,
        },
      });
    } catch (err) {
      console.error("[registration] document upload failed:", err);
    }
  }

  // EMAIL PATH: registration received → the guardians who gave an address.
  // Fire-and-forget: a mail outage must never fail the submission.
  const recipients = [...new Set(guardians.map((g) => g.email).filter((e): e is string => !!e))];
  const html = registrationReceivedEmail({
    studentName: `${student.firstName} ${student.lastName}`,
    reference: student.admissionNo,
    gradeLevel: student.gradeLevel,
    schoolName: settings.schoolName,
  });
  for (const to of recipients) {
    void sendMail({ to, subject: `We received your registration — ${student.firstName} ${student.lastName}`, html })
      .catch((err) => console.error("[mailer] registration confirmation failed:", err));
  }

  // Deliberately narrow: the family gets their reference back, nothing more.
  return {
    reference: student.admissionNo,
    studentName: `${student.firstName} ${student.lastName}`,
    status: student.status,
    emailedTo: recipients,
  };
}
