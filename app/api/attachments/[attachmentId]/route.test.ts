import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";

const TEST_DIR = "./storage/attachments-route-test";

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

function params(attachmentId: string) {
  return { params: Promise.resolve({ attachmentId }) };
}

describe("GET /api/attachments/[attachmentId]", () => {
  let userId: string;
  let connectionId: string;
  let ticketId: string;
  let messageId: string;

  beforeAll(async () => {
    const [seedUser] = await db
      .insert(user)
      .values({
        id: `attachment-route-test-${crypto.randomUUID()}`,
        name: "Seed",
        email: `attachment-route-test-${crypto.randomUUID()}@example.com`,
      })
      .returning({ id: user.id });
    userId = seedUser.id;

    const [connection] = await db
      .insert(mailboxConnections)
      .values({
        provider: "microsoft",
        mailboxAddress: "support@example.com",
        encryptedRefreshToken: "unused-in-this-test",
        connectedByUserId: seedUser.id,
        status: "disconnected",
      })
      .returning({ id: mailboxConnections.id });
    connectionId = connection.id;

    const [ticket] = await db
      .insert(tickets)
      .values({
        subject: "Attachment route test",
        requesterEmail: "customer@example.com",
        status: "new",
        mailboxConnectionId: connectionId,
        providerThreadId: `thread-${crypto.randomUUID()}`,
      })
      .returning({ id: tickets.id });
    ticketId = ticket.id;

    const [message] = await db
      .insert(ticketMessages)
      .values({
        ticketId,
        direction: "inbound",
        senderEmail: "customer@example.com",
        body: "See attached.",
        providerMessageId: `provider-msg-${crypto.randomUUID()}`,
      })
      .returning({ id: ticketMessages.id });
    messageId = message.id;
  });

  beforeEach(() => {
    vi.stubEnv("ATTACHMENTS_DIR", TEST_DIR);
    vi.resetModules();
  });

  afterAll(async () => {
    await db.delete(ticketMessages).where(eq(ticketMessages.id, messageId));
    await db.delete(tickets).where(eq(tickets.id, ticketId));
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connectionId));
    await db.delete(user).where(eq(user.id, userId));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await db.delete(attachments).where(eq(attachments.ticketMessageId, messageId));
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("rejects an unauthenticated request without serving file bytes", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/attachments/x"), params(crypto.randomUUID()));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("hello");
  });

  it("returns 404 for an attachment id that does not exist", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/attachments/x"), params(crypto.randomUUID()));

    expect(response.status).toBe(404);
  });

  it("returns 404 for a malformed attachment id instead of erroring", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/attachments/x"), params("not-a-uuid"));

    expect(response.status).toBe(404);
  });

  it("serves an inline-safe image with an inline disposition and nosniff", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    const dir = resolve(TEST_DIR, messageId);
    await mkdir(dir, { recursive: true });
    const filePath = resolve(dir, "photo.png");
    await writeFile(filePath, Buffer.from("fake-png-bytes"));

    const [attachment] = await db
      .insert(attachments)
      .values({
        ticketMessageId: messageId,
        filename: "photo.png",
        storagePath: filePath,
        contentType: "image/png",
        sizeBytes: 14,
      })
      .returning({ id: attachments.id });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/attachments/x"), params(attachment.id));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("inline");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("fake-png-bytes");
  });

  it("forces a download disposition for HTML even though it might look 'viewable'", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    const dir = resolve(TEST_DIR, messageId);
    await mkdir(dir, { recursive: true });
    const filePath = resolve(dir, "page.html");
    await writeFile(filePath, Buffer.from("<script>alert(1)</script>"));

    const [attachment] = await db
      .insert(attachments)
      .values({
        ticketMessageId: messageId,
        filename: "page.html",
        storagePath: filePath,
        contentType: "text/html",
        sizeBytes: 26,
      })
      .returning({ id: attachments.id });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/attachments/x"), params(attachment.id));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("forces a download disposition for SVG (inline SVG can carry script)", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    const dir = resolve(TEST_DIR, messageId);
    await mkdir(dir, { recursive: true });
    const filePath = resolve(dir, "image.svg");
    await writeFile(filePath, Buffer.from("<svg onload='alert(1)'></svg>"));

    const [attachment] = await db
      .insert(attachments)
      .values({
        ticketMessageId: messageId,
        filename: "image.svg",
        storagePath: filePath,
        contentType: "image/svg+xml",
        sizeBytes: 30,
      })
      .returning({ id: attachments.id });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/attachments/x"), params(attachment.id));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("returns 404 (not the file) when storagePath has been tampered with to point outside the attachments dir", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    const outsideDir = resolve("./storage/outside-attachments-test");
    await mkdir(outsideDir, { recursive: true });
    const outsidePath = resolve(outsideDir, "secret.txt");
    await writeFile(outsidePath, Buffer.from("should never be served"));

    const [attachment] = await db
      .insert(attachments)
      .values({
        ticketMessageId: messageId,
        filename: "secret.txt",
        storagePath: outsidePath,
        contentType: "text/plain",
        sizeBytes: 23,
      })
      .returning({ id: attachments.id });

    try {
      const { GET } = await import("./route");
      const response = await GET(new Request("http://localhost/api/attachments/x"), params(attachment.id));

      expect(response.status).toBe(404);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("returns a clean 404 when the row exists but the file is missing on disk", async () => {
    const { auth } = await import("@/lib/auth/server");
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id: "u1" } } as never);

    const dir = resolve(TEST_DIR, messageId);
    await mkdir(dir, { recursive: true });
    const filePath = resolve(dir, "gone.txt");
    // Note: never written to disk.

    const [attachment] = await db
      .insert(attachments)
      .values({
        ticketMessageId: messageId,
        filename: "gone.txt",
        storagePath: filePath,
        contentType: "text/plain",
        sizeBytes: 5,
      })
      .returning({ id: attachments.id });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/attachments/x"), params(attachment.id));

    expect(response.status).toBe(404);
  });
});
