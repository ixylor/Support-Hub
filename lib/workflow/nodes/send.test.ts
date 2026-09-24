import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketMessages, ticketSendAttempts } from "@/lib/db/schema";
import { addInboundMessage, createTestTicket } from "@/lib/test-helpers/tickets";
import type { MailTransport } from "@/lib/mail/transport";
import type { WorkflowState } from "../state";
import { SendFailedError, sendNode } from "./send";

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
  // ticket_send_attempts.approval_id is unique across the whole table, not
  // scoped to a ticket — a fixed id reused across tests would make every
  // test after the first collide with the claim the previous test made, for
  // an entirely different ticket. Each test gets its own.
  let approvalId: string;

  beforeEach(async () => {
    ticketId = await createTestTicket({ subject: "Login is not working" });
    await addInboundMessage(ticketId, "I cannot sign in.", "<inbound-1@mail.example.test>");
    approvalId = randomUUID();
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
      pendingApproval: null,
      verdict: null,
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

    await sendNode(state(), { ...approve, approvalId }, transport);

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
      { decision: "edit", editedBody: "A warmer reply.", feedback: null, overrideAction: null, approvalId },
      transport
    );

    expect(transport.sent[0]).toMatchObject({ bodyText: "A warmer reply." });
  });

  it("does not prefix a subject that already says Re:", async () => {
    const transport = fakeTransport();
    const withRe = { ...state(), subject: "Re: Login is not working" };

    await sendNode(withRe, { ...approve, approvalId }, transport);

    expect(transport.sent[0]).toMatchObject({ subject: "Re: Login is not working" });
  });

  it("records the outbound message and a completed send attempt", async () => {
    const transport = fakeTransport();

    await sendNode(state(), { ...approve, approvalId }, transport);

    const [row] = await db
      .select()
      .from(ticketMessages)
      .where(
        and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "outbound"))
      );
    expect(row.body).toBe("Reset your password.");
    expect(row.approvalId).toBe(approvalId);
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

    const [attempt] = await db
      .select()
      .from(ticketSendAttempts)
      .where(eq(ticketSendAttempts.approvalId, approvalId));
    expect(attempt.status).toBe("sent");
    expect(attempt.messageIdHeader).toBe(row.messageIdHeader);
    expect(attempt.completedAt).not.toBeNull();
  });

  it("is idempotent: a retried job sends once", async () => {
    const transport = fakeTransport();

    await sendNode(state(), { ...approve, approvalId }, transport);
    await sendNode(state(), { ...approve, approvalId }, transport);

    expect(transport.sent).toHaveLength(1);

    const rows = await db
      .select()
      .from(ticketMessages)
      .where(
        and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "outbound"))
      );
    expect(rows).toHaveLength(1);
  });

  it("claims the send before calling the transport, so a losing claim never reaches it", async () => {
    // Simulates another run having already claimed this exact send — the
    // scenario the unique constraint on approval_id exists to catch, tested
    // directly rather than only inferred from a sequential retry.
    await db.insert(ticketSendAttempts).values({ ticketId, approvalId, status: "sending" });

    const send = vi.fn(async () => ({
      messageIdHeader: "<should-not-be-sent@mail.example.test>",
      providerMessageId: "<should-not-be-sent@mail.example.test>",
    }));
    const transport: MailTransport = { send, async verify() {} };

    const result = await sendNode(state(), { ...approve, approvalId }, transport);

    expect(send).not.toHaveBeenCalled();
    // Nothing has completed for this approval yet, so there is no message to
    // hand back — the caller should not mistake this for a successful send.
    expect(result.sentMessageId).toBeNull();
  });

  it("records a failed attempt when the transport rejects, and creates no outbound message", async () => {
    const send = vi.fn(async () => {
      throw new Error("mail provider timeout");
    });
    const transport: MailTransport = { send, async verify() {} };

    await expect(sendNode(state(), { ...approve, approvalId }, transport)).rejects.toBeInstanceOf(
      SendFailedError
    );

    expect(send).toHaveBeenCalledTimes(1);

    const [attempt] = await db
      .select()
      .from(ticketSendAttempts)
      .where(eq(ticketSendAttempts.approvalId, approvalId));
    expect(attempt.status).toBe("failed");
    expect(attempt.errorText).toContain("mail provider timeout");
    expect(attempt.completedAt).not.toBeNull();

    const rows = await db
      .select()
      .from(ticketMessages)
      .where(
        and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "outbound"))
      );
    expect(rows).toHaveLength(0);
  });
});
