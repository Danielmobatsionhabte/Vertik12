"use client";

import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES, type AttachmentInput } from "@vertik12/shared";
import { getSession } from "./api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Turn a picked <input type="file"> file into the base64 attachment payload
 * the API accepts. Validates type and size client-side so users get an
 * immediate, friendly error (the API re-validates everything).
 */
export async function fileToAttachment(file: File): Promise<AttachmentInput> {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("Only PDF, JPG, PNG and Word (.doc/.docx) files can be attached");
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error("The file is too large — 5 MB maximum");
  }
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // result = "data:<mime>;base64,<data>" — strip the prefix.
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type as AttachmentInput["type"], dataBase64 };
}

/**
 * Download a protected attachment (Authorization header required, so a
 * plain <a href> won't do): fetch as a blob, then trigger a save.
 */
export async function downloadAttachment(path: string, fallbackName = "attachment"): Promise<void> {
  const session = getSession();
  const res = await fetch(`${API_URL}${path}`, {
    headers: session ? { Authorization: `Bearer ${session.accessToken}` } : {},
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
