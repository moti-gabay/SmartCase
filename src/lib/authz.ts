// Session role guard for staff-only Route Handlers. A bare `session?.user`
// check admits any signed-in role — including CLIENT — so staff surfaces must
// check the role, read from the server-side session only.
import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import type { UserRole } from "@/types";

export const STAFF_ROLES: readonly UserRole[] = ["ADMIN", "SUPERVISOR", "AGENT"];

type StaffSession = { user: { id: string; role: UserRole; name?: string | null } };

// Returns the session for staff, or the 401/403 response to send back.
export async function requireStaffSession(): Promise<{ session: StaffSession } | { denied: NextResponse }> {
  const session = await auth();
  if (!session?.user?.id) return { denied: NextResponse.json({ error: "לא מורשה" }, { status: 401 }) };
  if (!STAFF_ROLES.includes(session.user.role as UserRole)) {
    return { denied: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }) };
  }
  return { session: session as StaffSession };
}
