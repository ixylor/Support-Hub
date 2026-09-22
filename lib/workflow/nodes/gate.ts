import { interrupt } from "@langchain/langgraph";
import { createApproval, type ApprovalKind, type Verdict } from "../approvals";
import type { PendingApproval, WorkflowState } from "../state";

export class NoPendingApprovalError extends Error {
  constructor() {
    super("awaitApproval reached with no pending approval in state.");
    this.name = "NoPendingApprovalError";
  }
}

/**
 * Creates the approval row (or auto-approves) and stores the outcome in
 * state, without ever calling interrupt() itself.
 *
 * This has to be a separate graph node from awaitApproval, not a single
 * function that does both. LangGraph checkpoints at node boundaries: when a
 * node calls interrupt() and the run later resumes, everything in that
 * node's body before the interrupt() call re-executes from the top. A
 * combined "createApproval, then interrupt()" node would therefore call
 * createApproval again on every resume — minting a second pending approval
 * row after the first was already decided, and handing sendNode's
 * idempotency guard an approvalId that never received the original reply.
 * Keeping createApproval in its own node means it runs exactly once: this
 * node commits to the checkpoint before awaitApproval ever suspends, so
 * awaitApproval re-executing on resume never touches this function again.
 */
export async function beginApproval(input: {
  state: WorkflowState;
  kind: ApprovalKind;
  proposal: unknown;
  confidence: number;
}): Promise<Partial<WorkflowState>> {
  const { id, autoApproved } = await createApproval({
    ticketId: input.state.ticketId,
    graphThreadId: input.state.graphThreadId,
    kind: input.kind,
    proposal: input.proposal,
    confidence: input.confidence,
  });

  const pendingApproval: PendingApproval = { id, kind: input.kind, autoApproved };
  return { pendingApproval };
}

/**
 * Resolves the approval beginApproval created: passes an auto-approved
 * verdict straight through, or suspends with interrupt() until a reviewer
 * resumes the run with one. On resume, only this node re-executes — the
 * approval row from beginApproval is already checkpointed, so this never
 * creates a second one.
 */
export async function awaitApproval(state: WorkflowState): Promise<Partial<WorkflowState>> {
  const pending = state.pendingApproval;
  if (!pending) {
    throw new NoPendingApprovalError();
  }

  if (pending.autoApproved) {
    return {
      verdict: { ...pending.autoApproved, approvalId: pending.id },
      pendingApproval: null,
    };
  }

  const verdict = interrupt<{ approvalId: string; kind: ApprovalKind }, Verdict>({
    approvalId: pending.id,
    kind: pending.kind,
  });

  return {
    verdict: { ...verdict, approvalId: pending.id },
    pendingApproval: null,
  };
}
