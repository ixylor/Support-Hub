import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";
import type { MailTransport } from "@/lib/mail/transport";
import type { WorkflowState } from "../state";
import type { GateVerdict } from "./gate";

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

export async function sendNode(
  state: WorkflowState,
  verdict: GateVerdict,
  transport: MailTransport
): Promise<{ sentMessageId: string }> {
  if (!state.outbound) {
    throw new Error("The send node reached with nothing to send.");
  }

  // The guard that matters most in this system. It stops a resumed run from
  // re-sending once the prior send's row has committed — the common case,
  // since a checkpointed graph can reach this node again after a crash, a
  // retried job, or a duplicate resume. It does not cover the narrower
  // window where the process dies after transport.send() succeeds but
  // before the insert below commits; that gap is real and is called out in
  // the Task 8 report rather than papered over here.
  const [existing] = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.ticketId, state.ticketId),
        eq(ticketMessages.approvalId, verdict.approvalId)
      )
    )
    .limit(1);

  if (existing) {
    return { sentMessageId: existing.id };
  }

  const body = verdict.decision === "edit" && verdict.editedBody ? verdict.editedBody : state.outbound.body;

  // Thread onto the newest inbound message so the customer's mail client
  // keeps the conversation together.
  const references = state.thread
    .map((message) => message.messageIdHeader)
    .filter((header): header is string => header !== null);
  const inReplyTo = references.length ? references[references.length - 1] : null;

  const sent = await transport.send({
    to: state.requesterEmail,
    subject: replySubject(state.subject),
    bodyText: body,
    inReplyTo,
    references,
  });

  // ingest-message.ts records the party that actually wrote the message
  // (the provider-reported sender), not "whoever the ticket is with" — for
  // an outbound row that is the mailbox the reply was sent from, matching
  // the address the transport puts in the From header.
  const [ticketRow] = await db
    .select({ mailboxAddress: mailboxConnections.mailboxAddress })
    .from(tickets)
    .innerJoin(mailboxConnections, eq(tickets.mailboxConnectionId, mailboxConnections.id))
    .where(eq(tickets.id, state.ticketId))
    .limit(1);

  if (!ticketRow) {
    throw new Error(`Ticket ${state.ticketId} has no resolvable mailbox connection.`);
  }

  const [row] = await db
    .insert(ticketMessages)
    .values({
      ticketId: state.ticketId,
      direction: "outbound",
      senderEmail: ticketRow.mailboxAddress,
      body,
      providerMessageId: sent.providerMessageId,
      messageIdHeader: sent.messageIdHeader,
      inReplyToHeader: inReplyTo,
      approvalId: verdict.approvalId,
    })
    .returning({ id: ticketMessages.id });

  return { sentMessageId: row.id };
}
