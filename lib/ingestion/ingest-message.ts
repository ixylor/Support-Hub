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
      .returning({ id: tickets.id });
    ticketId = created.id;
  }

  const [insertedMessage] = await db
    .insert(ticketMessages)
    .values({
      ticketId,
      direction: "inbound",
      senderEmail: message.senderEmail,
      body: message.bodyText,
      providerMessageId: message.providerMessageId,
      sentAt: message.sentAt,
    })
    .returning({ id: ticketMessages.id });

  for (const attachment of message.attachments) {
    const content = await provider.downloadAttachment(accessToken, message.providerMessageId, attachment);
    const storagePath = await saveAttachment(insertedMessage.id, attachment.filename, content);
    await db.insert(attachments).values({
      ticketMessageId: insertedMessage.id,
      filename: attachment.filename,
      storagePath,
      contentType: attachment.contentType,
      sizeBytes: content.byteLength,
    });
  }
}
