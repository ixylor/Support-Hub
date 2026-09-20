import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

function get(query: string): Request {
  return new Request(`http://localhost/api/users/search?q=${encodeURIComponent(query)}`);
}

async function signedInAs(id: string, role: "agent" | "admin") {
  const { auth } = await import("@/lib/auth/server");
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

describe("GET /api/users/search", () => {
  let adminId: string;
  let agentId: string;

  beforeAll(async () => {
    const [admin] = await db
      .insert(user)
      .values({
        id: `user-search-admin-${crypto.randomUUID()}`,
        name: "Searchable Admin",
        email: `user-search-admin-${crypto.randomUUID()}@example.com`,
        role: "admin",
      })
      .returning({ id: user.id });
    adminId = admin.id;

    const [agent] = await db
      .insert(user)
      .values({
        id: `user-search-agent-${crypto.randomUUID()}`,
        name: "Zebediah Searchtarget",
        email: `user-search-agent-${crypto.randomUUID()}@example.com`,
      })
      .returning({ id: user.id });
    agentId = agent.id;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    for (const id of [adminId, agentId]) {
      await db.delete(user).where(eq(user.id, id));
    }
  });

  it("rejects an unauthenticated request", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(get(""));

    expect(response.status).toBe(401);
  });

  it("refuses a non-admin — this is a directory of every account", async () => {
    await signedInAs(agentId, "agent");

    const { GET } = await import("./route");
    const response = await GET(get(""));

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Zebediah");
  });

  it("returns matches for an admin", async () => {
    await signedInAs(adminId, "admin");

    const { GET } = await import("./route");
    const response = await GET(get("Zebediah"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { users: { id: string; name: string }[] };
    expect(body.users.some((row) => row.id === agentId)).toBe(true);
  });

  it("returns a first page when no query is given", async () => {
    await signedInAs(adminId, "admin");

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/users/search"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { users: unknown[] };
    expect(body.users.length).toBeGreaterThan(0);
    expect(body.users.length).toBeLessThanOrEqual(20);
  });
});
