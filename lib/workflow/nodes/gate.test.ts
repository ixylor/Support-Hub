import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketApprovals, workflowSettings } from "@/lib/db/schema";
import { createTestTicket } from "@/lib/test-helpers/tickets";
import { createTestUser } from "@/lib/test-helpers/users";
import { decideApproval } from "../approvals";
import type { WorkflowState } from "../state";
import { NoPendingApprovalError, awaitApproval, beginApproval } from "./gate";

const interrupt = vi.fn();
vi.mock("@langchain/langgraph", () => ({ interrupt: (...args: unknown[]) => interrupt(...args) }));

describe("gate", () => {
  let ticketId: string;

  beforeEach(async () => {
    await db.delete(ticketApprovals);
    await db
      .update(workflowSettings)
      .set({ isEnabled: true, requireApproval: true, autoSendMinConfidence: "0.8" });
    vi.clearAllMocks();
    ticketId = await createTestTicket({});
  });

  function baseState(overrides: Partial<WorkflowState> = {}): WorkflowState {
    return {
      ticketId,
      graphThreadId: "thread-1",
      subject: "s",
      requesterEmail: "customer@example.test",
      thread: [],
      triage: null,
      kbHits: [],
      route: null,
      outbound: null,
      feedback: null,
      draftAttempts: 0,
      infoRounds: 0,
      endReason: null,
      pendingApproval: null,
      verdict: null,
      ...overrides,
    } as WorkflowState;
  }

  describe("beginApproval", () => {
    it("creates a pending approval and stores it in state without suspending", async () => {
      const patch = await beginApproval({
        state: baseState(),
        kind: "send_email",
        proposal: { body: "x" },
        confidence: 0.4,
      });

      expect(interrupt).not.toHaveBeenCalled();
      expect(patch.pendingApproval?.autoApproved).toBeNull();
      expect(patch.pendingApproval?.kind).toBe("send_email");

      const rows = await db.select().from(ticketApprovals).where(eq(ticketApprovals.ticketId, ticketId));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(patch.pendingApproval?.id);
    });

    it("auto-approves above the confidence floor when approval is disabled", async () => {
      await db.update(workflowSettings).set({ requireApproval: false });

      const patch = await beginApproval({
        state: baseState(),
        kind: "send_email",
        proposal: { body: "x" },
        confidence: 0.95,
      });

      expect(patch.pendingApproval?.autoApproved?.decision).toBe("approve");
    });
  });

  describe("awaitApproval", () => {
    it("returns an auto-approved verdict without calling interrupt", async () => {
      const state = baseState({
        pendingApproval: {
          id: "11111111-1111-1111-1111-111111111111",
          kind: "send_email",
          autoApproved: { decision: "approve", editedBody: null, feedback: null, overrideAction: null },
        },
      });

      const patch = await awaitApproval(state);

      expect(interrupt).not.toHaveBeenCalled();
      expect(patch.verdict).toEqual({
        decision: "approve",
        editedBody: null,
        feedback: null,
        overrideAction: null,
        approvalId: "11111111-1111-1111-1111-111111111111",
      });
      expect(patch.pendingApproval).toBeNull();
    });

    it("suspends via interrupt() and attaches the approval id to the resumed verdict", async () => {
      interrupt.mockReturnValue({
        decision: "edit",
        editedBody: "Better wording.",
        feedback: null,
        overrideAction: null,
      });

      const state = baseState({
        pendingApproval: { id: "approval-id", kind: "send_email", autoApproved: null },
      });

      const patch = await awaitApproval(state);

      expect(interrupt).toHaveBeenCalledWith({ approvalId: "approval-id", kind: "send_email" });
      expect(patch.verdict).toMatchObject({ decision: "edit", editedBody: "Better wording.", approvalId: "approval-id" });
      expect(patch.pendingApproval).toBeNull();
    });

    it("throws when there is nothing pending to resolve", async () => {
      await expect(awaitApproval(baseState())).rejects.toBeInstanceOf(NoPendingApprovalError);
      expect(interrupt).not.toHaveBeenCalled();
    });

    // This is the regression the split design exists to prevent. Before the
    // fix, createApproval lived inside the same node body as interrupt(),
    // so resuming after a reviewer's decision re-ran createApproval and
    // minted a second pending row — orphaning it (the constraint that
    // limits one pending approval per thread no longer applies once the
    // first is decided) and handing sendNode an approvalId nothing was
    // ever sent under. Splitting createApproval into beginApproval, which
    // is never re-invoked on resume, is what this test proves holds.
    it("resuming after a decision does not create a second approval row", async () => {
      const beginPatch = await beginApproval({
        state: baseState(),
        kind: "send_email",
        proposal: { body: "x" },
        confidence: 0.4,
      });
      const pendingApproval = beginPatch.pendingApproval!;
      const originalId = pendingApproval.id;

      const userId = await createTestUser();
      const decided = { decision: "approve" as const, editedBody: null, feedback: null, overrideAction: null };
      await decideApproval(originalId, decided, userId);

      // Simulates LangGraph re-invoking awaitApproval on resume: the same
      // state — still carrying beginApproval's original pendingApproval —
      // is handed to the node again, and this time interrupt() has a
      // resume value to return instead of suspending.
      interrupt.mockReturnValue(decided);
      const resumedPatch = await awaitApproval(baseState({ pendingApproval }));

      expect(resumedPatch.verdict?.approvalId).toBe(originalId);

      const rows = await db.select().from(ticketApprovals).where(eq(ticketApprovals.ticketId, ticketId));
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(originalId);
    });
  });
});
