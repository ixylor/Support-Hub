import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { DELETE, PATCH } from "./route";
import { db } from "@/lib/db/client";
import {
  attachments,
  llmLogs,
  mailboxConnections,
  ticketApprovals,
  ticketAssignments,
  ticketMessages,
  ticketSendAttempts,
  tickets,
} from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

function context(ticketId: string) {
  return { params: Promise.resolve({ ticketId }) };
}

function request(): Request {
  return new Request("http://localhost/api/tickets/ticket-id", { method: "DELETE" });
}

function patchRequest(status: string): Request {
  return new Request("http://localhost/api/tickets/ticket-id", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

describe("DELETE /api/tickets/[ticketId]", () => {
  let connectionId: string;
  let adminId: string;
  let agentId: string;

  async function createUser(role: "admin" | "agent"): Promise<string> {
    const id = `delete-route-test-${crypto.randomUUID()}`;
    const email = `delete-route-test-${crypto.randomUUID()}@example.com`;
    const [row] = await db.execute(sql`
      INSERT INTO "user" ("id", "name", "email", "role")
      VALUES (${id}, ${`${role} delete test user`}, ${email}, ${role})
      RETURNING "id"
    `);
    return String(row.id);
  }

  async function createTicket(status: "new" | "resolved" | "triaged_out"): Promise<string> {
    const [row] = await db
      .insert(tickets)
      .values({
        subject: "Delete route test",
        requesterEmail: "customer@example.com",
        status,
        mailboxConnectionId: connectionId,
        providerThreadId: crypto.randomUUID(),
      })
      .returning({ id: tickets.id });
    return row.id;
  }

  beforeAll(async () => {
    adminId = await createUser("admin");
    agentId = await createUser("agent");
    const [connection] = await db
      .insert(mailboxConnections)
      .values({
        provider: "microsoft",
        mailboxAddress: "delete-test@example.com",
        encryptedRefreshToken: "unused",
        connectedByUserId: adminId,
        status: "disconnected",
      })
      .returning({ id: mailboxConnections.id });
    connectionId = connection.id;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await db.delete(tickets).where(eq(tickets.mailboxConnectionId, connectionId));
  });

  afterAll(async () => {
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connectionId));
    await db.delete(user).where(eq(user.id, adminId));
    await db.delete(user).where(eq(user.id, agentId));
  });

  it("requires authentication and an admin role", async () => {
    const ticketId = await createTicket("resolved");

    mocks.getSession.mockResolvedValue(null);
    expect((await DELETE(request(), context(ticketId))).status).toBe(401);

    mocks.getSession.mockResolvedValue({ user: { id: agentId, role: "agent" } });
    expect((await DELETE(request(), context(ticketId))).status).toBe(403);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.id).toBe(ticketId);
  });

  it("only deletes resolved or triaged-out tickets", async () => {
    const ticketId = await createTicket("new");
    mocks.getSession.mockResolvedValue({ user: { id: adminId, role: "admin" } });

    const response = await DELETE(request(), context(ticketId));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Only resolved or triaged-out tickets can be permanently deleted.",
    });
    expect((await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)))).toHaveLength(1);
  });

  it("deletes triaged-out tickets", async () => {
    const ticketId = await createTicket("triaged_out");
    mocks.getSession.mockResolvedValue({ user: { id: adminId, role: "admin" } });

    const response = await DELETE(request(), context(ticketId));

    expect(response.status).toBe(200);
    expect((await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)))).toHaveLength(0);
  });

  it("permanently deletes a resolved ticket and all dependent state", async () => {
    const ticketId = await createTicket("resolved");
    const providerMessageId = `delete-route-message-${crypto.randomUUID()}`;
    const graphThreadId = `ticket:${ticketId}`;

    const [message] = await db
      .insert(ticketMessages)
      .values({
        ticketId,
        direction: "inbound",
        senderEmail: "customer@example.com",
        body: "Please remove this ticket.",
        providerMessageId,
      })
      .returning({ id: ticketMessages.id });
    await db.insert(attachments).values({
      ticketMessageId: message.id,
      filename: "test.txt",
      providerAttachmentId: "provider-attachment-id",
      contentType: "text/plain",
      sizeBytes: 10,
    });
    await db.insert(ticketAssignments).values({
      ticketId,
      assignedToUserId: agentId,
      assignedByUserId: adminId,
      remark: "test",
    });
    const [approval] = await db
      .insert(ticketApprovals)
      .values({
        ticketId,
        graphThreadId,
        kind: "send_email",
        proposal: {},
        confidence: "0.5",
        status: "decided",
        decision: "approve",
      })
      .returning({ id: ticketApprovals.id });
    await db.insert(ticketSendAttempts).values({
      ticketId,
      approvalId: approval.id,
      status: "sent",
    });
    await db.insert(llmLogs).values({
      ticketId,
      prompt: "prompt",
      response: "response",
      model: "test-model",
      graphThreadId,
    });
    await db.execute(sql`
      INSERT INTO "checkpoints" ("thread_id", "checkpoint_ns", "checkpoint_id", "checkpoint", "metadata")
      VALUES (${graphThreadId}, '', ${`cp-${ticketId}`}, '{}'::jsonb, '{}'::jsonb)
    `);
    await db.execute(sql`
      INSERT INTO "checkpoint_blobs" ("thread_id", "checkpoint_ns", "channel", "version", "type", "blob")
      VALUES (${graphThreadId}, '', 'test', '1', 'json', decode('00', 'hex'))
    `);

    mocks.getSession.mockResolvedValue({ user: { id: adminId, role: "admin" } });
    const response = await DELETE(request(), context(ticketId));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)))).toHaveLength(0);
    expect((await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, ticketId)))).toHaveLength(0);
    expect((await db.select().from(attachments).where(eq(attachments.ticketMessageId, message.id)))).toHaveLength(0);
    expect((await db.select().from(ticketAssignments).where(eq(ticketAssignments.ticketId, ticketId)))).toHaveLength(0);
    expect((await db.select().from(ticketApprovals).where(eq(ticketApprovals.ticketId, ticketId)))).toHaveLength(0);
    expect((await db.select().from(ticketSendAttempts).where(eq(ticketSendAttempts.ticketId, ticketId)))).toHaveLength(0);
    expect((await db.select().from(llmLogs).where(eq(llmLogs.ticketId, ticketId)))).toHaveLength(0);
    const [checkpoint] = await db.execute(sql`
      SELECT 1 FROM "checkpoints" WHERE "thread_id" = ${graphThreadId} LIMIT 1
    `);
    expect(checkpoint).toBeUndefined();

    // A deleted id is not a reusable ticket resource.
    expect((await DELETE(request(), context(ticketId))).status).toBe(404);
  });

  it("returns not found for malformed or unknown ids", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: adminId, role: "admin" } });

    expect((await DELETE(request(), context("not-a-uuid"))).status).toBe(404);
    expect((await DELETE(request(), context(crypto.randomUUID()))).status).toBe(404);
  });
});

describe("PATCH /api/tickets/[ticketId]", () => {
  let connectionId: string;
  let adminId: string;
  let agentId: string;

  async function createUser(role: "admin" | "agent"): Promise<string> {
    const id = `status-route-test-${crypto.randomUUID()}`;
    const email = `status-route-test-${crypto.randomUUID()}@example.com`;
    const [row] = await db.execute(sql`
      INSERT INTO "user" ("id", "name", "email", "role")
      VALUES (${id}, ${`${role} status test user`}, ${email}, ${role})
      RETURNING "id"
    `);
    return String(row.id);
  }

  async function createTicket(status: "new" | "resolved"): Promise<string> {
    const [row] = await db
      .insert(tickets)
      .values({
        subject: "Status route test",
        requesterEmail: "customer@example.com",
        status,
        assignedToUserId: agentId,
        mailboxConnectionId: connectionId,
        providerThreadId: crypto.randomUUID(),
      })
      .returning({ id: tickets.id });
    return row.id;
  }

  beforeAll(async () => {
    adminId = await createUser("admin");
    agentId = await createUser("agent");
    const [connection] = await db
      .insert(mailboxConnections)
      .values({
        provider: "microsoft",
        mailboxAddress: "status-test@example.com",
        encryptedRefreshToken: "unused",
        connectedByUserId: adminId,
        status: "disconnected",
      })
      .returning({ id: mailboxConnections.id });
    connectionId = connection.id;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await db.delete(tickets).where(eq(tickets.mailboxConnectionId, connectionId));
  });

  afterAll(async () => {
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connectionId));
    await db.delete(user).where(eq(user.id, adminId));
    await db.delete(user).where(eq(user.id, agentId));
  });

  it("lets an assigned agent mark a ticket completed", async () => {
    const ticketId = await createTicket("new");
    mocks.getSession.mockResolvedValue({ user: { id: agentId, role: "agent" } });

    const response = await PATCH(patchRequest("resolved"), context(ticketId));

    expect(response.status).toBe(200);
    const [ticket] = await db.select({ status: tickets.status }).from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("resolved");
  });

  it("lets admins change an active ticket status", async () => {
    const ticketId = await createTicket("new");
    mocks.getSession.mockResolvedValue({ user: { id: adminId, role: "admin" } });

    const response = await PATCH(patchRequest("escalated"), context(ticketId));

    expect(response.status).toBe(200);
    const [ticket] = await db.select({ status: tickets.status }).from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("escalated");
  });

  it("does not let agents set arbitrary statuses or reopen completed tickets", async () => {
    const activeTicketId = await createTicket("new");
    mocks.getSession.mockResolvedValue({ user: { id: agentId, role: "agent" } });

    expect((await PATCH(patchRequest("escalated"), context(activeTicketId))).status).toBe(403);

    const completedTicketId = await createTicket("resolved");
    expect((await PATCH(patchRequest("new"), context(completedTicketId))).status).toBe(409);
  });
});
