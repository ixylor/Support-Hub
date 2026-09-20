import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mailboxConnections, ticketAssignments, tickets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import { assignTicket } from "./assignment";

describe("assignTicket", () => {
  let connectionId: string;
  let adminId: string;
  let agentId: string;
  let otherAgentId: string;

  async function createUser(name: string, role: "agent" | "admin"): Promise<string> {
    const [row] = await db
      .insert(user)
      .values({
        id: `assignment-test-${crypto.randomUUID()}`,
        name,
        email: `assignment-test-${crypto.randomUUID()}@example.com`,
        role,
      })
      .returning({ id: user.id });
    return row.id;
  }

  async function createTicket(): Promise<string> {
    const [ticket] = await db
      .insert(tickets)
      .values({
        subject: "Assignment test",
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
    otherAgentId = await createUser("Other Agent", "agent");

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
    for (const id of [adminId, agentId, otherAgentId]) {
      await db.delete(user).where(eq(user.id, id));
    }
  });

  it("sets the assignee on the ticket and records the history row", async () => {
    const ticketId = await createTicket();

    const result = await assignTicket({
      ticketId,
      assigneeUserId: agentId,
      priority: "high",
      remark: "Please take a look.",
      assignedByUserId: adminId,
    });

    expect(result).toEqual({ ok: true });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBe(agentId);
    expect(ticket.priority).toBe("high");

    const history = await db
      .select()
      .from(ticketAssignments)
      .where(eq(ticketAssignments.ticketId, ticketId));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      assignedToUserId: agentId,
      assignedByUserId: adminId,
      priority: "high",
      remark: "Please take a look.",
    });
  });

  it("leaves the existing priority alone when none is supplied", async () => {
    const ticketId = await createTicket();
    await db.update(tickets).set({ priority: "urgent" }).where(eq(tickets.id, ticketId));

    await assignTicket({ ticketId, assigneeUserId: agentId, assignedByUserId: adminId });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.priority).toBe("urgent");
  });

  it("records a reassignment as a second history row without erasing the first", async () => {
    const ticketId = await createTicket();

    await assignTicket({
      ticketId,
      assigneeUserId: agentId,
      remark: "First.",
      assignedByUserId: adminId,
    });
    await assignTicket({
      ticketId,
      assigneeUserId: otherAgentId,
      remark: "Second.",
      assignedByUserId: adminId,
    });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBe(otherAgentId);

    const history = await db
      .select()
      .from(ticketAssignments)
      .where(eq(ticketAssignments.ticketId, ticketId));
    expect(history).toHaveLength(2);
    expect(history.map((row) => row.remark).sort()).toEqual(["First.", "Second."]);
  });

  it("clears the assignee and logs the unassignment when given a null assignee", async () => {
    const ticketId = await createTicket();
    await assignTicket({ ticketId, assigneeUserId: agentId, assignedByUserId: adminId });

    const result = await assignTicket({
      ticketId,
      assigneeUserId: null,
      remark: "Back to the queue.",
      assignedByUserId: adminId,
    });

    expect(result).toEqual({ ok: true });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBeNull();

    const history = await db
      .select()
      .from(ticketAssignments)
      .where(eq(ticketAssignments.ticketId, ticketId));
    expect(history).toHaveLength(2);
    expect(history.some((row) => row.assignedToUserId === null && row.remark === "Back to the queue.")).toBe(
      true
    );
  });

  it("stores an empty remark as null rather than an empty string", async () => {
    const ticketId = await createTicket();

    await assignTicket({
      ticketId,
      assigneeUserId: agentId,
      remark: "   ",
      assignedByUserId: adminId,
    });

    const [entry] = await db
      .select()
      .from(ticketAssignments)
      .where(eq(ticketAssignments.ticketId, ticketId));
    expect(entry.remark).toBeNull();
  });

  it("rejects an unknown ticket without writing history", async () => {
    const ticketId = crypto.randomUUID();

    const result = await assignTicket({
      ticketId,
      assigneeUserId: agentId,
      assignedByUserId: adminId,
    });

    expect(result).toEqual({ ok: false, error: "ticket_not_found" });
    expect(
      await db.select().from(ticketAssignments).where(eq(ticketAssignments.ticketId, ticketId))
    ).toEqual([]);
  });

  it("rejects an unknown assignee and leaves the ticket untouched", async () => {
    const ticketId = await createTicket();

    const result = await assignTicket({
      ticketId,
      assigneeUserId: "no-such-user",
      assignedByUserId: adminId,
    });

    expect(result).toEqual({ ok: false, error: "assignee_not_found" });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBeNull();
    expect(
      await db.select().from(ticketAssignments).where(eq(ticketAssignments.ticketId, ticketId))
    ).toEqual([]);
  });

  it("changes only the priority when no assignee is supplied, keeping the current owner", async () => {
    const ticketId = await createTicket();
    await assignTicket({ ticketId, assigneeUserId: agentId, assignedByUserId: adminId });

    const result = await assignTicket({ ticketId, priority: "urgent", assignedByUserId: adminId });

    expect(result).toEqual({ ok: true });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.assignedToUserId).toBe(agentId);
    expect(ticket.priority).toBe("urgent");
  });

  it("credits the priority-only history row to the agent who already holds the ticket", async () => {
    const ticketId = await createTicket();
    await assignTicket({ ticketId, assigneeUserId: agentId, assignedByUserId: adminId });

    await assignTicket({ ticketId, priority: "low", assignedByUserId: adminId });

    const history = await db
      .select()
      .from(ticketAssignments)
      .where(eq(ticketAssignments.ticketId, ticketId));
    const priorityEntry = history.find((row) => row.priority === "low");
    expect(priorityEntry?.assignedToUserId).toBe(agentId);
  });

  it("clears the priority when given an explicit null", async () => {
    const ticketId = await createTicket();
    await db.update(tickets).set({ priority: "high" }).where(eq(tickets.id, ticketId));

    await assignTicket({ ticketId, priority: null, assignedByUserId: adminId });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.priority).toBeNull();
  });
});
