import { BRAND } from "@vertik12/shared";
import { env } from "../config/env";

/**
 * Branded HTML for every transactional email the API sends. Inline styles
 * only (email clients ignore stylesheets), one shared layout so all mail
 * looks like it came from the same product.
 */

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** First CORS origin = the web app's public URL (login links in emails). */
export function portalUrl(): string {
  return env.CORS_ORIGIN.split(",")[0]?.trim() ?? "http://localhost:3000";
}

export function emailLayout(title: string, bodyHtml: string): string {
  return `
  <div style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 55%,#c026d3 100%);padding:20px 28px">
        <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700">${esc(BRAND.appName)}</p>
        <p style="margin:2px 0 0;color:rgba(255,255,255,.85);font-size:12px">${esc(BRAND.tagline)}</p>
      </div>
      <div style="padding:28px">
        <h1 style="margin:0 0 16px;font-size:18px;color:#0f172a">${esc(title)}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #e2e8f0;background:#f8fafc">
        <p style="margin:0;font-size:11px;color:#94a3b8">
          This is an automated message from ${esc(BRAND.appName)} — please do not reply.
          Powered by ${esc(BRAND.poweredBy)}.
        </p>
      </div>
    </div>
  </div>`;
}

const row = (label: string, value: string) => `
  <tr>
    <td style="padding:6px 12px;font-size:13px;color:#64748b;white-space:nowrap">${esc(label)}</td>
    <td style="padding:6px 12px;font-size:13px;color:#0f172a;font-weight:600">${esc(value)}</td>
  </tr>`;

const detailsTable = (rows: Array<[string, string | undefined | null]>) => `
  <table style="border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:12px 0">
    ${rows.filter((r): r is [string, string] => !!r[1]).map(([l, v]) => row(l, v)).join("")}
  </table>`;

const button = (label: string, href: string) => `
  <p style="margin:20px 0 8px">
    <a href="${esc(href)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 22px;border-radius:8px">${esc(label)}</a>
  </p>`;

const passwordNote = (temporaryPassword?: string) =>
  temporaryPassword
    ? `<p style="font-size:13px;color:#334155">Your temporary password is
         <code style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;padding:2px 8px;font-size:13px">${esc(temporaryPassword)}</code>
         — you will be asked to choose your own password the first time you sign in.</p>`
    : `<p style="font-size:13px;color:#334155">Your administrator will share your temporary password with you; you will choose your own password the first time you sign in.</p>`;

// ============================ templates ============================

export function staffWelcomeEmail(p: {
  firstName: string;
  staffNo: string;
  role: string;
  designation: string;
  email: string;
  temporaryPassword?: string;
}): string {
  return emailLayout(
    `Welcome aboard, ${p.firstName}!`,
    `<p style="font-size:14px;color:#334155">Your staff account at ${esc(BRAND.appName)} has been created.</p>
     ${detailsTable([
       ["Staff number", p.staffNo],
       ["Designation", p.designation],
       ["Portal role", p.role],
       ["Sign-in email", p.email],
     ])}
     ${passwordNote(p.temporaryPassword)}
     ${button("Open your portal", `${portalUrl()}/login`)}`,
  );
}

export function studentWelcomeEmail(p: {
  firstName: string;
  lastName: string;
  admissionNo: string;
  gradeLevel: string;
  className?: string;
}): string {
  return emailLayout(
    `Welcome to ${BRAND.appName}!`,
    `<p style="font-size:14px;color:#334155">
       ${esc(p.firstName)} ${esc(p.lastName)} has been registered successfully. Keep this email —
       the admission number below identifies the student in all school matters.
     </p>
     ${detailsTable([
       ["Admission number", p.admissionNo],
       ["Grade", p.gradeLevel],
       ["Class", p.className],
     ])}
     <p style="font-size:13px;color:#334155">The school will reach out with portal access details for following
     grades, attendance, assignments and fees online.</p>`,
  );
}

export function parentPortalEmail(p: { firstName: string; email: string; temporaryPassword: string }): string {
  return emailLayout(
    `Your parent portal access`,
    `<p style="font-size:14px;color:#334155">Hello ${esc(p.firstName)}, your ${esc(BRAND.appName)} parent portal
       account is ready. Sign in to follow your child's grades, attendance, assignments and fees.</p>
     ${detailsTable([["Sign-in email", p.email]])}
     ${passwordNote(p.temporaryPassword)}
     ${button("Open the parent portal", `${portalUrl()}/login`)}`,
  );
}

export function accountCreatedEmail(p: { firstName: string; role: string; email: string }): string {
  return emailLayout(
    `Your ${BRAND.appName} account`,
    `<p style="font-size:14px;color:#334155">Hello ${esc(p.firstName)}, an account has been created for you.</p>
     ${detailsTable([
       ["Sign-in email", p.email],
       ["Portal role", p.role],
     ])}
     ${passwordNote()}
     ${button("Open your portal", `${portalUrl()}/login`)}`,
  );
}

export function passwordResetEmail(p: { firstName: string; email: string; temporaryPassword: string }): string {
  return emailLayout(
    `Your password was reset`,
    `<p style="font-size:14px;color:#334155">Hello ${esc(p.firstName)}, an administrator has reset the password for
       <strong>${esc(p.email)}</strong>. Any open sessions were signed out.</p>
     ${passwordNote(p.temporaryPassword)}
     ${button("Sign in", `${portalUrl()}/login`)}
     <p style="font-size:12px;color:#94a3b8">If you did not expect this, contact your school administrator immediately.</p>`,
  );
}

/**
 * Sent by Administration › Email › "Send test email". Arriving in the
 * inbox — not bouncing, not landing in spam — is the proof the school's
 * own mail server is wired up correctly.
 */
export function testEmail(p: { requestedBy: string; host: string; source: string }): string {
  return emailLayout(
    `Your mail server is working`,
    `<p style="font-size:14px;color:#334155">This is a test message from ${esc(BRAND.appName)}. If you are reading it,
       the school's outgoing mail server is configured correctly and staff, students and parents will receive their
       account, invoice and payslip emails.</p>
     ${detailsTable([
       ["Mail server", p.host],
       ["Configuration", p.source === "database" ? "Administration › Email" : "Server environment (SMTP_*)"],
       ["Requested by", p.requestedBy],
       ["Sent at", new Date().toUTCString()],
     ])}
     <p style="font-size:12px;color:#94a3b8">No action is needed — this message was triggered manually from the
       administration screen.</p>`,
  );
}
