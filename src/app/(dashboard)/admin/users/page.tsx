import { getUsersForAdmin } from "@/lib/queries";
import { UsersView } from "@/components/admin/users-view";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const users = await getUsersForAdmin();
  return <UsersView users={users} />;
}
