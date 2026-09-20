import { NextRequest } from "next/server";
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

describe("POST /api/cron/poll-mailbox", () => {
  let userId: string;

  beforeAll(async () => {
    const result = await auth.api.signUpEmail({
      body: { email: `cron-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
    });
    userId = result.user.id;
  });

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await db.delete(attachments);
    await db.delete(ticketMessages);
    await db.delete(tickets);
    await db.delete(mailboxConnections);
  });

  it("rejects requests without the correct secret", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/cron/poll-mailbox", { method: "POST" });

    const response = await POST(request);

    expect(response.status).toBe(401);
  });

  it("does nothing when no mailbox is connected", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/cron/poll-mailbox", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(body.ingested).toBe(0);
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

    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/cron/poll-mailbox", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    await POST(request);

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

    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/cron/poll-mailbox", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(body.ingested).toBe(1);
    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));
    expect(connection.syncCursor).toBe("2026-09-19T10:00:00Z");
  });

  it("does not advance the sync cursor when a message fails to ingest", async () => {
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

    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/cron/poll-mailbox", {
      method: "POST",
      headers: { "x-cron-secret": "test-secret" },
    });

    const response = await POST(request);
    const body = await response.json();

    // First message succeeds, second fails
    expect(body.ingested).toBe(1);
    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.mailboxAddress, "support@example.com"));
    // Cursor should not be advanced because not all messages succeeded
    expect(connection.syncCursor).toBeNull();
  });
});
