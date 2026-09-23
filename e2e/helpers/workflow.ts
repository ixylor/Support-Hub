import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  mailboxConnections,
  ticketApprovals,
  ticketMessages,
  tickets,
} from "@/lib/db/schema";

export async function seedTicketWithPendingSendApproval(connectedByUserId: string) {
  const [connection] = await db
    .insert(mailboxConnections)
    .values({
      provider: "microsoft",
      mailboxAddress: `workflow-${crypto.randomUUID()}@example.com`,
      encryptedRefreshToken: "unused-in-this-test",
      connectedByUserId,
      status: "disconnected",
    })
    .returning({ id: mailboxConnections.id });

  const [ticket] = await db
    .insert(tickets)
    .values({
      subject: "Password reset request",
      requesterEmail: "customer@example.com",
      status: "pending_review",
      mailboxConnectionId: connection.id,
      providerThreadId: crypto.randomUUID(),
    })
    .returning({ id: tickets.id });

  await db.insert(ticketMessages).values({
    ticketId: ticket.id,
    direction: "inbound",
    senderEmail: "customer@example.com",
    body: "How do I reset my password?",
    providerMessageId: crypto.randomUUID(),
  });

  const [approval] = await db
    .insert(ticketApprovals)
    .values({
      ticketId: ticket.id,
      graphThreadId: `ticket:${ticket.id}`,
      kind: "send_email",
      proposal: {
        kind: "answer",
        body: "Reset your password.",
        citedChunkIds: [],
      },
      confidence: "0.9",
    })
    .returning({ id: ticketApprovals.id });

  async function teardown() {
    await db.delete(ticketApprovals).where(eq(ticketApprovals.ticketId, ticket.id));
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
    await db.delete(tickets).where(eq(tickets.id, ticket.id));
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connection.id));
  }

  return { ticketId: ticket.id, approvalId: approval.id, teardown };
}
