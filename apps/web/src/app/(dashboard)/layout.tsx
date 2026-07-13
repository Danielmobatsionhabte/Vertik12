import { AppShell } from "@/components/app-shell";

/** Every route in this group renders inside the authenticated shell. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
