import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, ticketMessages, tickets } from "@/lib/db/schema";
import { attachmentsDir } from "@/lib/ingestion/attachment-storage";

export const DELETABLE_TICKET_STATUSES = ["resolved", "triaged_out"] as const;
export type DeletableTicketStatus = (typeof DELETABLE_TICKET_STATUSES)[number];

export type DeleteTicketResult =
  | { ok: true; attachmentPaths: string[] }
  | { ok: false; reason: "not_found" | "not_deletable" };

function isDeletableStatus(status: string): status is DeletableTicketStatus {
  return (DELETABLE_TICKET_STATUSES as readonly string[]).includes(status);
}

function safeAttachmentPath(path: string): boolean {
  const base = resolve(attachmentsDir());
  const target = resolve(path);
  const child = relative(base, target);
  return child !== "" && child !== "." && !child.startsWith("..") && !isAbsolute(child);
}

async function removeAttachmentFiles(paths: string[]): Promise<void> {
  await Promise.all(
    paths
      .filter(safeAttachmentPath)
      .map((path) => rm(path, { force: true }).catch(() => undefined))
  );
}

async function removeCheckpoints(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ticketId: string) {
  const threadIds = [`ticket:${ticketId}`, `manual:${ticketId}`];
  for (const threadId of threadIds) {
    await tx.execute(sql`DELETE FROM "checkpoint_writes" WHERE "thread_id" = ${threadId}`);
    await tx.execute(sql`DELETE FROM "checkpoint_blobs" WHERE "thread_id" = ${threadId}`);
    await tx.execute(sql`DELETE FROM "checkpoints" WHERE "thread_id" = ${threadId}`);
  }
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
      .select({ id: tickets.id, status: tickets.status })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .limit(1);

    if (!ticket) return { ok: false as const, reason: "not_found" as const };
    if (!isDeletableStatus(ticket.status)) {
      return { ok: false as const, reason: "not_deletable" as const };
    }

    const attachmentRows = await tx
      .select({ storagePath: attachments.storagePath })
      .from(attachments)
      .innerJoin(ticketMessages, eq(ticketMessages.id, attachments.ticketMessageId))
      .where(eq(ticketMessages.ticketId, ticketId));

    const deleted = await tx
      .delete(tickets)
      .where(and(eq(tickets.id, ticketId), inArray(tickets.status, DELETABLE_TICKET_STATUSES)))
      .returning({ id: tickets.id });

    if (deleted.length === 0) {
      return { ok: false as const, reason: "not_found" as const };
    }

    await removeCheckpoints(tx, ticketId);

    return {
      ok: true as const,
      attachmentPaths: attachmentRows.map((row) => row.storagePath),
    };
  });

  if (result.ok) await removeAttachmentFiles(result.attachmentPaths);
  return result;
}
