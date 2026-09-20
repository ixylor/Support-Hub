import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, ticketMessages, tickets } from "@/lib/db/schema";
import type { MailProvider, ProviderMessage } from "./provider";
import { saveAttachment } from "./attachment-storage";

const REOPENABLE_STATUSES = ["resolved", "waiting_on_customer"] as const;

export async function ingestMessage(
  mailboxConnectionId: string,
  message: ProviderMessage,
  provider: MailProvider,
  accessToken: string
): Promise<void> {
  const [existingMessage] = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(eq(ticketMessages.providerMessageId, message.providerMessageId))
    .limit(1);
  if (existingMessage) {
    return; // Already ingested — overlapping poll window.
  }

  const [existingTicket] = await db
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(
      and(
        eq(tickets.mailboxConnectionId, mailboxConnectionId),
        eq(tickets.providerThreadId, message.providerThreadId)
      )
    )
    .limit(1);

  let ticketId: string;
  if (existingTicket) {
    ticketId = existingTicket.id;
    if (REOPENABLE_STATUSES.includes(existingTicket.status as (typeof REOPENABLE_STATUSES)[number])) {
      await db.update(tickets).set({ status: "new" }).where(eq(tickets.id, ticketId));
    }
  } else {
    const [created] = await db
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
      const [winner] = await db
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
    }
  }

  // Download and persist attachments to disk before touching the database so
  // that a failure here never leaves a half-ingested message row behind. The
  // per-message directory is keyed on the provider message id (stable and
  // unique) rather than the ticket_messages row, since that row does not
  // exist yet.
  const storedAttachments: { filename: string; storagePath: string; contentType: string; sizeBytes: number }[] = [];
  for (const attachment of message.attachments) {
    const content = await provider.downloadAttachment(accessToken, message.providerMessageId, attachment);
    const storagePath = await saveAttachment(message.providerMessageId, attachment.filename, content);
    storedAttachments.push({
      filename: attachment.filename,
      storagePath,
      contentType: attachment.contentType,
      sizeBytes: content.byteLength,
    });
  }

  await db.transaction(async (tx) => {
    const [insertedMessage] = await tx
      .insert(ticketMessages)
      .values({
        ticketId,
        direction: "inbound",
        senderEmail: message.senderEmail,
        body: message.bodyText,
        providerMessageId: message.providerMessageId,
        sentAt: message.sentAt,
      })
      .onConflictDoNothing({ target: ticketMessages.providerMessageId })
      .returning({ id: ticketMessages.id });

    if (!insertedMessage) {
      // Another poll cycle ingested this message concurrently. The
      // attachments we just downloaded become orphaned files on disk,
      // which is harmless — nothing references them.
      return;
    }

    if (storedAttachments.length > 0) {
      await tx.insert(attachments).values(
        storedAttachments.map((stored) => ({
          ticketMessageId: insertedMessage.id,
          ...stored,
        }))
      );
    }
  });
}
