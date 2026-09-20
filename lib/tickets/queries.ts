import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { attachments, ticketMessages, tickets } from "@/lib/db/schema";

export type TicketListItem = {
  id: string;
  subject: string;
  requesterEmail: string;
  status: (typeof tickets.status.enumValues)[number];
  lastMessageAt: Date;
  messageCount: number;
};

export type TicketAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type TicketMessageWithAttachments = {
  id: string;
  direction: (typeof ticketMessages.direction.enumValues)[number];
  senderEmail: string;
  body: string;
  sentAt: Date;
  attachments: TicketAttachment[];
};

export type TicketWithMessages = {
  id: string;
  subject: string;
  requesterEmail: string;
  status: (typeof tickets.status.enumValues)[number];
  messages: TicketMessageWithAttachments[];
};

// One grouped query rather than a per-ticket loop: aggregates message count
// and last activity alongside the ticket columns.
export async function listTickets(): Promise<TicketListItem[]> {
  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      requesterEmail: tickets.requesterEmail,
      status: tickets.status,
      // A ticket with no messages has no max(sentAt) to fall back on, so use
      // its own createdAt instead of rendering a blank date in the UI.
      lastMessageAt: sql<Date>`coalesce(max(${ticketMessages.sentAt}), ${tickets.createdAt})`.mapWith(
        (value: string) => new Date(value)
      ),
      messageCount: sql<number>`count(${ticketMessages.id})::int`,
    })
    .from(tickets)
    .leftJoin(ticketMessages, eq(ticketMessages.ticketId, tickets.id))
    .groupBy(tickets.id, tickets.subject, tickets.requesterEmail, tickets.status, tickets.createdAt)
    .orderBy(desc(sql`coalesce(max(${ticketMessages.sentAt}), ${tickets.createdAt})`));

  return rows;
}

export async function getTicketWithMessages(ticketId: string): Promise<TicketWithMessages | null> {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) {
    return null;
  }

  const messages = await db
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.sentAt));

  const messageIds = messages.map((message) => message.id);
  const attachmentRows = messageIds.length
    ? await db
        .select({
          id: attachments.id,
          filename: attachments.filename,
          contentType: attachments.contentType,
          sizeBytes: attachments.sizeBytes,
          ticketMessageId: attachments.ticketMessageId,
        })
        .from(attachments)
        .where(inArray(attachments.ticketMessageId, messageIds))
    : [];

  const attachmentsByMessageId = new Map<string, TicketAttachment[]>();
  for (const attachment of attachmentRows) {
    const list = attachmentsByMessageId.get(attachment.ticketMessageId) ?? [];
    list.push({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
    });
    attachmentsByMessageId.set(attachment.ticketMessageId, list);
  }

  return {
    id: ticket.id,
    subject: ticket.subject,
    requesterEmail: ticket.requesterEmail,
    status: ticket.status,
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      senderEmail: message.senderEmail,
      body: message.body,
      sentAt: message.sentAt,
      attachments: attachmentsByMessageId.get(message.id) ?? [],
    })),
  };
}
