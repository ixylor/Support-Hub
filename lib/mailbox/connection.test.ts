import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { auth } from "@/lib/auth/server";
import {
  connectMailbox,
  disconnectActiveMailbox,
  getActiveMailboxConnection,
  getDecryptedRefreshToken,
  MailboxAlreadyConnectedError,
  setMailboxConnectionStatus,
  updateSyncCursor,
} from "./connection";

describe("mailbox connection store", () => {
  let userId: string;

  beforeAll(async () => {
    const result = await auth.api.signUpEmail({
      body: { email: `mailbox-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
    });
    userId = result.user.id;
  });

  afterEach(async () => {
    await db.delete(attachments);
    await db.delete(ticketMessages);
    await db.delete(tickets);
    await db.delete(mailboxConnections);
  });

  it("returns null when no mailbox is connected", async () => {
    expect(await getActiveMailboxConnection()).toBeNull();
  });

  it("connects a mailbox and returns it as the active connection", async () => {
    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "refresh-token-value",
      connectedByUserId: userId,
    });

    const connection = await getActiveMailboxConnection();

    expect(connection).toMatchObject({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      status: "active",
    });
  });

  it("stores a sync cursor at connection time instead of leaving it null", async () => {
    const before = Date.now();
    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "refresh-token-value",
      connectedByUserId: userId,
    });
    const after = Date.now();

    const connection = await getActiveMailboxConnection();

    expect(connection?.syncCursor).not.toBeNull();
    const cursorTime = new Date(connection!.syncCursor as string).getTime();
    expect(cursorTime).toBeGreaterThanOrEqual(before);
    expect(cursorTime).toBeLessThanOrEqual(after);
  });

  it("round-trips the refresh token through encryption", async () => {
    await connectMailbox({
      provider: "google",
      mailboxAddress: "support@example.com",
      refreshToken: "refresh-token-value",
      connectedByUserId: userId,
    });
    const connection = await getActiveMailboxConnection();

    const token = await getDecryptedRefreshToken(connection!.id);

    expect(token).toBe("refresh-token-value");
  });

  it("requires disconnecting the active mailbox before connecting another", async () => {
    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "old@example.com",
      refreshToken: "old-token",
      connectedByUserId: userId,
    });
    await expect(
      connectMailbox({
        provider: "google",
        mailboxAddress: "new@example.com",
        refreshToken: "new-token",
        connectedByUserId: userId,
      })
    ).rejects.toBeInstanceOf(MailboxAlreadyConnectedError);

    const active = await getActiveMailboxConnection();
    const allConnections = await db.select().from(mailboxConnections);

    expect(active?.mailboxAddress).toBe("old@example.com");
    expect(allConnections.filter((row) => row.status === "active")).toHaveLength(1);
    expect(allConnections).toHaveLength(1);
  });

  it("disconnects the active mailbox", async () => {
    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "refresh-token-value",
      connectedByUserId: userId,
    });

    await disconnectActiveMailbox();

    expect(await getActiveMailboxConnection()).toBeNull();
  });

  it("updates connection status and sync cursor", async () => {
    await connectMailbox({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      refreshToken: "refresh-token-value",
      connectedByUserId: userId,
    });
    const connection = await getActiveMailboxConnection();

    await updateSyncCursor(connection!.id, "2026-09-19T10:00:00Z");
    await setMailboxConnectionStatus(connection!.id, "error");

    const [row] = await db.select().from(mailboxConnections).where(eq(mailboxConnections.id, connection!.id));
    expect(row.syncCursor).toBe("2026-09-19T10:00:00Z");
    expect(row.status).toBe("error");
  });
});
