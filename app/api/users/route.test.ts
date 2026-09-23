import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

const { authApi } = vi.hoisted(() => ({
  authApi: {
    getSession: vi.fn(),
    createUser: vi.fn(),
    adminUpdateUser: vi.fn(),
    setUserPassword: vi.fn(),
    listUsers: vi.fn(),
  },
}));

vi.mock("@/lib/auth/server", () => ({ auth: { api: authApi } }));

function request(body?: Record<string, unknown>, method = "POST") {
  return new Request("http://localhost/api/users", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("/api/users", () => {
  let adminId: string;
  let secondAdminId: string;
  let agentId: string;

  beforeAll(async () => {
    const rows = await db
      .insert(user)
      .values([
        {
          id: `users-route-admin-${crypto.randomUUID()}`,
          name: "Users Route Admin",
          email: `users-route-admin-${crypto.randomUUID()}@example.com`,
          emailVerified: true,
          role: "admin",
        },
        {
          id: `users-route-admin-two-${crypto.randomUUID()}`,
          name: "Users Route Second Admin",
          email: `users-route-admin-two-${crypto.randomUUID()}@example.com`,
          emailVerified: true,
          role: "admin",
        },
        {
          id: `users-route-agent-${crypto.randomUUID()}`,
          name: "Users Route Agent",
          email: `users-route-agent-${crypto.randomUUID()}@example.com`,
          emailVerified: true,
          role: "agent",
        },
      ])
      .returning({ id: user.id });
    [adminId, secondAdminId, agentId] = rows.map((row) => row.id);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, adminId));
    await db.delete(user).where(eq(user.id, secondAdminId));
    await db.delete(user).where(eq(user.id, agentId));
  });

  async function signInAs(id: string, role: "admin" | "agent") {
    authApi.getSession.mockResolvedValue({ user: { id, role } });
  }

  it("requires an admin to create users", async () => {
    authApi.getSession.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(request({ name: "New User", email: "new@example.com", password: "password123" }));

    expect(response.status).toBe(401);
    expect(authApi.createUser).not.toHaveBeenCalled();
  });

  it("creates a user with the requested Better Auth role", async () => {
    await signInAs(adminId, "admin");
    authApi.createUser.mockResolvedValue({ user: { id: "new-user", name: "New User", email: "new@example.com" } });

    const { POST } = await import("./route");
    const response = await POST(
      request({ name: "New User", email: "NEW@example.com", password: "password123", role: "admin" })
    );

    expect(response.status).toBe(201);
    expect(authApi.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ body: { name: "New User", email: "new@example.com", password: "password123", role: "admin" } })
    );
  });

  it("rejects unknown roles at the API boundary", async () => {
    await signInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(
      request({ name: "New User", email: "new@example.com", password: "password123", role: "owner" })
    );

    expect(response.status).toBe(400);
    expect(authApi.createUser).not.toHaveBeenCalled();
  });

  it("updates a role and resets a password through Better Auth", async () => {
    await signInAs(adminId, "admin");

    const { PATCH } = await import("./route");
    const response = await PATCH(request({ userId: agentId, role: "admin", password: "new-password" }, "PATCH"));

    expect(response.status).toBe(200);
    expect(authApi.adminUpdateUser).toHaveBeenCalledWith(
      expect.objectContaining({ body: { userId: agentId, data: { role: "admin" } } })
    );
    expect(authApi.setUserPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { userId: agentId, newPassword: "new-password" } })
    );
  });

  it("rejects short passwords instead of silently ignoring them", async () => {
    await signInAs(adminId, "admin");

    const { PATCH } = await import("./route");
    const response = await PATCH(request({ userId: agentId, password: "short" }, "PATCH"));

    expect(response.status).toBe(400);
    expect(authApi.setUserPassword).not.toHaveBeenCalled();
  });

  it("protects the last admin from demotion", async () => {
    await db.delete(user).where(eq(user.id, secondAdminId));
    await signInAs(adminId, "admin");

    const { PATCH } = await import("./route");
    const response = await PATCH(request({ userId: adminId, role: "agent" }, "PATCH"));

    expect(response.status).toBe(409);
    expect(authApi.adminUpdateUser).not.toHaveBeenCalled();

    await db.insert(user).values({
      id: secondAdminId,
      name: "Users Route Second Admin",
      email: `users-route-admin-two-restored-${crypto.randomUUID()}@example.com`,
      emailVerified: true,
      role: "admin",
    });
  });
});
