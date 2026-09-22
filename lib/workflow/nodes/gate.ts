import { interrupt } from "@langchain/langgraph";
import { createApproval, type ApprovalKind, type Verdict } from "../approvals";
import type { WorkflowState } from "../state";

export interface GateVerdict extends Verdict {
  approvalId: string;
}

/**
 * The one gate every critical decision passes through. Either it auto-approves
 * (approval disabled and confidence clears the floor) and returns immediately,
 * or it suspends the run until a reviewer decides.
 *
 * `interrupt()` throws on the first pass and, when the run is resumed with a
 * Command, returns the resume value at this exact point.
 */
export async function gate(input: {
  state: WorkflowState;
  kind: ApprovalKind;
  proposal: unknown;
  confidence: number;
}): Promise<GateVerdict> {
  const { id, autoApproved } = await createApproval({
    ticketId: input.state.ticketId,
    graphThreadId: input.state.graphThreadId,
    kind: input.kind,
    proposal: input.proposal,
    confidence: input.confidence,
  });

  if (autoApproved) {
    return { ...autoApproved, approvalId: id };
  }

  const verdict = interrupt<{ approvalId: string; kind: ApprovalKind }, Verdict>({
    approvalId: id,
    kind: input.kind,
  });

  return { ...verdict, approvalId: id };
}
