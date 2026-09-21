import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mailboxConnections, tickets, ticketMessages, attachments } from "@/lib/db/schema";
import { auth } from "@/lib/auth/server";
import { connectMailbox } from "@/lib/mailbox/connection";
import { setSecret } from "@/lib/secrets/store";
import { clientIdSecretKey, clientSecretSecretKey } from "@/lib/mailbox/oauth-credentials";

vi.mock("@/lib/ingestion/providers", () => ({
  getMailProvider: vi.fn(),
}));

vi.mock("@/lib/ingestion/ingest-message", () => ({
  ingestMessage: vi.fn(),
}));

describe("pollMailboxOnce", () => {
  let userId: string;

  beforeAll(async () => {
    const result = await auth.api.signUpEmail({
      body: { email: `cron-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
    });
    userId = result.user.id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await db.delete(attachments);
    await db.delete(ticketMessages);
    await db.delete(tickets);
    await db.delete(mailboxConnections);
  });

  it("does nothing when no mailbox is connected", async () => {
    const { pollMailboxOnce } = await import("./poll-mailbox");

    const result = await pollMailboxOnce();

    expect(result.ingested).toBe(0);
  });

  it("marks the connection as errored when token refresh fails", async () => {
    const { getMailProvider } = await import("@/lib/ingestion/providers");
    vi.mocked(getMailProvider).mockReturnValue({
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      refreshAccessToken: vi.fn(async () => {
        throw new Error("refresh failed");
      }),
      getNewMessages: vi.fn(),
      downloadAttachment: vi.fn(),
    });

    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "rt",
      connectedByUserId: userId,
    });
    await setSecret(clientIdSecretKey("microsoft"), "client-id", userId);
    await setSecret(clientSecretSecretKey("microsoft"), "client-secret", userId);

    const { pollMailboxOnce } = await import("./poll-mailbox");

    await pollMailboxOnce();

    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));
    expect(connection.status).toBe("error");
  });

  it("ingests fetched messages and advances the sync cursor", async () => {
    const { getMailProvider } = await import("@/lib/ingestion/providers");
    const { ingestMessage } = await import("@/lib/ingestion/ingest-message");
    vi.mocked(getMailProvider).mockReturnValue({
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      refreshAccessToken: vi.fn(async () => "access-token"),
      getNewMessages: vi.fn(async () => ({
        messages: [
          {
            providerMessageId: crypto.randomUUID(),
            providerThreadId: "thread-1",
            senderEmail: "customer@example.com",
            subject: "Help",
            bodyText: "body",
            sentAt: new Date("2026-09-19T10:00:00Z"),
            attachments: [],
          },
        ],
        nextCursor: "2026-09-19T10:00:00Z",
      })),
      downloadAttachment: vi.fn(),
    });

    // Default implementation: all messages succeed
    vi.mocked(ingestMessage).mockResolvedValue(undefined);

    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "rt",
      connectedByUserId: userId,
    });
    await setSecret(clientIdSecretKey("microsoft"), "client-id", userId);
    await setSecret(clientSecretSecretKey("microsoft"), "client-secret", userId);

    const { pollMailboxOnce } = await import("./poll-mailbox");

    const result = await pollMailboxOnce();

    expect(result.ingested).toBe(1);
    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));
    expect(connection.syncCursor).toBe("2026-09-19T10:00:00Z");
  });

  it("does not advance the sync cursor when the first message fails to ingest", async () => {
    const { getMailProvider } = await import("@/lib/ingestion/providers");
    const { ingestMessage } = await import("@/lib/ingestion/ingest-message");
    const msgId1 = crypto.randomUUID();
    const msgId2 = crypto.randomUUID();

    vi.mocked(getMailProvider).mockReturnValue({
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      refreshAccessToken: vi.fn(async () => "access-token"),
      getNewMessages: vi.fn(async () => ({
        messages: [
          {
            providerMessageId: msgId1,
            providerThreadId: "thread-1",
            senderEmail: "customer@example.com",
            subject: "Help",
            bodyText: "body",
            sentAt: new Date("2026-09-19T10:00:00Z"),
            attachments: [],
          },
          {
            providerMessageId: msgId2,
            providerThreadId: "thread-2",
            senderEmail: "customer2@example.com",
            subject: "Help 2",
            bodyText: "body 2",
            sentAt: new Date("2026-09-19T11:00:00Z"),
            attachments: [],
          },
        ],
        nextCursor: "2026-09-19T11:00:00Z",
      })),
      downloadAttachment: vi.fn(),
    });

    vi.mocked(ingestMessage).mockImplementation(async (connectionId, message) => {
      if (message.providerMessageId === msgId1) {
        throw new Error("Message ingestion failed");
      }
    });

    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "rt",
      connectedByUserId: userId,
    });
    await setSecret(clientIdSecretKey("microsoft"), "client-id", userId);
    await setSecret(clientSecretSecretKey("microsoft"), "client-secret", userId);

    // connectMailbox stamps the cursor with the connection time, so "did not
    // advance" means unchanged from that stamp -- not null.
    const [beforePoll] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));

    const { pollMailboxOnce } = await import("./poll-mailbox");

    const result = await pollMailboxOnce();

    // First message fails, second succeeds -- but there's no consecutive
    // run of successes starting at index 0, so the cursor can't move.
    expect(result.ingested).toBe(1);
    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));
    expect(connection.syncCursor).toBe(beforePoll.syncCursor);
  });

  it("advances the sync cursor to the last consecutive success when a mid-batch message fails", async () => {
    const { getMailProvider } = await import("@/lib/ingestion/providers");
    const { ingestMessage } = await import("@/lib/ingestion/ingest-message");
    const msgId1 = crypto.randomUUID();
    const msgId2 = crypto.randomUUID();
    const msgId3 = crypto.randomUUID();

    vi.mocked(getMailProvider).mockReturnValue({
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      refreshAccessToken: vi.fn(async () => "access-token"),
      getNewMessages: vi.fn(async () => ({
        messages: [
          {
            providerMessageId: msgId1,
            providerThreadId: "thread-1",
            senderEmail: "customer@example.com",
            subject: "Help",
            bodyText: "body",
            sentAt: new Date("2026-09-19T10:00:00Z"),
            attachments: [],
          },
          {
            providerMessageId: msgId2,
            providerThreadId: "thread-2",
            senderEmail: "customer2@example.com",
            subject: "Help 2",
            bodyText: "body 2",
            sentAt: new Date("2026-09-19T11:00:00Z"),
            attachments: [],
          },
          {
            providerMessageId: msgId3,
            providerThreadId: "thread-3",
            senderEmail: "customer3@example.com",
            subject: "Help 3",
            bodyText: "body 3",
            sentAt: new Date("2026-09-19T12:00:00Z"),
            attachments: [],
          },
        ],
        nextCursor: "2026-09-19T12:00:00Z",
      })),
      downloadAttachment: vi.fn(),
    });

    vi.mocked(ingestMessage).mockImplementation(async (connectionId, message) => {
      if (message.providerMessageId === msgId2) {
        throw new Error("Message ingestion failed");
      }
    });

    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "rt",
      connectedByUserId: userId,
    });
    await setSecret(clientIdSecretKey("microsoft"), "client-id", userId);
    await setSecret(clientSecretSecretKey("microsoft"), "client-secret", userId);

    const { pollMailboxOnce } = await import("./poll-mailbox");

    const result = await pollMailboxOnce();

    // Message 1 succeeds, message 2 fails, message 3 succeeds. The cursor
    // should advance only to message 1's position, not to the batch end --
    // message 2 is retried and message 3 re-fetched (and deduped) next cycle.
    expect(result.ingested).toBe(2);
    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));
    expect(connection.syncCursor).toBe("2026-09-19T10:00:00.000Z");
  });

  it("marks the connection as errored when message fetch fails", async () => {
    const { getMailProvider } = await import("@/lib/ingestion/providers");
    vi.mocked(getMailProvider).mockReturnValue({
      getAuthorizationUrl: vi.fn(),
      exchangeCodeForTokens: vi.fn(),
      refreshAccessToken: vi.fn(async () => "access-token"),
      getNewMessages: vi.fn(async () => {
        throw new Error("Network error");
      }),
      downloadAttachment: vi.fn(),
    });

    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "rt",
      connectedByUserId: userId,
    });
    await setSecret(clientIdSecretKey("microsoft"), "client-id", userId);
    await setSecret(clientSecretSecretKey("microsoft"), "client-secret", userId);

    const { pollMailboxOnce } = await import("./poll-mailbox");

    const result = await pollMailboxOnce();

    expect(result.ingested).toBe(0);
    expect(result.reason).toBe("message fetch failed");

    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));
    expect(connection.status).toBe("error");
  });
});
