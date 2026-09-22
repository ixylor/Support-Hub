import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketApprovals, tickets } from "@/lib/db/schema";
import { getWorkflowSettings } from "./settings";

export type ApprovalKind = "send_email" | "triage_out" | "escalate" | "close";
export type ApprovalDecision =
  | "approve"
  | "edit"
  | "reject_feedback"
  | "override"
  | "take_over";

export interface Verdict {
  decision: ApprovalDecision;
  editedBody: string | null;
  feedback: string | null;
  overrideAction: string | null;
}

export interface PendingApproval {
  id: string;
  ticketId: string;
  graphThreadId: string;
  kind: ApprovalKind;
  proposal: unknown;
  confidence: number;
  createdAt: Date;
}

export interface ApprovalForTicket {
  id: string;
  status: "pending" | "decided" | "superseded";
  decision: ApprovalDecision | null;
  editedBody: string | null;
  feedback: string | null;
  overrideAction: string | null;
}

export class ApprovalAlreadyDecidedError extends Error {
  constructor() {
    super("This approval has already been decided.");
    this.name = "ApprovalAlreadyDecidedError";
  }
}

// Thrown when an insert loses the race against ticket_approvals_one_pending_
// per_thread — another run already suspended this thread on a pending
// approval. The constraint is what actually prevents two live proposals for
// the same thread; this just gives the loser a typed error instead of a raw
// driver exception.
export class ApprovalAlreadyPendingError extends Error {
  constructor(graphThreadId: string) {
    super(
      `Thread "${graphThreadId}" already has a pending approval — refusing to create a second one.`
    );
    this.name = "ApprovalAlreadyPendingError";
  }
}

const PENDING_PER_THREAD_CONSTRAINT = "ticket_approvals_one_pending_per_thread";

// postgres.js flattens the driver error's fields (including `code` and
// `constraint_name`) directly onto the object it hands back as `.cause` —
// see node_modules/postgres/src/errors.js. Checking the constraint name
// rather than sniffing the message keeps this from ever matching the wrong
// unique index by accident.
function isPendingPerThreadViolation(error: unknown): boolean {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  if (!(cause instanceof Error)) return false;

  const pgError = cause as { code?: string; constraint_name?: string };
  return pgError.code === "23505" && pgError.constraint_name === PENDING_PER_THREAD_CONSTRAINT;
}

const APPROVE: Verdict = {
  decision: "approve",
  editedBody: null,
  feedback: null,
  overrideAction: null,
};

/**
 * The single place autonomy is decided. Every gate in the graph calls this,
 * so the answer to "will this be reviewed?" has exactly one source.
 *
 * Returns `autoApproved: null` when the run must suspend.
 */
export async function createApproval(input: {
  ticketId: string;
  graphThreadId: string;
  kind: ApprovalKind;
  proposal: unknown;
  confidence: number;
}): Promise<{ id: string; autoApproved: Verdict | null }> {
  const settings = await getWorkflowSettings();
  const autoApprove =
    !settings.requireApproval && input.confidence >= settings.autoSendMinConfidence;

  let row: { id: string };
  try {
    [row] = await db
      .insert(ticketApprovals)
      .values({
        ticketId: input.ticketId,
        graphThreadId: input.graphThreadId,
        kind: input.kind,
        proposal: input.proposal as Record<string, unknown>,
        confidence: String(input.confidence),
        status: autoApprove ? "decided" : "pending",
        decision: autoApprove ? "approve" : null,
        decidedAt: autoApprove ? new Date() : null,
        // Recorded even though no human saw it: without this there is no answer
        // to "why did that email go out?".
        autoApprovedReason: autoApprove ? "approval_disabled" : null,
      })
      .returning({ id: ticketApprovals.id });
  } catch (error) {
    if (isPendingPerThreadViolation(error)) {
      throw new ApprovalAlreadyPendingError(input.graphThreadId);
    }
    throw error;
  }

  if (autoApprove) {
    return { id: row.id, autoApproved: APPROVE };
  }

  await db.update(tickets).set({ status: "pending_review" }).where(eq(tickets.id, input.ticketId));
  return { id: row.id, autoApproved: null };
}

export async function getPendingApproval(ticketId: string): Promise<PendingApproval | null> {
  const [row] = await db
    .select()
    .from(ticketApprovals)
    .where(and(eq(ticketApprovals.ticketId, ticketId), eq(ticketApprovals.status, "pending")))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    ticketId: row.ticketId,
    graphThreadId: row.graphThreadId,
    kind: row.kind,
    proposal: row.proposal,
    confidence: Number(row.confidence),
    createdAt: row.createdAt,
  };
}

export async function getApprovalForTicket(
  ticketId: string,
  approvalId: string
): Promise<ApprovalForTicket | null> {
  const [row] = await db
    .select({
      id: ticketApprovals.id,
      status: ticketApprovals.status,
      decision: ticketApprovals.decision,
      editedBody: ticketApprovals.editedBody,
      feedback: ticketApprovals.feedback,
      overrideAction: ticketApprovals.overrideAction,
    })
    .from(ticketApprovals)
    .where(and(eq(ticketApprovals.id, approvalId), eq(ticketApprovals.ticketId, ticketId)))
    .limit(1);

  return row ?? null;
}

export async function decideApproval(
  approvalId: string,
  verdict: Verdict,
  decidedByUserId: string
): Promise<void> {
  // Conditioning the UPDATE on status = 'pending' makes the double-decide
  // check atomic: two reviewers clicking at once, only one row is affected.
  const updated = await db
    .update(ticketApprovals)
    .set({
      status: "decided",
      decision: verdict.decision,
      editedBody: verdict.editedBody,
      feedback: verdict.feedback,
      overrideAction: verdict.overrideAction,
      decidedByUserId,
      decidedAt: new Date(),
    })
    .where(and(eq(ticketApprovals.id, approvalId), eq(ticketApprovals.status, "pending")))
    .returning({ id: ticketApprovals.id });

  if (updated.length === 0) {
    throw new ApprovalAlreadyDecidedError();
  }
}

/**
 * A pending proposal answers the thread as it stood when the run suspended.
 * Once the customer writes again it is stale, so it is retired rather than
 * offered to a reviewer who would be approving an answer to an old message.
 */
export async function supersedePendingApprovals(ticketId: string): Promise<void> {
  await db
    .update(ticketApprovals)
    .set({ status: "superseded" })
    .where(and(eq(ticketApprovals.ticketId, ticketId), eq(ticketApprovals.status, "pending")));
}
