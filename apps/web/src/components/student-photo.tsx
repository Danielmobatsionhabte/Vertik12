"use client";

import { useEffect, useState } from "react";
import { getSession } from "@/lib/api";
import { cx } from "./ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/**
 * Student picture with initials fallback. The photo endpoint needs the
 * Authorization header, so a plain <img src> can't be used — the image is
 * fetched with the token and rendered from an object URL.
 *
 * `version` bumps force a refetch after an upload/removal.
 */
export function StudentPhoto({ studentId, hasPhoto, name, className, version = 0 }: {
  studentId: string;
  /** Skip the request entirely when the record says there is no photo. */
  hasPhoto: boolean;
  name: { firstName: string; lastName: string };
  className?: string;
  version?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPhoto) {
      setUrl(null);
      return;
    }
    const session = getSession();
    if (!session) return;
    let objectUrl: string | null = null;
    let alive = true;
    fetch(`${API_URL}/students/${studentId}/photo`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob || !alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [studentId, hasPhoto, version]);

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`${name.firstName} ${name.lastName}`} className={cx("object-cover", className)} />;
  }
  return (
    <span className={cx("flex items-center justify-center bg-brand-100 font-semibold text-brand-700", className)}>
      {name.firstName[0]}
      {name.lastName[0]}
    </span>
  );
}
