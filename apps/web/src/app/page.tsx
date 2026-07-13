"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROLE_HOME } from "@vertik12/shared";
import { getSession } from "@/lib/api";

/** Landing route: bounce to the role's home page when signed in, else to login. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const session = getSession();
    router.replace(session ? ROLE_HOME[session.user.role] ?? "/dashboard" : "/login");
  }, [router]);
  return null;
}
