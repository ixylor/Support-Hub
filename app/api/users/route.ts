import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";
import { count, eq } from "drizzle-orm";

const PASSWORD_MIN_LENGTH = 8;
const USER_ROLES = ["agent", "admin"] as const;
type UserRole = (typeof USER_ROLES)[number];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function requireAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { response: NextResponse.json({ error: "Sign in required." }, { status: 401 }) };
  if ((session.user as { role?: string }).role !== "admin") {
    return { response: NextResponse.json({ error: "Only admins can manage users." }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request: Request) {
  const authResult = await requireAdmin(request);
  if (authResult.response) return authResult.response;
  const result = await auth.api.listUsers({
    query: { limit: "100", sortBy: "createdAt", sortDirection: "desc" },
    headers: request.headers,
  });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const authResult = await requireAdmin(request);
  if (authResult.response) return authResult.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const input = (body ?? {}) as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const role = input.role === undefined ? "agent" : input.role;
  if (!isUserRole(role)) {
    return NextResponse.json({ error: "Role must be agent or admin." }, { status: 400 });
  }
  if (!name || !isValidEmail(email) || password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { error: `Name, valid email, and a password of at least ${PASSWORD_MIN_LENGTH} characters are required.` },
      { status: 400 }
    );
  }
  try {
    const created = await auth.api.createUser({
      body: { name, email, password, role },
      headers: request.headers,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create user." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authResult = await requireAdmin(request);
  if (authResult.response) return authResult.response;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const input = (body ?? {}) as Record<string, unknown>;
  const userId = typeof input.userId === "string" ? input.userId : "";
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const hasRole = input.role !== undefined;
  const hasPassword = input.password !== undefined;
  const hasName = input.name !== undefined;
  if (!hasRole && !hasPassword && !hasName) {
    return NextResponse.json({ error: "Provide a role, password, or name to update." }, { status: 400 });
  }
  if (hasRole && !isUserRole(input.role)) {
    return NextResponse.json({ error: "Role must be agent or admin." }, { status: 400 });
  }
  if (hasPassword && (typeof input.password !== "string" || input.password.length < PASSWORD_MIN_LENGTH)) {
    return NextResponse.json(
      { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }
  if (hasName && (typeof input.name !== "string" || !input.name.trim())) {
    return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  }

  try {
    const target = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, userId)).limit(1);
    if (!target[0]) return NextResponse.json({ error: "User not found." }, { status: 404 });

    if (hasRole && input.role === "agent" && target[0].role === "admin") {
      const [{ total: adminCount }] = await db
        .select({ total: count() })
        .from(user)
        .where(eq(user.role, "admin"));
      if (adminCount <= 1) {
        return NextResponse.json({ error: "The last admin cannot be demoted." }, { status: 409 });
      }
    }

    if (hasRole || hasName) {
      const data: { role?: UserRole; name?: string } = {};
      if (hasRole) data.role = input.role as UserRole;
      if (hasName) data.name = (input.name as string).trim();
      await auth.api.adminUpdateUser({ body: { userId, data }, headers: request.headers });
    }
    if (hasPassword) {
      await auth.api.setUserPassword({
        body: { userId, newPassword: input.password as string },
        headers: request.headers,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update user." }, { status: 400 });
  }
}
