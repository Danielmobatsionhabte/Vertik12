import type { Request } from "express";

/**
 * Best-effort visitor fingerprint for the admin's Visitors view: IP address,
 * country and a human-readable browser / OS / device parsed from the
 * User-Agent. No external services and no heavy geo database — country comes
 * from the CDN header when the API sits behind one:
 *
 *   - CloudFront: add the `CloudFront-Viewer-Country` header to the origin
 *     request policy (AWS managed policy "AllViewerAndCloudFrontHeaders" or a
 *     custom one) and it arrives on every request.
 *   - Cloudflare: `CF-IPCountry` is sent by default.
 *
 * Without a CDN the country is left empty rather than guessed.
 */
export interface ClientInfo {
  ip?: string;
  country?: string;
  browser?: string;
  os?: string;
  device?: string;
  userAgent?: string;
}

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

function clientIp(req: Request): string | undefined {
  // `trust proxy` is enabled in app.ts, so req.ip already resolves the
  // client address through CloudFront/ALB/API Gateway via X-Forwarded-For.
  const ip = req.ip ?? req.socket.remoteAddress ?? undefined;
  return ip?.replace(/^::ffff:/, ""); // strip the IPv4-mapped-IPv6 prefix
}

function countryOf(req: Request, ip?: string): string | undefined {
  const header =
    first(req.headers["cloudfront-viewer-country"]) ??
    first(req.headers["cf-ipcountry"]) ??
    first(req.headers["x-vercel-ip-country"]);
  if (header && /^[A-Za-z]{2}$/.test(header) && header.toUpperCase() !== "XX") return header.toUpperCase();
  if (ip && (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10."))) return "Local";
  return undefined;
}

/** Tiny UA parser — covers the browsers/OSes a school will realistically see. */
export function parseUserAgent(ua: string): { browser?: string; os?: string; device?: string } {
  const browser =
    match(ua, /Edg(?:e|A|iOS)?\/([\d.]+)/, "Edge") ??
    match(ua, /OPR\/([\d.]+)/, "Opera") ??
    match(ua, /SamsungBrowser\/([\d.]+)/, "Samsung Internet") ??
    match(ua, /Firefox\/([\d.]+)/, "Firefox") ??
    match(ua, /CriOS\/([\d.]+)/, "Chrome") ??
    match(ua, /Chrome\/([\d.]+)/, "Chrome") ??
    (/Safari\//.test(ua) ? match(ua, /Version\/([\d.]+)/, "Safari") ?? "Safari" : undefined);

  const os = /Windows NT/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : undefined;

  const device = /iPad|Tablet|(?=.*Android)(?!.*Mobile)/.test(ua) ? "Tablet" : /Mobi|iPhone|Android/.test(ua) ? "Mobile" : "Desktop";

  return { browser, os, device };
}

function match(ua: string, re: RegExp, name: string): string | undefined {
  const m = ua.match(re);
  return m ? `${name} ${m[1]?.split(".")[0] ?? ""}`.trim() : undefined;
}

export function clientInfo(req: Request): ClientInfo {
  const ip = clientIp(req);
  const userAgent = first(req.headers["user-agent"]);
  return {
    ip,
    country: countryOf(req, ip),
    ...(userAgent ? parseUserAgent(userAgent) : {}),
    userAgent: userAgent?.slice(0, 300), // cap: UA strings are attacker-controlled input
  };
}
