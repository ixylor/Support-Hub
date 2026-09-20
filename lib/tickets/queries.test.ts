import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { auth } from "@/lib/auth/server";
import { getTicketWithMessages, listTickets } from "./queries";

describe("tickets queries", () => {
  let connectionId: string;

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
    }
    await db.delete(tickets).where(eq(tickets.mailboxConnectionId, connectionId));
  });

  afterAll(async () => {
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connectionId));
  });

  it("returns [] when no tickets exist", async () => {
    expect(await listTickets()).toEqual([]);
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

    const result = await listTickets();

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

    const result = await listTickets();

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

    const result = await getTicketWithMessages(ticket.id);

    expect(result).not.toBeNull();
    expect(result!.subject).toBe("With attachments");
    expect(result!.messages.map((m) => m.id)).toEqual([firstMessage.id, secondMessage.id]);
    expect(result!.messages[0].attachments).toEqual([
      { id: expect.any(String), filename: "log.txt", contentType: "text/plain", sizeBytes: 42 },
    ]);
    expect(result!.messages[1].attachments).toEqual([]);
  });

  it("returns null for an unknown ticket id", async () => {
    expect(await getTicketWithMessages(crypto.randomUUID())).toBeNull();
  });
});
