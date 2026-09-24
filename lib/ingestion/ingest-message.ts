import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  attachments,
  deletedGoogleThreads,
  mailboxConnections,
  ticketMessages,
  tickets,
} from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/boss";
import { QUEUES } from "@/lib/jobs/queues";
import { supersedePendingApprovals } from "@/lib/workflow/approvals";
import type { ProviderMessage } from "./provider";

const REOPENABLE_STATUSES = ["resolved", "waiting_on_customer"] as const;

export async function ingestMessage(
  mailboxConnectionId: string,
  message: ProviderMessage
): Promise<void> {
  const [existingMessage] = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(eq(ticketMessages.providerMessageId, message.providerMessageId))
    .limit(1);
  if (existingMessage) {
    return; // Already ingested — overlapping poll window.
  }

  const [connection] = await db
    .select({ provider: mailboxConnections.provider, mailboxAddress: mailboxConnections.mailboxAddress })
    .from(mailboxConnections)
    .where(eq(mailboxConnections.id, mailboxConnectionId))
    .limit(1);
  if (connection?.provider === "google") {
    const [deletedThread] = await db
      .select({ id: deletedGoogleThreads.id })
      .from(deletedGoogleThreads)
      .where(
        and(
          eq(deletedGoogleThreads.mailboxAddress, connection.mailboxAddress.trim().toLowerCase()),
          eq(deletedGoogleThreads.providerThreadId, message.providerThreadId)
        )
      )
      .limit(1);
    if (deletedThread) return;
  }

  const ingested = await db.transaction(async (tx) => {
    const [currentConnection] = await tx
      .select({ provider: mailboxConnections.provider, mailboxAddress: mailboxConnections.mailboxAddress })
      .from(mailboxConnections)
      .where(eq(mailboxConnections.id, mailboxConnectionId))
      .limit(1);

    if (currentConnection?.provider === "google") {
      // Serialize ingestion against deletion for this mailbox/thread. This
      // closes the race where polling read "not deleted" just before an admin
      // committed the tombstone.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${currentConnection.mailboxAddress.trim().toLowerCase()}), hashtext(${message.providerThreadId}))`
      );
    }

    // Recheck inside the write transaction in case deletion raced with this
    // poll after the early return above.
    if (currentConnection?.provider === "google") {
      const [deletedThread] = await tx
        .select({ id: deletedGoogleThreads.id })
        .from(deletedGoogleThreads)
        .where(
          and(
            eq(deletedGoogleThreads.mailboxAddress, currentConnection.mailboxAddress.trim().toLowerCase()),
            eq(deletedGoogleThreads.providerThreadId, message.providerThreadId)
          )
        )
        .limit(1);
      if (deletedThread) return null;
    }

    // Gmail can expose a different native thread id for a message that still
    // belongs to an existing RFC email conversation. Follow its parent ids so
    // the reply stays on the ticket that already contains that message.
    let existingTicket: { id: string; status: (typeof tickets.status.enumValues)[number] } | undefined;
    const parentMessageIds = [
      message.inReplyToHeader,
      ...(message.referencesHeader?.split(/\s+/).reverse() ?? []),
    ].filter((value): value is string => Boolean(value));

    for (const parentMessageId of parentMessageIds) {
      const [relatedTicket] = await tx
        .select({ id: tickets.id, status: tickets.status })
        .from(ticketMessages)
        .innerJoin(tickets, eq(ticketMessages.ticketId, tickets.id))
        .where(
          and(
            eq(ticketMessages.messageIdHeader, parentMessageId),
            eq(tickets.mailboxConnectionId, mailboxConnectionId)
          )
        )
        .limit(1);

      if (relatedTicket) {
        existingTicket = relatedTicket;
        break;
      }

      // Reconnecting the same Google mailbox creates a new connection row.
      // Gmail's thread is still the same conversation, so consult prior
      // Google connection rows for RFC parent message IDs as well.
      if (currentConnection?.provider === "google") {
        const [googleRelatedTicket] = await tx
          .select({ id: tickets.id, status: tickets.status })
          .from(ticketMessages)
          .innerJoin(tickets, eq(ticketMessages.ticketId, tickets.id))
          .innerJoin(mailboxConnections, eq(tickets.mailboxConnectionId, mailboxConnections.id))
          .where(
            and(
              eq(ticketMessages.messageIdHeader, parentMessageId),
              eq(mailboxConnections.provider, "google"),
              eq(mailboxConnections.mailboxAddress, currentConnection.mailboxAddress)
            )
          )
          .limit(1);

        if (googleRelatedTicket) {
          existingTicket = googleRelatedTicket;
          break;
        }
      }
    }

    if (!existingTicket) {
      [existingTicket] = await tx
        .select({ id: tickets.id, status: tickets.status })
        .from(tickets)
        .where(
          and(
            eq(tickets.mailboxConnectionId, mailboxConnectionId),
            eq(tickets.providerThreadId, message.providerThreadId)
          )
        )
        .limit(1);
    }

    if (!existingTicket && currentConnection?.provider === "google") {
      [existingTicket] = await tx
        .select({ id: tickets.id, status: tickets.status })
        .from(tickets)
        .innerJoin(mailboxConnections, eq(tickets.mailboxConnectionId, mailboxConnections.id))
        .where(
          and(
            eq(mailboxConnections.provider, "google"),
            eq(mailboxConnections.mailboxAddress, currentConnection.mailboxAddress),
            eq(tickets.providerThreadId, message.providerThreadId)
          )
        )
        .limit(1);
    }

    let ticketId: string;
    let isReply = Boolean(existingTicket);
    if (existingTicket) {
      ticketId = existingTicket.id;
      if (REOPENABLE_STATUSES.includes(existingTicket.status as (typeof REOPENABLE_STATUSES)[number])) {
        await tx.update(tickets).set({ status: "new" }).where(eq(tickets.id, ticketId));
      }
    } else {
      const [created] = await tx
        .insert(tickets)
        .values({
          subject: message.subject,
          requesterEmail: message.senderEmail,
          status: "new",
          mailboxConnectionId,
          providerThreadId: message.providerThreadId,
        })
        .onConflictDoNothing({ target: [tickets.mailboxConnectionId, tickets.providerThreadId] })
        .returning({ id: tickets.id });

      if (created) {
        ticketId = created.id;
      } else {
        // Another poll cycle won the race and created the ticket for this
        // thread first — pick it up rather than treating the conflict as an error.
        const [winner] = await tx
          .select({ id: tickets.id })
          .from(tickets)
          .where(
            and(
              eq(tickets.mailboxConnectionId, mailboxConnectionId),
              eq(tickets.providerThreadId, message.providerThreadId)
            )
          )
          .limit(1);
        if (!winner) {
          throw new Error(
            `Ticket vanished between insert conflict and re-read: mailboxConnectionId=${mailboxConnectionId}, providerThreadId=${message.providerThreadId}`
          );
        }
        ticketId = winner.id;
        isReply = true;
      }
    }

    const [insertedMessage] = await tx
      .insert(ticketMessages)
      .values({
        ticketId,
        direction: "inbound",
        senderEmail: message.senderEmail,
        body: message.bodyText,
        providerMessageId: message.providerMessageId,
        messageIdHeader: message.messageIdHeader ?? null,
        inReplyToHeader: message.inReplyToHeader ?? null,
        sentAt: message.sentAt,
      })
      .onConflictDoNothing({ target: ticketMessages.providerMessageId })
      .returning({ id: ticketMessages.id });

    if (!insertedMessage) {
      // Another poll cycle ingested this message concurrently. The
      // This message was ingested concurrently, so there is nothing to add.
      return null;
    }

    if (message.attachments.length > 0) {
      await tx.insert(attachments).values(
        message.attachments.map((attachment) => ({
          ticketMessageId: insertedMessage.id,
          filename: attachment.filename,
          providerAttachmentId: attachment.id,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes ?? 0,
        }))
      );
    }

    return { ticketId, isReply };
  });

  if (!ingested) return;

  if (ingested.isReply) {
    await supersedePendingApprovals(ingested.ticketId);
  }

  await enqueue(QUEUES.workflowRun, {
    ticketId: ingested.ticketId,
    trigger: ingested.isReply ? "customer_reply" : "new_ticket",
  });
}
