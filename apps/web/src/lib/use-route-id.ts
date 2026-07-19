"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { STATIC_PARAM_PLACEHOLDER } from "./static-params";

/**
 * Resolve a dynamic route segment in a way that also works on static
 * hosting. During dev / client-side navigation, useParams() gives the real
 * value. On a hard load of statically hosted HTML the router only knows
 * the "__id__" placeholder, so the value is read from the browser URL —
 * it's the path segment right after `before` (e.g. before="students" for
 * /students/[id]).
 *
 * Returns undefined for the first render(s) until the id is known; pages
 * should render nothing (or a spinner) until then.
 */
export function useRouteId(param: string, before: string): string | undefined {
  const params = useParams<Record<string, string | string[]>>();
  const raw = params?.[param];
  const fromParams = typeof raw === "string" && raw !== STATIC_PARAM_PLACEHOLDER ? raw : undefined;
  const [fromPath, setFromPath] = useState<string>();

  useEffect(() => {
    if (fromParams) return;
    const segments = window.location.pathname.split("/").filter(Boolean);
    const value = segments[segments.indexOf(before) + 1];
    if (value && value !== STATIC_PARAM_PLACEHOLDER) setFromPath(decodeURIComponent(value));
  }, [fromParams, before]);

  return fromParams ?? fromPath;
}
