import { redirect } from "next/navigation";
import { auth } from "@/../auth";

// Staff-only roles allowed to manage meeting slots — mirrors the role check in
// /api/staff/meeting-slots. CLIENT (and any unknown/missing role) is bounced.
const ALLOWED_ROLES = ["ADMIN", "SUPERVISOR", "AGENT"];

// Server-side role gate for the entire /scheduling surface. This is the
// authoritative check (the Edge middleware gate in auth.config.ts only enforces
// authentication as defense-in-depth, and hiding the sidebar link is purely
// cosmetic). The API route re-checks the same role set on every mutation.
export default async function SchedulingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !ALLOWED_ROLES.includes(role)) redirect("/dashboard");
  return <>{children}</>;
}
