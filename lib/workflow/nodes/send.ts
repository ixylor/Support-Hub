import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { mailboxConnections, ticketMessages, ticketSendAttempts, tickets } from "@/lib/db/schema";
import type { MailTransport } from "@/lib/mail/transport";
import type { GateVerdict, WorkflowState } from "../state";

export class NoOutboundDraftError extends Error {
  constructor(ticketId: string) {
    super(`sendNode reached for ticket ${ticketId} with nothing to send.`);
    this.name = "NoOutboundDraftError";
  }
}

export class TicketMailboxNotFoundError extends Error {
  constructor(ticketId: string) {
    super(`Ticket ${ticketId} has no resolvable mailbox connection.`);
    this.name = "TicketMailboxNotFoundError";
  }
}

// Thrown after a send attempt is recorded as failed, so the caller (and,
// through it, the graph run) observes the failure rather than the run
// silently continuing as if the reply went out.
export class SendFailedError extends Error {
  constructor(ticketId: string, cause: string) {
    super(`Sending the reply for ticket ${ticketId} failed: ${cause}`);
    this.name = "SendFailedError";
  }
}

const SEND_ATTEMPT_APPROVAL_CONSTRAINT = "ticket_send_attempts_approval_id_unique";

// Same pattern as approvals.ts's isPendingPerThreadViolation: postgres.js
// flattens the driver error's fields onto `.cause`, and checking the
// constraint name (rather than the message text) is what keeps this from
// ever matching the wrong unique index by accident.
function isApprovalAlreadyClaimedViolation(error: unknown): boolean {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  if (!(cause instanceof Error)) return false;

  const pgError = cause as { code?: string; constraint_name?: string };
  return pgError.code === "23505" && pgError.constraint_name === SEND_ATTEMPT_APPROVAL_CONSTRAINT;
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

export async function sendNode(
  state: WorkflowState,
  verdict: GateVerdict,
  transport: MailTransport
): Promise<{ sentMessageId: string | null }> {
  if (!state.outbound) {
    throw new NoOutboundDraftError(state.ticketId);
  }

  // The claim. Inserted before the transport is ever called, with a unique
  // constraint on approval_id: a second attempt at the same approval loses
  // this insert instead of quietly proceeding, which is what makes a
  // duplicate customer email structurally impossible rather than merely
  // unlikely — a check-then-insert guard (the previous design) has a race
  // window between the check and the insert that this does not.
  let claim: { id: string };
  try {
    [claim] = await db
      .insert(ticketSendAttempts)
      .values({
        ticketId: state.ticketId,
        approvalId: verdict.approvalId,
        status: "sending",
      })
      .returning({ id: ticketSendAttempts.id });
  } catch (error) {
    if (!isApprovalAlreadyClaimedViolation(error)) throw error;

    // Someone already claimed this send — possibly mid-flight, possibly
    // finished. Either way this run has nothing left to do: calling the
    // transport now would risk the exact duplicate the claim exists to
    // prevent. If the earlier attempt finished successfully there is a
    // ticket_messages row to hand back; if it is still in flight or failed,
    // there is nothing to return.
    const [existingMessage] = await db
      .select({ id: ticketMessages.id })
      .from(ticketMessages)
      .where(
        and(eq(ticketMessages.ticketId, state.ticketId), eq(ticketMessages.approvalId, verdict.approvalId))
      )
      .limit(1);

    return { sentMessageId: existingMessage?.id ?? null };
  }

  const body = verdict.decision === "edit" && verdict.editedBody ? verdict.editedBody : state.outbound.body;
  const [ticketThread] = await db
    .select({ providerThreadId: tickets.providerThreadId })
    .from(tickets)
    .where(eq(tickets.id, state.ticketId))
    .limit(1);

  // Thread onto the newest inbound message so the customer's mail client
  // keeps the conversation together.
  const references = state.thread
    .map((message) => message.messageIdHeader)
    .filter((header): header is string => header !== null);
  // Reply to the newest customer message, not merely the newest row. This
  // keeps the outbound message attached to the customer's email even when a
  // ticket contains an older support reply or is replayed after a retry.
  let inReplyTo: string | null = null;
  for (let index = state.thread.length - 1; index >= 0; index--) {
    if (state.thread[index].direction === "inbound" && state.thread[index].messageIdHeader) {
      inReplyTo = state.thread[index].messageIdHeader;
      break;
    }
  }

  let sent: { providerMessageId: string; messageIdHeader: string | null };
  try {
    sent = await transport.send({
      to: state.requesterEmail,
      subject: replySubject(state.subject),
      bodyText: body,
      threadId: ticketThread?.providerThreadId ?? null,
      inReplyTo,
      references,
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    // The claim row is left in place, not deleted or retried automatically
    // — a fresh attempt would need a fresh approval, and its unique
    // constraint on approval_id is exactly what stops this failure from
    // quietly turning into two customer emails if something retries the
    // same approval later. This row is the visible record of the failure.
    await db
      .update(ticketSendAttempts)
      .set({ status: "failed", errorText, completedAt: new Date() })
      .where(eq(ticketSendAttempts.id, claim.id));

    throw new SendFailedError(state.ticketId, errorText);
  }

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
    // The transport already sent the message at this point — the claim row
    // stays "sending" rather than being marked failed, since the reply did
    // go out; a human needs to see this as "sent but unrecorded", not
    // "never sent". Surfacing that distinction on the ticket is Task 12's
    // concern; this only has to avoid quietly losing the fact that it happened.
    throw new TicketMailboxNotFoundError(state.ticketId);
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

  await db
    .update(ticketSendAttempts)
    .set({
      status: "sent",
      providerMessageId: sent.providerMessageId,
      messageIdHeader: sent.messageIdHeader,
      completedAt: new Date(),
    })
    .where(eq(ticketSendAttempts.id, claim.id));

  return { sentMessageId: row.id };
}
