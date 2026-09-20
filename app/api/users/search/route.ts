import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { searchAssignableUsers } from "@/lib/tickets/queries";

// Backs the assignee pickers. Admin-only, because only admins assign
// tickets — this would otherwise be a directory of every account.
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  const users = await searchAssignableUsers(query);

  return NextResponse.json({ users });
}
