import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { auth } from "@/lib/auth/server";
import type { MailProvider, ProviderMessage } from "./provider";
import { ingestMessage } from "./ingest-message";

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

  it("skips a message whose provider message id was already ingested", async () => {
    const message = buildMessage();
    await ingestMessage(connectionId, message, fakeProvider, "access-token");
    await ingestMessage(connectionId, message, fakeProvider, "access-token");

    const rows = await db
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.providerMessageId, message.providerMessageId));
    expect(rows).toHaveLength(1);
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
});
