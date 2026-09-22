import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowState } from "../state";
import { drafterNode, infoRequesterNode, routeNode, triageNode } from "./agents";

const runAgent = vi.fn();
vi.mock("../run-agent", () => ({ runAgent: (...args: unknown[]) => runAgent(...args) }));

const chat = vi.fn() as never;

function baseState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    ticketId: "ticket-1",
    graphThreadId: "thread-1",
    subject: "Login is not working",
    requesterEmail: "customer@example.test",
    thread: [
      {
        direction: "inbound",
        senderEmail: "customer@example.test",
        body: "I cannot sign in.",
        messageIdHeader: null,
        sentAt: new Date(),
      },
    ],
    triage: null,
    kbHits: [],
    route: null,
    outbound: null,
    feedback: null,
    draftAttempts: 0,
    infoRounds: 0,
    endReason: null,
    ...overrides,
  } as WorkflowState;
}

describe("agent nodes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triage sends only the newest inbound message", async () => {
    runAgent.mockResolvedValue({
      isGenuine: true,
      reason: "support request",
      category: "technical",
      priority: "high",
      confidence: 0.9,
    });

    const patch = await triageNode(baseState(), chat);

    expect(runAgent.mock.calls[0][0].key).toBe("triage");
    expect(runAgent.mock.calls[0][0].userPrompt).toContain("I cannot sign in.");
    expect(patch.triage?.category).toBe("technical");
  });

  it("route sends the thread and the retrieved passages", async () => {
    runAgent.mockResolvedValue({ action: "answer", reason: "covered", confidence: 0.8 });

    await routeNode(
      baseState({
        kbHits: [{ chunkId: "c1", entryTitle: "Sign-in errors", text: "Reset the password.", score: 1 }],
      }),
      chat
    );

    const prompt = runAgent.mock.calls[0][0].userPrompt;
    expect(prompt).toContain("Customer: I cannot sign in.");
    expect(prompt).toContain("Sign-in errors");
    expect(prompt).toContain("Reset the password.");
  });

  it("route reports that the knowledge base is empty rather than omitting the section", async () => {
    runAgent.mockResolvedValue({ action: "escalate", reason: "nothing found", confidence: 0.7 });

    await routeNode(baseState({ kbHits: [] }), chat);

    expect(runAgent.mock.calls[0][0].userPrompt).toContain("No knowledge base passages matched");
  });

  it("drafter returns an answer and clears consumed feedback", async () => {
    runAgent.mockResolvedValue({
      body: "Reset your password from the sign-in page.",
      citedChunkIds: ["c1"],
      confidence: 0.85,
    });

    const patch = await drafterNode(
      baseState({
        feedback: "Too curt.",
        draftAttempts: 0,
        kbHits: [{ chunkId: "c1", entryTitle: "T", text: "x", score: 1 }],
      }),
      chat
    );

    expect(runAgent.mock.calls[0][0].userPrompt).toContain("Too curt.");
    expect(patch.outbound?.kind).toBe("answer");
    expect(patch.outbound?.citedChunkIds).toEqual(["c1"]);
    expect(patch.feedback).toBeNull();
    expect(patch.draftAttempts).toBe(1);
  });

  it("drafter drops citations the retrieval did not actually return", async () => {
    runAgent.mockResolvedValue({
      body: "Here you go.",
      citedChunkIds: ["c1", "invented-chunk"],
      confidence: 0.85,
    });

    const patch = await drafterNode(
      baseState({ kbHits: [{ chunkId: "c1", entryTitle: "T", text: "x", score: 1 }] }),
      chat
    );

    expect(patch.outbound?.citedChunkIds).toEqual(["c1"]);
  });

  it("info requester returns a question and increments the round count", async () => {
    runAgent.mockResolvedValue({ body: "Which error message do you see?", confidence: 0.9 });

    const patch = await infoRequesterNode(baseState({ infoRounds: 1 }), chat);

    expect(patch.outbound?.kind).toBe("question");
    expect(patch.outbound?.citedChunkIds).toEqual([]);
    expect(patch.infoRounds).toBe(2);
  });
});
