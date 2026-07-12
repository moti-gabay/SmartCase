import { redirect } from "next/navigation";
import { auth } from "@/../auth";

// Server-side role gate for the entire /admin surface. This is the authoritative
// check (the Edge middleware role gate in auth.config.ts is defense-in-depth,
// and hiding the sidebar link is purely cosmetic).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/dashboard");
  return <>{children}</>;
}
