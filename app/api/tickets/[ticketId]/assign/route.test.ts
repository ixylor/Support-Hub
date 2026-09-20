import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mailboxConnections, ticketAssignments, tickets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

function params(ticketId: string) {
  return { params: Promise.resolve({ ticketId }) };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/tickets/x/assign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function signedInAs(id: string, role: "agent" | "admin") {
  const { auth } = await import("@/lib/auth/server");
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

describe("POST /api/tickets/[ticketId]/assign", () => {
  let connectionId: string;
  let adminId: string;
  let agentId: string;

  async function createUser(name: string, role: "agent" | "admin"): Promise<string> {
    const [row] = await db
      .insert(user)
      .values({
        id: `assign-route-test-${crypto.randomUUID()}`,
        name,
        email: `assign-route-test-${crypto.randomUUID()}@example.com`,
        role,
      })
      .returning({ id: user.id });
    return row.id;
  }

  async function createTicket(): Promise<string> {
    const [ticket] = await db
      .insert(tickets)
      .values({
        subject: "Assign route test",
        requesterEmail: "customer@example.com",
        status: "new",
        mailboxConnectionId: connectionId,
        providerThreadId: crypto.randomUUID(),
      })
      .returning({ id: tickets.id });
    return ticket.id;
  }

  beforeAll(async () => {
    adminId = await createUser("Admin User", "admin");
    agentId = await createUser("Agent User", "agent");

    const [connection] = await db
      .insert(mailboxConnections)
      .values({
        provider: "microsoft",
        mailboxAddress: "support@example.com",
        encryptedRefreshToken: "unused-in-this-test",
        connectedByUserId: adminId,
        status: "disconnected",
      })
      .returning({ id: mailboxConnections.id });
    connectionId = connection.id;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    const ticketRows = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.mailboxConnectionId, connectionId));
    for (const ticket of ticketRows) {
      await db.delete(ticketAssignments).where(eq(ticketAssignments.ticketId, ticket.id));
    }
    await db.delete(tickets).where(eq(tickets.mailboxConnectionId, connectionId));
  });

  afterAll(async () => {
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connectionId));
    for (const id of [adminId, agentId]) {
      await db.delete(user).where(eq(user.id, id));
    }
  });

  it("rejects an unauthenticated request", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(post({ assigneeUserId: null }), params(crypto.randomUUID()));

    expect(response.status).toBe(401);
  });

  it("rejects a non-admin, leaving the ticket unassigned", async () => {
    const ticketId = await createTicket();
    await signedInAs(agentId, "agent");

    const { POST } = await import("./route");
    const response = await POST(post({ assigneeUserId: agentId }), params(ticketId));

    expect(response.status).toBe(403);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBeNull();
  });

  it("assigns the ticket with a priority and remark", async () => {
    const ticketId = await createTicket();
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(
      post({ assigneeUserId: agentId, priority: "urgent", remark: "Customer is waiting." }),
      params(ticketId)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBe(agentId);
    expect(ticket.priority).toBe("urgent");

    const [entry] = await db
      .select()
      .from(ticketAssignments)
      .where(eq(ticketAssignments.ticketId, ticketId));
    expect(entry).toMatchObject({
      assignedToUserId: agentId,
      assignedByUserId: adminId,
      remark: "Customer is waiting.",
    });
  });

  it("lets an admin assign a ticket to themselves", async () => {
    const ticketId = await createTicket();
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(post({ assigneeUserId: adminId }), params(ticketId));

    expect(response.status).toBe(200);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBe(adminId);
  });

  it("unassigns when given a null assignee", async () => {
    const ticketId = await createTicket();
    await db.update(tickets).set({ assignedToUserId: agentId }).where(eq(tickets.id, ticketId));
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(post({ assigneeUserId: null }), params(ticketId));

    expect(response.status).toBe(200);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBeNull();
  });

  it("returns 404 for a ticket that does not exist", async () => {
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(post({ assigneeUserId: agentId }), params(crypto.randomUUID()));

    expect(response.status).toBe(404);
  });

  it("returns 404 for a malformed ticket id instead of erroring", async () => {
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(post({ assigneeUserId: agentId }), params("not-a-uuid"));

    expect(response.status).toBe(404);
  });

  it("rejects an unknown assignee", async () => {
    const ticketId = await createTicket();
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(post({ assigneeUserId: "no-such-user" }), params(ticketId));

    expect(response.status).toBe(400);
  });

  it("rejects an unrecognised priority", async () => {
    const ticketId = await createTicket();
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(
      post({ assigneeUserId: agentId, priority: "catastrophic" }),
      params(ticketId)
    );

    expect(response.status).toBe(400);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBeNull();
  });

  it("rejects a remark longer than the column is meant to hold", async () => {
    const ticketId = await createTicket();
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(
      post({ assigneeUserId: agentId, remark: "x".repeat(2001) }),
      params(ticketId)
    );

    expect(response.status).toBe(400);
  });

  it("rejects a body that is not valid JSON", async () => {
    const ticketId = await createTicket();
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/tickets/x/assign", { method: "POST", body: "{" }),
      params(ticketId)
    );

    expect(response.status).toBe(400);
  });

  it("leaves the existing priority alone when the field is omitted", async () => {
    const ticketId = await createTicket();
    await db.update(tickets).set({ priority: "low" }).where(eq(tickets.id, ticketId));
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    await POST(post({ assigneeUserId: agentId }), params(ticketId));

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.priority).toBe("low");
  });

  it("updates priority alone without disturbing the assignee", async () => {
    const ticketId = await createTicket();
    await db.update(tickets).set({ assignedToUserId: agentId }).where(eq(tickets.id, ticketId));
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(post({ priority: "high" }), params(ticketId));

    expect(response.status).toBe(200);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.priority).toBe("high");
    expect(ticket.assignedToUserId).toBe(agentId);
  });

  it("rejects a body that asks for no change at all", async () => {
    const ticketId = await createTicket();
    await signedInAs(adminId, "admin");

    const { POST } = await import("./route");
    const response = await POST(post({}), params(ticketId));

    expect(response.status).toBe(400);
  });
});
