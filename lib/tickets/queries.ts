import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { attachments, ticketAssignments, ticketMessages, tickets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";

// Who is asking. Every query that can reach ticket content takes one of
// these rather than trusting the caller to have filtered already: an admin
// sees every ticket, an agent sees only the tickets assigned to them.
export type TicketViewer = {
  id: string;
  role: "agent" | "admin";
};

export type TicketAssignee = {
  id: string;
  name: string;
};

export type TicketPriority = (typeof tickets.priority.enumValues)[number];

export type TicketListItem = {
  id: string;
  subject: string;
  requesterEmail: string;
  status: (typeof tickets.status.enumValues)[number];
  priority: TicketPriority | null;
  assignee: TicketAssignee | null;
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
  priority: TicketPriority | null;
  assignee: TicketAssignee | null;
  messages: TicketMessageWithAttachments[];
};

export type TicketAssignmentEntry = {
  id: string;
  assignee: TicketAssignee | null;
  assignedBy: TicketAssignee;
  priority: TicketPriority | null;
  remark: string | null;
  createdAt: Date;
};

// Which tickets a viewer may see at all. Admins get no filter; everyone
// else is pinned to their own assignments.
function visibilityFilter(viewer: TicketViewer): SQL | undefined {
  return viewer.role === "admin" ? undefined : eq(tickets.assignedToUserId, viewer.id);
}

// The list can be narrowed further in the UI. This is a view preference
// layered on top of the visibility rule above, never a widening of it.
export type TicketListFilter = "all" | "mine" | "unassigned" | "needs_review";

function listFilter(filter: TicketListFilter, viewer: TicketViewer): SQL | undefined {
  if (filter === "needs_review") {
    return eq(tickets.status, "pending_review");
  }
  if (filter === "mine") {
    return eq(tickets.assignedToUserId, viewer.id);
  }
  if (filter === "unassigned") {
    return isNull(tickets.assignedToUserId);
  }
  return undefined;
}

// One grouped query rather than a per-ticket loop: aggregates message count
// and last activity alongside the ticket columns.
export async function listTickets(
  viewer: TicketViewer,
  filter: TicketListFilter = "all",
  options: { showTriagedOut?: boolean } = {}
): Promise<TicketListItem[]> {
  const conditions = [
    visibilityFilter(viewer),
    listFilter(filter, viewer),
    options.showTriagedOut ? undefined : ne(tickets.status, "triaged_out"),
  ].filter((condition): condition is SQL => condition !== undefined);

  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      requesterEmail: tickets.requesterEmail,
      status: tickets.status,
      priority: tickets.priority,
      assigneeId: user.id,
      assigneeName: user.name,
      // A ticket with no messages has no max(sentAt) to fall back on, so use
      // its own createdAt instead of rendering a blank date in the UI.
      lastMessageAt: sql<Date>`coalesce(max(${ticketMessages.sentAt}), ${tickets.createdAt})`.mapWith(
        (value: string) => new Date(value)
      ),
      messageCount: sql<number>`count(${ticketMessages.id})::int`,
    })
    .from(tickets)
    .leftJoin(ticketMessages, eq(ticketMessages.ticketId, tickets.id))
    .leftJoin(user, eq(user.id, tickets.assignedToUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(
      tickets.id,
      tickets.subject,
      tickets.requesterEmail,
      tickets.status,
      tickets.priority,
      tickets.createdAt,
      user.id,
      user.name
    )
    .orderBy(desc(sql`coalesce(max(${ticketMessages.sentAt}), ${tickets.createdAt})`));

  return rows.map(({ assigneeId, assigneeName, ...row }) => ({
    ...row,
    assignee: assigneeId && assigneeName ? { id: assigneeId, name: assigneeName } : null,
  }));
}

export async function getTicketWithMessages(
  ticketId: string,
  viewer: TicketViewer
): Promise<TicketWithMessages | null> {
  const conditions = [eq(tickets.id, ticketId), visibilityFilter(viewer)].filter(
    (condition): condition is SQL => condition !== undefined
  );

  const [ticket] = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      requesterEmail: tickets.requesterEmail,
      status: tickets.status,
      priority: tickets.priority,
      assigneeId: user.id,
      assigneeName: user.name,
    })
    .from(tickets)
    .leftJoin(user, eq(user.id, tickets.assignedToUserId))
    .where(and(...conditions));

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
    priority: ticket.priority,
    assignee:
      ticket.assigneeId && ticket.assigneeName
        ? { id: ticket.assigneeId, name: ticket.assigneeName }
        : null,
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

// Callers reach this only after getTicketWithMessages has already cleared
// the viewer for this ticket, so it takes no viewer of its own.
export async function listTicketAssignments(ticketId: string): Promise<TicketAssignmentEntry[]> {
  // Two joins onto `user` for two different roles in the same row, so each
  // needs its own alias.
  const assignee = alias(user, "assignee");
  const assigner = alias(user, "assigner");

  const rows = await db
    .select({
      id: ticketAssignments.id,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      assignedById: assigner.id,
      assignedByName: assigner.name,
      priority: ticketAssignments.priority,
      remark: ticketAssignments.remark,
      createdAt: ticketAssignments.createdAt,
    })
    .from(ticketAssignments)
    .leftJoin(assignee, eq(assignee.id, ticketAssignments.assignedToUserId))
    .innerJoin(assigner, eq(assigner.id, ticketAssignments.assignedByUserId))
    .where(eq(ticketAssignments.ticketId, ticketId))
    .orderBy(desc(ticketAssignments.createdAt));

  return rows.map((row) => ({
    id: row.id,
    assignee:
      row.assigneeId && row.assigneeName ? { id: row.assigneeId, name: row.assigneeName } : null,
    assignedBy: { id: row.assignedById, name: row.assignedByName },
    priority: row.priority,
    remark: row.remark,
    createdAt: row.createdAt,
  }));
}

// The assignee pickers never load the whole directory — they ask for a
// page of matches as the admin types, so this stays cheap on a large team.
export const ASSIGNEE_SEARCH_LIMIT = 20;

export async function searchAssignableUsers(
  query: string = "",
  limit: number = ASSIGNEE_SEARCH_LIMIT
): Promise<TicketAssignee[]> {
  const trimmed = query.trim();
  // An empty query is the picker's first open: show the first page rather
  // than nothing, so choosing from a small team needs no typing.
  const pattern = `%${trimmed.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;

  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(trimmed === "" ? undefined : or(ilike(user.name, pattern), ilike(user.email, pattern)))
    .orderBy(asc(user.name))
    .limit(limit);
}
