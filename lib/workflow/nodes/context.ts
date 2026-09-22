import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketMessages, tickets } from "@/lib/db/schema";
import { searchKnowledgeBase } from "@/lib/kb/retrieve";
import type { ThreadMessage, WorkflowState } from "../state";

const KB_RESULT_LIMIT = 8;

// A genuine role marker begins at column zero — the first character
// immediately after the previous message's join. A message body is
// customer-controlled text inserted after that marker, so any line of it
// beyond the first would otherwise land at column zero too, on its own
// line, in the exact position a real marker occupies — indistinguishable
// to a model no matter how the line is punctuated or spaced. Indenting
// every line but the first denies the body that position entirely: no
// character a customer can put in a message body reaches column zero, so
// a forged "Support:"/"Customer:" line can be present in the text without
// ever being mistaken for a turn boundary.
const CONTINUATION_INDENT = "    ";

function indentContinuationLines(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line, index) => (index === 0 ? line : CONTINUATION_INDENT + line))
    .join("\n");
}

export function formatThread(thread: ThreadMessage[]): string {
  return thread
    .map(
      (message) =>
        `${message.direction === "inbound" ? "Customer" : "Support"}: ${indentContinuationLines(message.body)}`
    )
    .join("\n\n");
}

export function newestInbound(thread: ThreadMessage[]): ThreadMessage | null {
  for (let index = thread.length - 1; index >= 0; index--) {
    if (thread[index].direction === "inbound") return thread[index];
  }
  return null;
}

export async function loadContextNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const [ticket] = await db
    .select({ subject: tickets.subject, requesterEmail: tickets.requesterEmail })
    .from(tickets)
    .where(eq(tickets.id, state.ticketId))
    .limit(1);

  if (!ticket) {
    throw new Error(`Ticket ${state.ticketId} no longer exists.`);
  }

  const rows = await db
    .select({
      direction: ticketMessages.direction,
      senderEmail: ticketMessages.senderEmail,
      body: ticketMessages.body,
      messageIdHeader: ticketMessages.messageIdHeader,
      sentAt: ticketMessages.sentAt,
    })
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, state.ticketId))
    .orderBy(asc(ticketMessages.sentAt));

  // Derived from the thread rather than carried in state, so a follow-up run
  // starting fresh still knows how many times we have already asked.
  const infoRounds = rows.filter((row) => row.direction === "outbound").length;

  return {
    thread: rows,
    subject: ticket.subject,
    requesterEmail: ticket.requesterEmail,
    infoRounds,
  };
}

export async function retrieveKbNode(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const latest = newestInbound(state.thread);
  // The subject carries the problem in a handful of words and the newest
  // message carries the detail; together they retrieve better than either.
  const query = [state.subject, latest?.body].filter(Boolean).join("\n\n");

  const results = await searchKnowledgeBase({ query, limit: KB_RESULT_LIMIT });

  return {
    kbHits: results.map((result) => ({
      chunkId: result.chunkId,
      entryTitle: result.title,
      text: result.chunkText,
      score: result.score,
    })),
  };
}
