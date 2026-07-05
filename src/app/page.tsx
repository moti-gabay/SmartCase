import { redirect } from "next/navigation";
import { auth } from "@/../auth";

// Route by auth state instead of blindly funnelling everyone into the protected
// /dashboard (which caused a redirect bounce when the session wasn't recognized).
export default async function RootPage() {
  const session = await auth();
  redirect(session?.user ? "/dashboard" : "/login");
}
