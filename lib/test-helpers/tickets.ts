import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/secrets/crypto";
import { createTestUser } from "./users";

// mailbox_connections enforces one active row database-wide, so reuse
// whatever is already there rather than racing the partial unique index.
export async function ensureMailboxConnection(): Promise<string> {
  const [existing] = await db.select({ id: mailboxConnections.id }).from(mailboxConnections).limit(1);
  if (existing) return existing.id;

  const userId = await createTestUser();
  const [row] = await db
    .insert(mailboxConnections)
    .values({
      provider: "microsoft",
      mailboxAddress: "support@example.test",
      encryptedRefreshToken: encryptSecret("refresh-token"),
      connectedByUserId: userId,
      status: "active",
    })
    .returning({ id: mailboxConnections.id });
  return row.id;
}

export async function createTestTicket(input: {
  status?: "new" | "pending_review" | "escalated" | "resolved" | "waiting_on_customer" | "triaged_out";
  subject?: string;
  requesterEmail?: string;
}): Promise<string> {
  const mailboxConnectionId = await ensureMailboxConnection();
  const [row] = await db
    .insert(tickets)
    .values({
      subject: input.subject ?? "Login is not working",
      requesterEmail: input.requesterEmail ?? "customer@example.test",
      status: input.status ?? "new",
      mailboxConnectionId,
      providerThreadId: randomUUID(),
    })
    .returning({ id: tickets.id });
  return row.id;
}

export async function addInboundMessage(
  ticketId: string,
  body: string,
  messageIdHeader = `<${randomUUID()}@mail.example.test>`
): Promise<string> {
  const [row] = await db
    .insert(ticketMessages)
    .values({
      ticketId,
      direction: "inbound",
      senderEmail: "customer@example.test",
      body,
      providerMessageId: randomUUID(),
      messageIdHeader,
    })
    .returning({ id: ticketMessages.id });
  return row.id;
}
