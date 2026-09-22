import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { enqueue } from "@/lib/jobs/boss";
import { QUEUES } from "@/lib/jobs/queues";
import {
  ApprovalAlreadyDecidedError,
  decideApproval,
  getApprovalForTicket,
  type ApprovalDecision,
  type Verdict,
} from "@/lib/workflow/approvals";
import { canDecideApproval } from "@/lib/workflow/permissions";

const DECISIONS: ApprovalDecision[] = [
  "approve",
  "edit",
  "reject_feedback",
  "override",
  "take_over",
];

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string; approvalId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Sign in to decide an approval." }, { status: 401 });
  }

  const { ticketId, approvalId } = await params;
  const viewer = session.user as { id: string; role: string };
  if (!(await canDecideApproval(ticketId, viewer))) {
    return NextResponse.json(
      { error: "You can only decide approvals on tickets assigned to you." },
      { status: 403 }
    );
  }

  const approval = await getApprovalForTicket(ticketId, approvalId);
  if (!approval) {
    return NextResponse.json({ error: "Approval not found." }, { status: 404 });
  }
  if (approval.status === "superseded") {
    return NextResponse.json({ error: "This approval is no longer pending." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const { decision, editedBody, feedback, overrideAction } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof decision !== "string" || !DECISIONS.includes(decision as ApprovalDecision)) {
    return badRequest(`decision must be one of: ${DECISIONS.join(", ")}`);
  }
  if (decision === "edit" && (typeof editedBody !== "string" || editedBody.trim() === "")) {
    return badRequest("An edit requires the edited text.");
  }
  if (
    decision === "reject_feedback" &&
    (typeof feedback !== "string" || feedback.trim() === "")
  ) {
    return badRequest("A rejection requires a note saying what was wrong.");
  }
  if (
    decision === "override" &&
    (typeof overrideAction !== "string" || overrideAction.trim() === "")
  ) {
    return badRequest("An override requires an action.");
  }

  const verdict: Verdict = {
    decision: decision as ApprovalDecision,
    editedBody: typeof editedBody === "string" && editedBody.trim() !== "" ? editedBody : null,
    feedback: typeof feedback === "string" && feedback.trim() !== "" ? feedback : null,
    overrideAction:
      typeof overrideAction === "string" && overrideAction.trim() !== ""
        ? overrideAction
        : null,
  };

  if (approval.status === "decided") {
    const isSameVerdict =
      approval.decision === verdict.decision &&
      approval.editedBody === verdict.editedBody &&
      approval.feedback === verdict.feedback &&
      approval.overrideAction === verdict.overrideAction;
    if (!isSameVerdict) {
      return NextResponse.json(
        { error: "This approval has already been decided." },
        { status: 409 }
      );
    }

    await enqueue(QUEUES.workflowResume, { approvalId });
    return NextResponse.json({ ok: true });
  }

  try {
    await decideApproval(approvalId, verdict, viewer.id);
  } catch (error) {
    if (error instanceof ApprovalAlreadyDecidedError) {
      // Another request won after our read. Re-enqueueing is safe and also
      // repairs the case where its queue write failed after committing.
      await enqueue(QUEUES.workflowResume, { approvalId });
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  await enqueue(QUEUES.workflowResume, { approvalId });
  return NextResponse.json({ ok: true });
}
