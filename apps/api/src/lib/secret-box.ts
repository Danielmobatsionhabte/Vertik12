import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env, isProd } from "../config/env";

/**
 * Authenticated encryption for secrets the admin types into the app and the
 * server must later replay verbatim — currently the SMTP password.
 *
 * Hashing is not an option here: the mailer has to present the actual
 * password to the mail server, so it must be reversible. AES-256-GCM gives
 * confidentiality *and* integrity, so a tampered ciphertext fails loudly
 * instead of decrypting to garbage that gets sent to an SMTP server.
 *
 * The key is derived from MAIL_ENCRYPTION_KEY, falling back to
 * JWT_ACCESS_SECRET so a fresh install works with no extra configuration —
 * production already refuses to boot with the default JWT secret, so the
 * fallback is never a weak key in a real deployment. Rotating either value
 * makes stored ciphertext undecryptable by design: `decryptSecret` returns
 * null and the admin re-enters the password.
 */

const KEY_SALT = "vertik12.secret-box.v1";
const VERSION = "v1";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  // scrypt is deliberately slow, so derive once per process, not per call.
  cachedKey ??= scryptSync(env.MAIL_ENCRYPTION_KEY ?? env.JWT_ACCESS_SECRET, KEY_SALT, 32);
  return cachedKey;
}

/** True when secrets are protected by a key set explicitly for the job. */
export function usingDedicatedKey(): boolean {
  return !!env.MAIL_ENCRYPTION_KEY;
}

/**
 * Encrypt a secret for storage. Output is
 * `v1:<iv>:<authTag>:<ciphertext>`, all base64 — self-describing, so a
 * future algorithm change can be told apart from this one.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, the GCM standard
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * Decrypt a stored secret. Returns null — never throws — when the value is
 * missing, malformed, or was encrypted under a different key: the caller
 * treats that as "no password configured" and prompts for a new one, which
 * beats crashing every outbound email after a key rotation.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered payload — GCM's auth tag check failed.
    return null;
  }
}

/** Constant-time compare, for anything that must not leak length/prefix by timing. */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

if (isProd && !usingDedicatedKey()) {
  console.warn(
    "[secret-box] MAIL_ENCRYPTION_KEY is not set — stored SMTP passwords are encrypted with a key derived " +
    "from JWT_ACCESS_SECRET. Set MAIL_ENCRYPTION_KEY so rotating JWT secrets does not invalidate them.",
  );
}
