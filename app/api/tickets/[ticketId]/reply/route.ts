import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import { getMailTransport } from "@/lib/mail/transports";
import { normalizeEmailBody } from "@/lib/mail/format";
import { runAgent } from "@/lib/workflow/run-agent";
import { azureChatClient } from "@/lib/ai/chat";
import { getTicketWithMessages, type TicketViewer } from "@/lib/tickets/queries";

const DRAFT_SCHEMA = {
  type: "object",
  properties: { body: { type: "string", minLength: 1 } },
  required: ["body"],
  additionalProperties: false,
};

interface ManualReplyDraft {
  body: string;
}

function draftBody(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const body = (value as Partial<ManualReplyDraft>).body;
  if (typeof body !== "string" || body.trim().length === 0) return null;
  return body;
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  const { ticketId } = await params;
  const viewer: TicketViewer = {
    id: session.user.id,
    role: (session.user as { role: "agent" | "admin" }).role,
  };
  const ticket = await getTicketWithMessages(ticketId, viewer);
  if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });

  const input = (await request.json().catch(() => null)) as { action?: string; body?: string } | null;
  if (input?.action === "draft") {
    const messages = ticket.messages
      .map((message) => `${message.direction === "inbound" ? "Customer" : "Support"}: ${message.body}`)
      .join("\n\n");
    const result = await runAgent<ManualReplyDraft>({
      key: "manual_writer",
      userPrompt: [
        `Subject: ${ticket.subject}`,
        "",
        "Conversation:",
        messages,
        "",
        "Write a short, professional support reply. Be clear and warm. Use only the information in the conversation. Do not add a subject, greeting placeholder, signature placeholder, or commentary about drafting. Use complete sentences, avoid hard line breaks inside sentences, and leave one blank line between paragraphs.",
        "Return exactly one JSON object matching the response schema: {\"body\":\"the complete email reply\"}. Put the entire reply in body; do not return a bare string or any fields besides body.",
      ].join("\n"),
      schemaName: "manual_reply_draft",
      schema: DRAFT_SCHEMA,
      ticketId,
      graphThreadId: `manual:${ticketId}`,
      chat: azureChatClient,
    });
    const body = draftBody(result);
    if (!body) {
      return NextResponse.json(
        { error: "The draft agent returned no email body. Try drafting again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ body: normalizeEmailBody(body) });
  }

  const body = input?.body?.trim();
  if (!body) return NextResponse.json({ error: "Write a reply before sending." }, { status: 400 });
  if (body.length > 20000) return NextResponse.json({ error: "Reply is too long." }, { status: 400 });

  const rows = await db
    .select({
      subject: tickets.subject,
      requesterEmail: tickets.requesterEmail,
      providerThreadId: tickets.providerThreadId,
      mailboxAddress: mailboxConnections.mailboxAddress,
    })
    .from(tickets)
    .innerJoin(mailboxConnections, eq(tickets.mailboxConnectionId, mailboxConnections.id))
    .where(eq(tickets.id, ticketId));
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "Ticket mailbox not found." }, { status: 404 });

  const thread = await db
    .select({ direction: ticketMessages.direction, messageIdHeader: ticketMessages.messageIdHeader })
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.sentAt));
  const references = thread
    .map((message) => message.messageIdHeader)
    .filter((header): header is string => Boolean(header));
  let inReplyTo: string | null = null;
  for (let index = thread.length - 1; index >= 0; index--) {
    if (thread[index].direction === "inbound" && thread[index].messageIdHeader) {
      inReplyTo = thread[index].messageIdHeader;
      break;
    }
  }

  const sent = await (await getMailTransport()).send({
    to: row.requesterEmail,
    subject: replySubject(row.subject),
    bodyText: body,
    threadId: row.providerThreadId,
    inReplyTo,
    references,
  });
  const [message] = await db.insert(ticketMessages).values({
    ticketId,
    direction: "outbound",
    senderEmail: row.mailboxAddress,
    body,
    providerMessageId: sent.providerMessageId,
    messageIdHeader: sent.messageIdHeader,
    inReplyToHeader: inReplyTo,
  }).returning({ id: ticketMessages.id });

  return NextResponse.json({ ok: true, messageId: message.id });
}
