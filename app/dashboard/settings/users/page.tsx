import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { UserManagement } from "./user-management";

export default async function UsersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role?: string }).role !== "admin") redirect("/dashboard");
  const result = await auth.api.listUsers({
    query: { limit: "100", sortBy: "createdAt", sortDirection: "desc" },
    headers: await headers(),
  });
  return <UserManagement initialUsers={result.users.map((item) => ({ id: item.id, name: item.name, email: item.email, role: String((item as { role?: unknown }).role ?? "agent"), createdAt: item.createdAt.toISOString() }))} />;
}
