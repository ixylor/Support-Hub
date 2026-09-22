import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketMessages } from "@/lib/db/schema";
import { addInboundMessage, createTestTicket } from "@/lib/test-helpers/tickets";
import type { MailTransport } from "@/lib/mail/transport";
import type { WorkflowState } from "../state";
import { sendNode } from "./send";

// ticket_messages.approval_id is a uuid column; a real approval's id from
// createApproval is always shaped like this, so the fake here has to be too.
const APPROVAL_ID = "11111111-1111-1111-1111-111111111111";

// provider_message_id is unique across the whole table, and this file's
// tests share one database with no reset between them (see
// vitest.global-setup.ts). Scoping the counter to the module rather than to
// each fakeTransport() instance is what keeps every send in this file from
// colliding on "<outbound-1@...>".
let messageSequence = 0;

function fakeTransport(): MailTransport & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      messageSequence += 1;
      return {
        messageIdHeader: `<outbound-${messageSequence}@mail.example.test>`,
        providerMessageId: `<outbound-${messageSequence}@mail.example.test>`,
      };
    },
    async verify() {},
  };
}

describe("send node", () => {
  let ticketId: string;

  beforeEach(async () => {
    ticketId = await createTestTicket({ subject: "Login is not working" });
    await addInboundMessage(ticketId, "I cannot sign in.", "<inbound-1@mail.example.test>");
  });

  function state(): WorkflowState {
    return {
      ticketId,
      graphThreadId: "thread-1",
      subject: "Login is not working",
      requesterEmail: "customer@example.test",
      thread: [
        {
          direction: "inbound",
          senderEmail: "customer@example.test",
          body: "I cannot sign in.",
          messageIdHeader: "<inbound-1@mail.example.test>",
          sentAt: new Date(),
        },
      ],
      triage: null,
      kbHits: [],
      route: null,
      outbound: { kind: "answer", body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      feedback: null,
      draftAttempts: 1,
      infoRounds: 0,
      endReason: null,
    } as WorkflowState;
  }

  const approve = {
    decision: "approve" as const,
    editedBody: null,
    feedback: null,
    overrideAction: null,
  };

  it("sends the draft, threading it onto the last inbound message", async () => {
    const transport = fakeTransport();

    await sendNode(state(), { ...approve, approvalId: APPROVAL_ID }, transport);

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      to: "customer@example.test",
      subject: "Re: Login is not working",
      bodyText: "Reset your password.",
      inReplyTo: "<inbound-1@mail.example.test>",
      references: ["<inbound-1@mail.example.test>"],
    });
  });

  it("sends the reviewer's edit rather than the original", async () => {
    const transport = fakeTransport();

    await sendNode(
      state(),
      { decision: "edit", editedBody: "A warmer reply.", feedback: null, overrideAction: null, approvalId: APPROVAL_ID },
      transport
    );

    expect(transport.sent[0]).toMatchObject({ bodyText: "A warmer reply." });
  });

  it("does not prefix a subject that already says Re:", async () => {
    const transport = fakeTransport();
    const withRe = { ...state(), subject: "Re: Login is not working" };

    await sendNode(withRe, { ...approve, approvalId: APPROVAL_ID }, transport);

    expect(transport.sent[0]).toMatchObject({ subject: "Re: Login is not working" });
  });

  it("records the outbound message against the approval", async () => {
    const transport = fakeTransport();

    await sendNode(state(), { ...approve, approvalId: APPROVAL_ID }, transport);

    const [row] = await db
      .select()
      .from(ticketMessages)
      .where(
        and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "outbound"))
      );
    expect(row.body).toBe("Reset your password.");
    expect(row.approvalId).toBe(APPROVAL_ID);
    // The exact sequence number depends on how many sends happened earlier
    // in this file (see messageSequence above) — what matters is that the
    // header the transport actually returned is what got persisted.
    expect(row.messageIdHeader).toMatch(/^<outbound-\d+@mail\.example\.test>$/);
    // ingest-message.ts records the party that actually authored the message
    // (message.senderEmail, the customer, for an inbound row) rather than
    // "the other side of the conversation" — the same convention applied to
    // an outbound row means the mailbox that sent it, not the customer it
    // was sent to. createTestTicket's default mailbox is support@example.test.
    expect(row.senderEmail).toBe("support@example.test");
  });

  it("is idempotent: a retried job sends once", async () => {
    const transport = fakeTransport();

    await sendNode(state(), { ...approve, approvalId: APPROVAL_ID }, transport);
    await sendNode(state(), { ...approve, approvalId: APPROVAL_ID }, transport);

    expect(transport.sent).toHaveLength(1);

    const rows = await db
      .select()
      .from(ticketMessages)
      .where(
        and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "outbound"))
      );
    expect(rows).toHaveLength(1);
  });
});
