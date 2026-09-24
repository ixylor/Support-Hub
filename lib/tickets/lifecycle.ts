import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deletedGoogleThreads, mailboxConnections, tickets } from "@/lib/db/schema";

export const DELETABLE_TICKET_STATUSES = ["resolved", "triaged_out"] as const;
export type DeletableTicketStatus = (typeof DELETABLE_TICKET_STATUSES)[number];

export type DeleteTicketResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_deletable" };

function isDeletableStatus(status: string): status is DeletableTicketStatus {
  return (DELETABLE_TICKET_STATUSES as readonly string[]).includes(status);
}

async function removeCheckpoints(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ticketId: string) {
  const threadIds = [`ticket:${ticketId}`, `manual:${ticketId}`];
  for (const threadId of threadIds) {
    await tx.execute(sql`DELETE FROM "checkpoint_writes" WHERE "thread_id" = ${threadId}`);
    await tx.execute(sql`DELETE FROM "checkpoint_blobs" WHERE "thread_id" = ${threadId}`);
    await tx.execute(sql`DELETE FROM "checkpoints" WHERE "thread_id" = ${threadId}`);
  }
  const inboundThreadPrefix = `ticket:${ticketId}:inbound:%`;
  await tx.execute(sql`DELETE FROM "checkpoint_writes" WHERE "thread_id" LIKE ${inboundThreadPrefix}`);
  await tx.execute(sql`DELETE FROM "checkpoint_blobs" WHERE "thread_id" LIKE ${inboundThreadPrefix}`);
  await tx.execute(sql`DELETE FROM "checkpoints" WHERE "thread_id" LIKE ${inboundThreadPrefix}`);
}

/**
 * Permanently removes a ticket and every record owned by it.
 *
 * The status predicate is repeated on the DELETE itself so a concurrent
 * status change cannot turn a safe delete into a delete of an active ticket.
 * Foreign-key cascades remove relational children; checkpoint rows live in
 * LangGraph's tables and therefore need explicit cleanup here.
 */
export async function deleteTicket(ticketId: string): Promise<DeleteTicketResult> {
  const result = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .select({
        id: tickets.id,
        status: tickets.status,
        providerThreadId: tickets.providerThreadId,
        provider: mailboxConnections.provider,
        mailboxAddress: mailboxConnections.mailboxAddress,
      })
      .from(tickets)
      .innerJoin(mailboxConnections, eq(tickets.mailboxConnectionId, mailboxConnections.id))
      .where(eq(tickets.id, ticketId))
      .limit(1);

    if (!ticket) return { ok: false as const, reason: "not_found" as const };
    if (!isDeletableStatus(ticket.status)) {
      return { ok: false as const, reason: "not_deletable" as const };
    }

    if (ticket.provider === "google") {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${ticket.mailboxAddress.trim().toLowerCase()}), hashtext(${ticket.providerThreadId}))`
      );
      await tx
        .insert(deletedGoogleThreads)
        .values({
          mailboxAddress: ticket.mailboxAddress.trim().toLowerCase(),
          providerThreadId: ticket.providerThreadId,
        })
        .onConflictDoNothing({
          target: [deletedGoogleThreads.mailboxAddress, deletedGoogleThreads.providerThreadId],
        });
    }

    const deleted = await tx
      .delete(tickets)
      .where(and(eq(tickets.id, ticketId), inArray(tickets.status, DELETABLE_TICKET_STATUSES)))
      .returning({ id: tickets.id });

    if (deleted.length === 0) {
      return { ok: false as const, reason: "not_found" as const };
    }

    await removeCheckpoints(tx, ticketId);

    return { ok: true as const };
  });

  return result;
}
