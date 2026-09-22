import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { auth } from "@/lib/auth/server";
import type { MailProvider, ProviderMessage } from "./provider";
import { ingestMessage } from "./ingest-message";

const workflowMocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  supersedePendingApprovals: vi.fn(),
}));

vi.mock("@/lib/jobs/boss", () => ({ enqueue: workflowMocks.enqueue }));
vi.mock("@/lib/workflow/approvals", () => ({
  supersedePendingApprovals: workflowMocks.supersedePendingApprovals,
}));

function buildMessage(overrides: Partial<ProviderMessage> = {}): ProviderMessage {
  return {
    providerMessageId: crypto.randomUUID(),
    providerThreadId: "thread-1",
    senderEmail: "customer@example.com",
    subject: "Help needed",
    bodyText: "I have a problem.",
    sentAt: new Date("2026-09-19T10:00:00Z"),
    attachments: [],
    ...overrides,
  };
}

const fakeProvider: MailProvider = {
  getAuthorizationUrl: () => "",
  exchangeCodeForTokens: async () => ({ refreshToken: "", mailboxAddress: "" }),
  refreshAccessToken: async () => "access-token",
  getNewMessages: async () => ({ messages: [], nextCursor: "" }),
  downloadAttachment: vi.fn(async () => Buffer.from("attachment content")),
};

describe("ingestMessage", () => {
  let connectionId: string;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    const result = await auth.api.signUpEmail({
      body: { email: `ingest-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
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

  afterAll(async () => {
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
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connectionId));
  });

  it("creates a new ticket and message for an unseen thread", async () => {
    const threadId = crypto.randomUUID();
    const message = buildMessage({ providerThreadId: threadId });

    await ingestMessage(connectionId, message, fakeProvider, "access-token");

    const [ticket] = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    expect(ticket.status).toBe("new");
    expect(ticket.subject).toBe("Help needed");

    const [ticketMessage] = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.providerMessageId, message.providerMessageId));
    expect(ticketMessage.body).toBe("I have a problem.");
  });

  it("threads a second message into the existing ticket for the same thread", async () => {
    const threadId = crypto.randomUUID();
    await ingestMessage(connectionId, buildMessage({ providerThreadId: threadId }), fakeProvider, "access-token");
    await ingestMessage(
      connectionId,
      buildMessage({ providerThreadId: threadId, subject: "Re: Help needed" }),
      fakeProvider,
      "access-token"
    );

    const ticketRows = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    expect(ticketRows).toHaveLength(1);

    const messageRows = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, ticketRows[0].id));
    expect(messageRows).toHaveLength(2);
    expect(workflowMocks.enqueue).toHaveBeenNthCalledWith(1, "workflow.run", {
      ticketId: ticketRows[0].id,
      trigger: "new_ticket",
    });
    expect(workflowMocks.enqueue).toHaveBeenNthCalledWith(2, "workflow.run", {
      ticketId: ticketRows[0].id,
      trigger: "customer_reply",
    });
    expect(workflowMocks.supersedePendingApprovals).toHaveBeenCalledOnce();
    expect(workflowMocks.supersedePendingApprovals).toHaveBeenCalledWith(ticketRows[0].id);
  });

  it("reopens a resolved ticket when a new reply arrives on its thread", async () => {
    const threadId = crypto.randomUUID();
    await ingestMessage(connectionId, buildMessage({ providerThreadId: threadId }), fakeProvider, "access-token");
    const [ticket] = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    await db.update(tickets).set({ status: "resolved" }).where(eq(tickets.id, ticket.id));

    await ingestMessage(connectionId, buildMessage({ providerThreadId: threadId }), fakeProvider, "access-token");

    const [reopened] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(reopened.status).toBe("new");
  });

  it("reopens a ticket waiting on the customer when a new reply arrives on its thread", async () => {
    const threadId = crypto.randomUUID();
    await ingestMessage(connectionId, buildMessage({ providerThreadId: threadId }), fakeProvider, "access-token");
    const [ticket] = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    await db.update(tickets).set({ status: "waiting_on_customer" }).where(eq(tickets.id, ticket.id));

    await ingestMessage(connectionId, buildMessage({ providerThreadId: threadId }), fakeProvider, "access-token");

    const [reopened] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
    expect(reopened.status).toBe("new");
  });

  it("creates separate tickets when different mailbox connections share a provider thread id", async () => {
    const result = await auth.api.signUpEmail({
      body: { email: `ingest-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
    });
    const [otherConnection] = await db
      .insert(mailboxConnections)
      .values({
        provider: "microsoft",
        mailboxAddress: "support-other@example.com",
        encryptedRefreshToken: "unused-in-this-test",
        connectedByUserId: result.user.id,
        status: "disconnected",
      })
      .returning({ id: mailboxConnections.id });

    const threadId = crypto.randomUUID();
    await ingestMessage(connectionId, buildMessage({ providerThreadId: threadId }), fakeProvider, "access-token");
    await ingestMessage(
      otherConnection.id,
      buildMessage({ providerThreadId: threadId }),
      fakeProvider,
      "access-token"
    );

    const ticketRows = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    expect(ticketRows).toHaveLength(2);
    expect(new Set(ticketRows.map((t) => t.mailboxConnectionId)).size).toBe(2);

    // Cleanup — this connection isn't covered by the shared afterAll.
    for (const ticket of ticketRows.filter((t) => t.mailboxConnectionId === otherConnection.id)) {
      const messageRows = await db
        .select({ id: ticketMessages.id })
        .from(ticketMessages)
        .where(eq(ticketMessages.ticketId, ticket.id));
      for (const messageRow of messageRows) {
        await db.delete(attachments).where(eq(attachments.ticketMessageId, messageRow.id));
      }
      await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
    }
    await db.delete(tickets).where(eq(tickets.mailboxConnectionId, otherConnection.id));
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, otherConnection.id));
  });

  it("skips a message whose provider message id was already ingested", async () => {
    const message = buildMessage();
    await ingestMessage(connectionId, message, fakeProvider, "access-token");
    await ingestMessage(connectionId, message, fakeProvider, "access-token");

    const rows = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.providerMessageId, message.providerMessageId));
    expect(rows).toHaveLength(1);
    expect(workflowMocks.enqueue).toHaveBeenCalledOnce();
  });

  it("handles a concurrent duplicate insert gracefully instead of throwing", async () => {
    const message = buildMessage();
    await ingestMessage(connectionId, message, fakeProvider, "access-token");

    // Simulate a second poll cycle that already passed its own dedupe SELECT
    // for the same message by inserting directly, racing the real insert.
    await expect(
      db.insert(ticketMessages).values({
        ticketId: (
          await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.providerThreadId, message.providerThreadId))
        )[0].id,
        direction: "inbound",
        senderEmail: message.senderEmail,
        body: message.bodyText,
        providerMessageId: message.providerMessageId,
        sentAt: message.sentAt,
      })
    ).rejects.toThrow();

    // ingestMessage itself, given the same already-ingested message, must
    // return gracefully rather than throwing a raw unique-violation.
    await expect(ingestMessage(connectionId, message, fakeProvider, "access-token")).resolves.toBeUndefined();

    const rows = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.providerMessageId, message.providerMessageId));
    expect(rows).toHaveLength(1);
  });

  it("leaves no message row when an attachment download fails partway through", async () => {
    const failingProvider: MailProvider = {
      ...fakeProvider,
      downloadAttachment: vi
        .fn()
        .mockResolvedValueOnce(Buffer.from("first attachment"))
        .mockRejectedValueOnce(new Error("network blip")),
    };
    const message = buildMessage({
      attachments: [
        { id: "att-1", filename: "first.txt", contentType: "text/plain" },
        { id: "att-2", filename: "second.txt", contentType: "text/plain" },
      ],
    });

    await expect(ingestMessage(connectionId, message, failingProvider, "access-token")).rejects.toThrow(
      "network blip"
    );

    const rows = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.providerMessageId, message.providerMessageId));
    expect(rows).toHaveLength(0);

    // Retrying with a working provider must succeed cleanly, proving the
    // failed attempt left nothing behind that would block a retry.
    await ingestMessage(connectionId, message, fakeProvider, "access-token");
    const retried = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.providerMessageId, message.providerMessageId));
    expect(retried).toHaveLength(1);
  });

  it("leaves no ticket row when an attachment download fails partway through a new thread", async () => {
    const failingProvider: MailProvider = {
      ...fakeProvider,
      downloadAttachment: vi
        .fn()
        .mockResolvedValueOnce(Buffer.from("first attachment"))
        .mockRejectedValueOnce(new Error("network blip")),
    };
    const threadId = crypto.randomUUID();
    const message = buildMessage({
      providerThreadId: threadId,
      attachments: [
        { id: "att-1", filename: "first.txt", contentType: "text/plain" },
        { id: "att-2", filename: "second.txt", contentType: "text/plain" },
      ],
    });

    await expect(ingestMessage(connectionId, message, failingProvider, "access-token")).rejects.toThrow(
      "network blip"
    );

    const ticketRows = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    expect(ticketRows).toHaveLength(0);

    // Retrying with a working provider must create the ticket and message
    // together, proving the failed attempt left no orphaned ticket behind.
    await ingestMessage(connectionId, message, fakeProvider, "access-token");
    const retriedTickets = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    expect(retriedTickets).toHaveLength(1);
  });

  it("downloads and stores attachments against the inserted message", async () => {
    const message = buildMessage({
      attachments: [{ id: "att-1", filename: "log.txt", contentType: "text/plain" }],
    });

    await ingestMessage(connectionId, message, fakeProvider, "access-token");

    const [ticketMessage] = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.providerMessageId, message.providerMessageId));
    const [attachment] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.ticketMessageId, ticketMessage.id));

    expect(attachment.filename).toBe("log.txt");
    expect(attachment.sizeBytes).toBe(Buffer.from("attachment content").byteLength);
  });

  it("attaches a message to an existing ticket when created by a concurrent insert", async () => {
    const threadId = crypto.randomUUID();

    // Simulate a concurrent poll cycle that created the ticket before this
    // cycle's insert reaches the database: create the ticket manually.
    const [concurrentTicket] = await db
      .insert(tickets)
      .values({
        subject: "Concurrent creation",
        requesterEmail: "customer@example.com",
        status: "new",
        mailboxConnectionId: connectionId,
        providerThreadId: threadId,
      })
      .returning({ id: tickets.id });

    // Now call ingestMessage with a message on the same thread. Because the
    // ticket already exists, the pre-check finds it and uses it directly.
    const message = buildMessage({ providerThreadId: threadId });
    await ingestMessage(connectionId, message, fakeProvider, "access-token");

    // Assert that only one ticket exists for this thread and the message is
    // attached to the ticket created by the concurrent cycle.
    const ticketRows = await db.select().from(tickets).where(eq(tickets.providerThreadId, threadId));
    expect(ticketRows).toHaveLength(1);
    expect(ticketRows[0].id).toBe(concurrentTicket.id);

    const messageRows = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, concurrentTicket.id));
    expect(messageRows).toHaveLength(1);
    expect(messageRows[0].providerMessageId).toBe(message.providerMessageId);
  });
});
