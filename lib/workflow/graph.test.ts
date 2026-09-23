import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Command } from "@langchain/langgraph";
import { db } from "@/lib/db/client";
import {
  agents,
  aiDeployments,
  llmLogs,
  ticketApprovals,
  ticketMessages,
  tickets,
  workflowSettings,
} from "@/lib/db/schema";
import { addInboundMessage, createTestTicket } from "@/lib/test-helpers/tickets";
import { createTestUser } from "@/lib/test-helpers/users";
import type { ChatClient } from "@/lib/ai/chat";
import type { MailTransport } from "@/lib/mail/transport";
import { compileWorkflowGraph } from "./graph";
import { decideApproval, getPendingApproval, type Verdict } from "./approvals";
import { TicketMailboxNotFoundError } from "./nodes/send";

// send.ts is real everywhere except the one test that forces
// TicketMailboxNotFoundError — importOriginal keeps every other call
// behaving exactly as the unmocked module would.
vi.mock("./nodes/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nodes/send")>();
  return { ...actual, sendNode: vi.fn(actual.sendNode) };
});

// retrieveKbNode calls out to embeddings, which needs real Azure credentials
// — no test may make that call. None of these tests depend on what the
// knowledge base returns, only on the route/draft the fake chat client
// produces, so an empty result set is enough.
vi.mock("@/lib/kb/retrieve", () => ({
  searchKnowledgeBase: vi.fn(async () => []),
}));

// Returns canned structured responses keyed by schema name, so one fake
// serves every agent without caring about prompt text.
function fakeChat(responses: Record<string, unknown | unknown[]>): ChatClient {
  const counters: Record<string, number> = {};
  return (async (request: { schemaName: string }) => {
    const entry = responses[request.schemaName];
    if (entry === undefined) {
      throw new Error(`No fake response for schema "${request.schemaName}".`);
    }
    const data = Array.isArray(entry)
      ? entry[Math.min(counters[request.schemaName] ?? 0, entry.length - 1)]
      : entry;
    counters[request.schemaName] = (counters[request.schemaName] ?? 0) + 1;
    return { data, rawResponse: JSON.stringify(data), modelName: "fake-model" };
  }) as ChatClient;
}

// provider_message_id is unique across the whole table, and this file's
// tests share one database with no reset between them (see
// vitest.global-setup.ts). Scoping the counter to the module rather than to
// each fakeTransport() instance is what keeps every send in this file from
// colliding on "<out-1@...>" (see lib/workflow/nodes/send.test.ts, which
// hits the same thing).
let messageSequence = 0;

function fakeTransport(): MailTransport & { sent: { bodyText: string }[] } {
  const sent: { bodyText: string }[] = [];
  return {
    sent,
    async send(message) {
      sent.push({ bodyText: message.bodyText });
      messageSequence += 1;
      return {
        messageIdHeader: `<out-${messageSequence}@mail.example.test>`,
        providerMessageId: `<out-${messageSequence}@mail.example.test>`,
      };
    },
    async verify() {},
  };
}

const GENUINE = {
  isGenuine: true,
  reason: "support request",
  category: "technical",
  priority: "high",
  confidence: 0.95,
};

let ticketId: string;
let reviewerId: string;

async function seedDeployment() {
  // The agent runner needs a resolvable deployment name; the fake chat client
  // never uses it, but runAgent refuses to proceed without one. No agent
  // pins a deployment, so every agent falls back to this active "chat"
  // deployment — the same path getAgentConfig uses in production when
  // nothing is pinned (see lib/workflow/run-agent.test.ts).
  await db.update(agents).set({ isEnabled: true, aiDeploymentId: null });
  await db.delete(aiDeployments);
  const userId = await createTestUser();
  await db.insert(aiDeployments).values({
    role: "chat",
    deploymentName: "fake-deployment",
    modelName: "fake-model",
    isActive: true,
    updatedByUserId: userId,
  });
}

// Seeds a decided approval whose proposal carries the given kind, then an
// outbound message linked to it — the shape sendNode itself produces. Used
// to put the ticket at the info-round cap without going through the graph,
// mirroring how lib/workflow/nodes/context.ts derives infoRounds from
// ticket_messages joined through ticket_approvals.proposal->>'kind'.
async function seedAnsweredQuestionRound(round: number) {
  const [approval] = await db
    .insert(ticketApprovals)
    .values({
      ticketId,
      graphThreadId: `thread-${ticketId}`,
      kind: "send_email",
      proposal: { kind: "question" },
      confidence: "0.9",
      status: "decided",
      decision: "approve",
    })
    .returning({ id: ticketApprovals.id });

  await db.insert(ticketMessages).values({
    ticketId,
    direction: "outbound",
    senderEmail: "support@example.test",
    body: `Question ${round}`,
    providerMessageId: `out-${round}-${ticketId}`,
    approvalId: approval.id,
  });
}

describe("workflow graph", () => {
  beforeEach(async () => {
    await db.delete(ticketApprovals);
    await db
      .update(workflowSettings)
      .set({ isEnabled: true, requireApproval: true, autoSendMinConfidence: "0.8" });
    await seedDeployment();
    ticketId = await createTestTicket({ subject: "Login is not working" });
    await addInboundMessage(ticketId, "I cannot sign in.", "<in-1@mail.example.test>");
    reviewerId = await createTestUser();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticketId));
    await db.delete(ticketApprovals).where(eq(ticketApprovals.ticketId, ticketId));
    await db.delete(llmLogs).where(eq(llmLogs.ticketId, ticketId));
    await db.delete(tickets).where(eq(tickets.id, ticketId));
  });

  async function run(chat: ChatClient, transport: MailTransport) {
    const graph = await compileWorkflowGraph({ chat, transport });
    const config = { configurable: { thread_id: `thread-${ticketId}` } };
    return { graph, config };
  }

  // Mirrors what the (not-yet-built) reviewer-decision endpoint does: decide
  // the pending approval row first, then resume the run with that same
  // verdict. Resuming via Command alone only ever supplies interrupt()'s
  // return value — nothing about that touches ticket_approvals, and the
  // next gate's beginApproval would find the previous approval still
  // "pending" and refuse to create a second one on the same thread (see
  // ticket_approvals_one_pending_per_thread).
  async function resumeApproval(
    graph: Awaited<ReturnType<typeof compileWorkflowGraph>>,
    config: { configurable: { thread_id: string } },
    verdict: Verdict
  ) {
    const pending = await getPendingApproval(ticketId);
    if (!pending) {
      throw new Error("Nothing pending to decide.");
    }
    await decideApproval(pending.id, verdict, reviewerId);
    return graph.invoke(new Command({ resume: verdict }), config);
  }

  it("interrupts at the send gate instead of emailing the customer", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);

    expect(transport.sent).toHaveLength(0);

    const pending = await getPendingApproval(ticketId);
    expect(pending?.kind).toBe("send_email");

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("pending_review");
  });

  it("approving the send gate sends and then asks to close", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    await resumeApproval(graph, config, {
      decision: "approve",
      editedBody: null,
      feedback: null,
      overrideAction: null,
    });

    expect(transport.sent.map((message) => message.bodyText)).toEqual(["Reset your password."]);
    expect((await getPendingApproval(ticketId))?.kind).toBe("close");
  });

  it("an edit sends the reviewer's text", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    await resumeApproval(graph, config, {
      decision: "edit",
      editedBody: "Try a password reset.",
      feedback: null,
      overrideAction: null,
    });

    expect(transport.sent[0].bodyText).toBe("Try a password reset.");
  });

  it("two rejections force an escalation rather than a third draft", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    const reject: Verdict = {
      decision: "reject_feedback",
      editedBody: null,
      feedback: "Too curt.",
      overrideAction: null,
    };
    await resumeApproval(graph, config, reject);
    await resumeApproval(graph, config, reject);

    // Hitting the draft-attempt cap routes to gate_escalate, which is a gate
    // like any other: it suspends for its own approval rather than
    // escalating unilaterally, so reaching "escalated" needs that decided
    // too.
    expect((await getPendingApproval(ticketId))?.kind).toBe("escalate");
    await resumeApproval(graph, config, {
      decision: "approve",
      editedBody: null,
      feedback: null,
      overrideAction: null,
    });

    expect(transport.sent).toHaveLength(0);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("escalated");
  });

  it("a triage_out gate approval marks the ticket triaged out", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: { ...GENUINE, isGenuine: false, reason: "spam", confidence: 0.99 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    await resumeApproval(graph, config, {
      decision: "approve",
      editedBody: null,
      feedback: null,
      overrideAction: null,
    });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("triaged_out");
  });

  it("overriding a triage_out continues into the pipeline", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: { ...GENUINE, isGenuine: false, reason: "spam", confidence: 0.99 },
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    await resumeApproval(graph, config, {
      decision: "override",
      editedBody: null,
      feedback: null,
      overrideAction: "continue",
    });

    expect((await getPendingApproval(ticketId))?.kind).toBe("send_email");
  });

  it("take_over ends the run and escalates", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    await resumeApproval(graph, config, {
      decision: "take_over",
      editedBody: null,
      feedback: null,
      overrideAction: null,
    });

    expect(transport.sent).toHaveLength(0);
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("escalated");
  });

  it("a question puts the ticket in waiting_on_customer with no close gate", async () => {
    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "need_info", reason: "no error message", confidence: 0.9 },
        question: { body: "Which error message do you see?", confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    await resumeApproval(graph, config, {
      decision: "approve",
      editedBody: null,
      feedback: null,
      overrideAction: null,
    });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("waiting_on_customer");
    expect(await getPendingApproval(ticketId)).toBeNull();
  });

  it("a fourth info round escalates instead of asking again", async () => {
    // Three prior *answered question* rounds means the cap is already
    // reached when load_context counts them: an outbound message joined to
    // an approval whose proposal kind is "question", the shape sendNode
    // produces for a real info-request round.
    for (let round = 0; round < 3; round++) {
      await seedAnsweredQuestionRound(round);
    }

    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "need_info", reason: "still unclear", confidence: 0.9 },
        question: { body: "One more question?", confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);

    expect((await getPendingApproval(ticketId))?.kind).toBe("escalate");
  });

  it("auto-approves end to end when approval is off and confidence clears the floor", async () => {
    await db.update(workflowSettings).set({ requireApproval: false, autoSendMinConfidence: "0.8" });

    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);

    expect(transport.sent).toHaveLength(1);
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("resolved");
  });

  // sendNode throws TicketMailboxNotFoundError only after the transport has
  // already delivered the reply — the customer got the email, but the row
  // that would record it couldn't be written because the ticket's mailbox
  // lookup failed. Letting that crash the run would leave the ticket stuck
  // with no signal a human could act on; routing it to escalation instead
  // is the deliberate choice documented in lib/workflow/graph.ts.
  it("a mailbox lookup failure after sending escalates instead of crashing the run", async () => {
    const { sendNode } = await import("./nodes/send");
    vi.mocked(sendNode).mockRejectedValueOnce(new TicketMailboxNotFoundError(ticketId));

    const transport = fakeTransport();
    const { graph, config } = await run(
      fakeChat({
        triage: GENUINE,
        router: { action: "answer", reason: "covered", confidence: 0.9 },
        draft: { body: "Reset your password.", citedChunkIds: [], confidence: 0.9 },
      }),
      transport
    );

    await graph.invoke({ ticketId, graphThreadId: `thread-${ticketId}` }, config);
    await resumeApproval(graph, config, {
      decision: "approve",
      editedBody: null,
      feedback: null,
      overrideAction: null,
    });

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("escalated");
    expect(await getPendingApproval(ticketId)).toBeNull();
  });
});
