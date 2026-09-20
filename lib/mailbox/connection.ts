import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mailboxConnections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secrets/crypto";

export type MailboxProvider = "microsoft" | "google";
export type MailboxStatus = "active" | "disconnected" | "error";

export interface MailboxConnectionSummary {
  id: string;
  provider: MailboxProvider;
  mailboxAddress: string;
  status: MailboxStatus;
  syncCursor: string | null;
}

export async function getActiveMailboxConnection(): Promise<MailboxConnectionSummary | null> {
  const [row] = await db
    .select({
      id: mailboxConnections.id,
      provider: mailboxConnections.provider,
      mailboxAddress: mailboxConnections.mailboxAddress,
      status: mailboxConnections.status,
      syncCursor: mailboxConnections.syncCursor,
    })
    .from(mailboxConnections)
    .where(eq(mailboxConnections.status, "active"))
    .limit(1);

  return row ?? null;
}

export async function getDecryptedRefreshToken(connectionId: string): Promise<string> {
  const [row] = await db
    .select({ encryptedRefreshToken: mailboxConnections.encryptedRefreshToken })
    .from(mailboxConnections)
    .where(eq(mailboxConnections.id, connectionId))
    .limit(1);

  if (!row) {
    throw new Error(`Mailbox connection ${connectionId} not found.`);
  }

  return decryptSecret(row.encryptedRefreshToken);
}

export async function connectMailbox(input: {
  provider: MailboxProvider;
  mailboxAddress: string;
  refreshToken: string;
  connectedByUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(mailboxConnections)
      .set({ status: "disconnected" })
      .where(eq(mailboxConnections.status, "active"));

    await tx.insert(mailboxConnections).values({
      provider: input.provider,
      mailboxAddress: input.mailboxAddress,
      encryptedRefreshToken: encryptSecret(input.refreshToken),
      connectedByUserId: input.connectedByUserId,
      status: "active",
    });
  });
}

export async function disconnectActiveMailbox(): Promise<void> {
  await db
    .update(mailboxConnections)
    .set({ status: "disconnected" })
    .where(eq(mailboxConnections.status, "active"));
}

export async function setMailboxConnectionStatus(
  connectionId: string,
  status: MailboxStatus
): Promise<void> {
  await db.update(mailboxConnections).set({ status }).where(eq(mailboxConnections.id, connectionId));
}

export async function updateSyncCursor(connectionId: string, cursor: string): Promise<void> {
  await db
    .update(mailboxConnections)
    .set({ syncCursor: cursor })
    .where(eq(mailboxConnections.id, connectionId));
}
