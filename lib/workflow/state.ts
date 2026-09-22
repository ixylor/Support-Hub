import { Annotation } from "@langchain/langgraph";
import type { ApprovalKind, Verdict } from "./approvals";

export interface ThreadMessage {
  direction: "inbound" | "outbound";
  senderEmail: string;
  body: string;
  messageIdHeader: string | null;
  sentAt: Date;
}

export interface TriageResult {
  isGenuine: boolean;
  reason: string;
  category: "billing" | "technical" | "general" | "other";
  priority: "low" | "medium" | "high" | "urgent";
  confidence: number;
}

export interface RouteResult {
  action: "answer" | "need_info" | "escalate";
  reason: string;
  confidence: number;
}

export interface KbHit {
  chunkId: string;
  entryTitle: string;
  text: string;
  score: number;
}

export interface OutboundDraft {
  kind: "answer" | "question";
  body: string;
  citedChunkIds: string[];
  confidence: number;
}

// A verdict once it is known which approval it resolves. sendNode's
// idempotency guard is keyed on this approvalId, so it has to be the id of
// the approval row that was actually decided — never re-derived.
export interface GateVerdict extends Verdict {
  approvalId: string;
}

// Written by beginApproval and consumed by awaitApproval. Splitting the two
// into separate state fields (rather than one function that does both) is
// what lets them be separate graph nodes: LangGraph checkpoints between
// nodes, not mid-node, and only the node that calls interrupt() re-executes
// on resume. Keeping this in state is what makes the already-created
// approval visible to that later, possibly-repeated node instead of the
// approval being minted again on every resume.
export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  autoApproved: Verdict | null;
}

// Hard caps. A graph that can re-enter nodes needs stops that do not depend
// on a model choosing to give up.
export const MAX_DRAFT_ATTEMPTS = 2;
export const MAX_INFO_ROUNDS = 3;

export const WorkflowStateAnnotation = Annotation.Root({
  ticketId: Annotation<string>,
  graphThreadId: Annotation<string>,
  thread: Annotation<ThreadMessage[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  subject: Annotation<string>({ reducer: (_c, u) => u, default: () => "" }),
  requesterEmail: Annotation<string>({ reducer: (_c, u) => u, default: () => "" }),
  triage: Annotation<TriageResult | null>({ reducer: (_c, u) => u, default: () => null }),
  kbHits: Annotation<KbHit[]>({ reducer: (_c, u) => u, default: () => [] }),
  route: Annotation<RouteResult | null>({ reducer: (_c, u) => u, default: () => null }),
  outbound: Annotation<OutboundDraft | null>({ reducer: (_c, u) => u, default: () => null }),
  // Cleared once the producing node has consumed it, so a later retry does
  // not re-apply stale reviewer feedback.
  feedback: Annotation<string | null>({ reducer: (_c, u) => u, default: () => null }),
  draftAttempts: Annotation<number>({ reducer: (_c, u) => u, default: () => 0 }),
  infoRounds: Annotation<number>({ reducer: (_c, u) => u, default: () => 0 }),
  // Terminal reason recorded on the ticket when the run ends early.
  endReason: Annotation<string | null>({ reducer: (_c, u) => u, default: () => null }),
  // Set by beginApproval, cleared by awaitApproval once it has produced a
  // verdict from it — see PendingApproval above for why this is split.
  pendingApproval: Annotation<PendingApproval | null>({ reducer: (_c, u) => u, default: () => null }),
  verdict: Annotation<GateVerdict | null>({ reducer: (_c, u) => u, default: () => null }),
});

export type WorkflowState = typeof WorkflowStateAnnotation.State;
