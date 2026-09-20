import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  mailboxConnections,
  ticketAssignments,
  ticketMessages,
  tickets,
} from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import { auth } from "@/lib/auth/server";
import {
  getTicketWithMessages,
  listTickets,
  listTicketAssignments,
  searchAssignableUsers,
  type TicketViewer,
} from "./queries";

async function createUser(role: "agent" | "admin"): Promise<TicketViewer> {
  const result = await auth.api.signUpEmail({
    body: {
      email: `tickets-queries-test-${crypto.randomUUID()}@example.com`,
      password: "x".repeat(16),
      name: role === "admin" ? "Admin User" : "Agent User",
    },
  });
  await db.update(user).set({ role }).where(eq(user.id, result.user.id));
  return { id: result.user.id, role };
}

describe("tickets queries", () => {
  let connectionId: string;
  let admin: TicketViewer;
  let agent: TicketViewer;
  let otherAgent: TicketViewer;

  beforeAll(async () => {
    const result = await auth.api.signUpEmail({
      body: { email: `tickets-queries-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
    });
    const [connection] = await db
      .insert(mailboxConnections)
      .values({
        provider: "microsoft",
        mailboxAddress: "support@example.com",
        encryptedRefreshToken: "unused-in-this-test",
        connectedByUserId: result.user.id,
        status: "disconnected",
      })
      .returning({ id: mailboxConnections.id });
    connectionId = connection.id;
    admin = await createUser("admin");
    agent = await createUser("agent");
    otherAgent = await createUser("agent");
  });

  afterEach(async () => {
    const ticketRows = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(eq(tickets.mailboxConnectionId, connectionId));
    for (const ticket of ticketRows) {
      const messageRows = await db
        .select({ id: ticketMessages.id })
        .from(ticketMessages)
        .where(eq(ticketMessages.ticketId, ticket.id));
      for (const message of messageRows) {
        await db.delete(attachments).where(eq(attachments.ticketMessageId, message.id));
      }
      await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
      await db.delete(ticketAssignments).where(eq(ticketAssignments.ticketId, ticket.id));
    }
    await db.delete(tickets).where(eq(tickets.mailboxConnectionId, connectionId));
  });

  afterAll(async () => {
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connectionId));
  });

  it("returns [] when no tickets exist", async () => {
    expect(await listTickets(admin)).toEqual([]);
  });

  it("aggregates message counts and last activity, newest first", async () => {
    const [older] = await db
      .insert(tickets)
      .values({
        subject: "Older ticket",
        requesterEmail: "older@example.com",
        status: "new",
        mailboxConnectionId: connectionId,
        providerThreadId: crypto.randomUUID(),
      })
      .returning({ id: tickets.id });
    const [newer] = await db
      .insert(tickets)
      .values({
        subject: "Newer ticket",
        requesterEmail: "newer@example.com",
        status: "resolved",
        mailboxConnectionId: connectionId,
        providerThreadId: crypto.randomUUID(),
      })
      .returning({ id: tickets.id });

    await db.insert(ticketMessages).values([
      {
        ticketId: older.id,
        direction: "inbound",
        senderEmail: "older@example.com",
        body: "First message.",
        providerMessageId: crypto.randomUUID(),
        sentAt: new Date("2026-09-01T10:00:00Z"),
      },
      {
        ticketId: older.id,
        direction: "outbound",
        senderEmail: "agent@example.com",
        body: "A reply.",
        providerMessageId: crypto.randomUUID(),
        sentAt: new Date("2026-09-02T10:00:00Z"),
      },
      {
        ticketId: newer.id,
        direction: "inbound",
        senderEmail: "newer@example.com",
        body: "Only message.",
        providerMessageId: crypto.randomUUID(),
        sentAt: new Date("2026-09-05T10:00:00Z"),
      },
    ]);

    const result = await listTickets(admin);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: newer.id,
      subject: "Newer ticket",
      requesterEmail: "newer@example.com",
      status: "resolved",
      messageCount: 1,
    });
    expect(result[0].lastMessageAt.toISOString()).toBe("2026-09-05T10:00:00.000Z");
    expect(result[1]).toMatchObject({
      id: older.id,
      subject: "Older ticket",
      requesterEmail: "older@example.com",
      status: "new",
      messageCount: 2,
    });
    expect(result[1].lastMessageAt.toISOString()).toBe("2026-09-02T10:00:00.000Z");
  });

  it("includes a ticket with no messages, with a message count of 0 and createdAt as its last activity", async () => {
    const [empty] = await db
      .insert(tickets)
      .values({
        subject: "No messages yet",
        requesterEmail: "orphan@example.com",
        status: "new",
        mailboxConnectionId: connectionId,
        providerThreadId: crypto.randomUUID(),
      })
      .returning({ id: tickets.id, createdAt: tickets.createdAt });

    const result = await listTickets(admin);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: empty.id, messageCount: 0 });
    expect(result[0].lastMessageAt.toISOString()).toBe(empty.createdAt.toISOString());
  });

  it("returns the ticket plus its messages oldest-first, each with attachments", async () => {
    const [ticket] = await db
      .insert(tickets)
      .values({
        subject: "With attachments",
        requesterEmail: "customer@example.com",
        status: "new",
        mailboxConnectionId: connectionId,
        providerThreadId: crypto.randomUUID(),
      })
      .returning({ id: tickets.id });

    const [firstMessage] = await db
      .insert(ticketMessages)
      .values({
        ticketId: ticket.id,
        direction: "inbound",
        senderEmail: "customer@example.com",
        body: "First message.",
        providerMessageId: crypto.randomUUID(),
        sentAt: new Date("2026-09-01T10:00:00Z"),
      })
      .returning({ id: ticketMessages.id });
    const [secondMessage] = await db
      .insert(ticketMessages)
      .values({
        ticketId: ticket.id,
        direction: "outbound",
        senderEmail: "agent@example.com",
        body: "Second message.",
        providerMessageId: crypto.randomUUID(),
        sentAt: new Date("2026-09-02T10:00:00Z"),
      })
      .returning({ id: ticketMessages.id });

    await db.insert(attachments).values({
      ticketMessageId: firstMessage.id,
      filename: "log.txt",
      storagePath: "unused",
      contentType: "text/plain",
      sizeBytes: 42,
    });

    const result = await getTicketWithMessages(ticket.id, admin);

    expect(result).not.toBeNull();
    expect(result!.subject).toBe("With attachments");
    expect(result!.messages.map((m) => m.id)).toEqual([firstMessage.id, secondMessage.id]);
    expect(result!.messages[0].attachments).toEqual([
      { id: expect.any(String), filename: "log.txt", contentType: "text/plain", sizeBytes: 42 },
    ]);
    expect(result!.messages[1].attachments).toEqual([]);
  });

  it("returns null for an unknown ticket id", async () => {
    expect(await getTicketWithMessages(crypto.randomUUID(), admin)).toBeNull();
  });

  describe("viewer scoping", () => {
    async function seedTicket(subject: string, assignedToUserId: string | null) {
      const [ticket] = await db
        .insert(tickets)
        .values({
          subject,
          requesterEmail: "customer@example.com",
          status: "new",
          mailboxConnectionId: connectionId,
          providerThreadId: crypto.randomUUID(),
          assignedToUserId,
        })
        .returning({ id: tickets.id });
      return ticket.id;
    }

    it("shows an admin every ticket, assigned or not", async () => {
      await seedTicket("Unassigned", null);
      await seedTicket("Theirs", agent.id);
      await seedTicket("Someone else", otherAgent.id);

      const result = await listTickets(admin);

      expect(result.map((t) => t.subject).sort()).toEqual(["Someone else", "Theirs", "Unassigned"]);
    });

    it("shows an agent only the tickets assigned to them", async () => {
      await seedTicket("Unassigned", null);
      await seedTicket("Theirs", agent.id);
      await seedTicket("Someone else", otherAgent.id);

      const result = await listTickets(agent);

      expect(result.map((t) => t.subject)).toEqual(["Theirs"]);
    });

    it("reports the assignee and priority on each list row", async () => {
      const ticketId = await seedTicket("Assigned and urgent", agent.id);
      await db.update(tickets).set({ priority: "urgent" }).where(eq(tickets.id, ticketId));

      const [row] = await listTickets(admin);

      expect(row).toMatchObject({
        priority: "urgent",
        assignee: { id: agent.id, name: "Agent User" },
      });
    });

    it("leaves assignee and priority null on an unassigned ticket", async () => {
      await seedTicket("Untouched", null);

      const [row] = await listTickets(admin);

      expect(row.assignee).toBeNull();
      expect(row.priority).toBeNull();
    });

    it("lets an agent open their own ticket", async () => {
      const ticketId = await seedTicket("Theirs", agent.id);

      const result = await getTicketWithMessages(ticketId, agent);

      expect(result?.id).toBe(ticketId);
    });

    it("returns null when an agent opens a ticket assigned to someone else", async () => {
      const ticketId = await seedTicket("Someone else", otherAgent.id);

      expect(await getTicketWithMessages(ticketId, agent)).toBeNull();
    });

    it("returns null when an agent opens an unassigned ticket", async () => {
      const ticketId = await seedTicket("Unassigned", null);

      expect(await getTicketWithMessages(ticketId, agent)).toBeNull();
    });

    it("lets an admin open a ticket assigned to somebody else", async () => {
      const ticketId = await seedTicket("Someone else", otherAgent.id);

      expect((await getTicketWithMessages(ticketId, admin))?.id).toBe(ticketId);
    });

    it("exposes the current assignee and priority on the ticket detail", async () => {
      const ticketId = await seedTicket("Assigned", agent.id);
      await db.update(tickets).set({ priority: "high" }).where(eq(tickets.id, ticketId));

      const result = await getTicketWithMessages(ticketId, admin);

      expect(result).toMatchObject({
        priority: "high",
        assignee: { id: agent.id, name: "Agent User" },
      });
    });
  });

  describe("listTicketAssignments", () => {
    it("returns the history newest-first with actor names and remarks", async () => {
      const [ticket] = await db
        .insert(tickets)
        .values({
          subject: "History",
          requesterEmail: "customer@example.com",
          status: "new",
          mailboxConnectionId: connectionId,
          providerThreadId: crypto.randomUUID(),
        })
        .returning({ id: tickets.id });

      await db.insert(ticketAssignments).values({
        ticketId: ticket.id,
        assignedToUserId: agent.id,
        assignedByUserId: admin.id,
        priority: "low",
        remark: "First pass.",
        createdAt: new Date("2026-09-01T10:00:00Z"),
      });
      await db.insert(ticketAssignments).values({
        ticketId: ticket.id,
        assignedToUserId: null,
        assignedByUserId: admin.id,
        priority: null,
        remark: "Putting it back.",
        createdAt: new Date("2026-09-02T10:00:00Z"),
      });

      const history = await listTicketAssignments(ticket.id);

      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        assignee: null,
        assignedBy: { id: admin.id, name: "Admin User" },
        priority: null,
        remark: "Putting it back.",
      });
      expect(history[1]).toMatchObject({
        assignee: { id: agent.id, name: "Agent User" },
        assignedBy: { id: admin.id, name: "Admin User" },
        priority: "low",
        remark: "First pass.",
      });
    });

    it("returns [] for a ticket that was never assigned", async () => {
      expect(await listTicketAssignments(crypto.randomUUID())).toEqual([]);
    });
  });

  describe("searchAssignableUsers", () => {
    it("returns a page of users when the query is empty", async () => {
      const results = await searchAssignableUsers("");

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(20);
      expect(results[0]).toHaveProperty("name");
    });

    it("caps how many rows it returns, so a big directory stays cheap", async () => {
      const results = await searchAssignableUsers("", 2);

      expect(results).toHaveLength(2);
    });

    it("matches on name", async () => {
      const results = await searchAssignableUsers("Agent User");

      expect(results.some((row) => row.id === agent.id)).toBe(true);
    });

    it("matches case-insensitively", async () => {
      const results = await searchAssignableUsers("aGeNt uSeR");

      expect(results.some((row) => row.id === agent.id)).toBe(true);
    });

    it("returns nothing for a query that matches no one", async () => {
      expect(await searchAssignableUsers("zzz-no-such-person-zzz")).toEqual([]);
    });

    it("treats % as a literal character rather than a wildcard", async () => {
      // A bare % would otherwise match every row in the table.
      expect(await searchAssignableUsers("%")).toEqual([]);
    });
  });
});
