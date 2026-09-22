import { Command } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketApprovals, workflowSettings } from "@/lib/db/schema";
import { createTestTicket } from "@/lib/test-helpers/tickets";
import { resumeWorkflowRun, startWorkflowRun } from "./run";

const invoke = vi.fn();
vi.mock("./graph", () => ({
  compileWorkflowGraph: async () => ({ invoke: (...args: unknown[]) => invoke(...args) }),
}));
vi.mock("@/lib/mail/transports", () => ({ getMailTransport: async () => ({}) }));

describe("workflow run", () => {
  let ticketId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.update(workflowSettings).set({ isEnabled: true });
    ticketId = await createTestTicket({});
  });

  it("starts the graph on a thread derived from the ticket", async () => {
    await startWorkflowRun(ticketId);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [input, config] = invoke.mock.calls[0];
    expect(input).toEqual({ ticketId, graphThreadId: `ticket:${ticketId}` });
    expect(config.configurable.thread_id).toBe(`ticket:${ticketId}`);
  });

  it("does nothing when the master switch is off", async () => {
    await db.update(workflowSettings).set({ isEnabled: false });

    await startWorkflowRun(ticketId);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("resumes a decided approval on its original thread", async () => {
    const [approval] = await db
      .insert(ticketApprovals)
      .values({
        ticketId,
        graphThreadId: `ticket:${ticketId}`,
        kind: "send_email",
        proposal: { body: "Draft" },
        confidence: "0.9",
        status: "decided",
        decision: "edit",
        editedBody: "Reviewed reply",
        decidedAt: new Date(),
      })
      .returning({ id: ticketApprovals.id });

    await resumeWorkflowRun(approval.id);
    await resumeWorkflowRun(approval.id);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [input, config] = invoke.mock.calls[0];
    expect(input).toBeInstanceOf(Command);
    expect(input).toMatchObject({
      resume: {
        decision: "edit",
        editedBody: "Reviewed reply",
        feedback: null,
        overrideAction: null,
      },
    });
    expect(config.configurable.thread_id).toBe(`ticket:${ticketId}`);

    const [resumed] = await db
      .select({ status: ticketApprovals.status })
      .from(ticketApprovals)
      .where(eq(ticketApprovals.id, approval.id));
    expect(resumed.status).toBe("superseded");
  });

  it("does not resume a pending, superseded, or missing approval", async () => {
    const [approval] = await db
      .insert(ticketApprovals)
      .values({
        ticketId,
        graphThreadId: `ticket:${ticketId}`,
        kind: "send_email",
        proposal: { body: "Draft" },
        confidence: "0.9",
      })
      .returning({ id: ticketApprovals.id });

    await resumeWorkflowRun(approval.id);
    await db
      .update(ticketApprovals)
      .set({ status: "superseded" })
      .where(eq(ticketApprovals.id, approval.id));
    await resumeWorkflowRun(approval.id);
    await resumeWorkflowRun(crypto.randomUUID());

    expect(invoke).not.toHaveBeenCalled();
  });
});
