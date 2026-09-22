import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketApprovals, tickets, workflowSettings } from "@/lib/db/schema";
import { createTestTicket } from "@/lib/test-helpers/tickets";
import { createTestUser } from "@/lib/test-helpers/users";
import {
  ApprovalAlreadyDecidedError,
  ApprovalAlreadyPendingError,
  createApproval,
  decideApproval,
  getPendingApproval,
  supersedePendingApprovals,
} from "./approvals";

describe("approval gate", () => {
  let ticketId: string;
  let userId: string;

  beforeEach(async () => {
    await db.delete(ticketApprovals);
    await db
      .update(workflowSettings)
      .set({ isEnabled: true, requireApproval: true, autoSendMinConfidence: "0.8" });
    ticketId = await createTestTicket({});
    userId = await createTestUser();
  });

  const proposal = { draftId: "draft-1" };

  it("pauses when approval is required, whatever the confidence", async () => {
    const result = await createApproval({
      ticketId,
      graphThreadId: "t1",
      kind: "send_email",
      proposal,
      confidence: 0.99,
    });

    expect(result.autoApproved).toBeNull();

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(ticket.status).toBe("pending_review");
  });

  it("auto-approves above the floor when approval is off", async () => {
    await db.update(workflowSettings).set({ requireApproval: false });

    const result = await createApproval({
      ticketId,
      graphThreadId: "t1",
      kind: "send_email",
      proposal,
      confidence: 0.9,
    });

    expect(result.autoApproved?.decision).toBe("approve");

    const [row] = await db.select().from(ticketApprovals);
    expect(row.status).toBe("decided");
    expect(row.autoApprovedReason).toBe("approval_disabled");
    expect(row.decidedByUserId).toBeNull();
  });

  it("still pauses below the floor when approval is off", async () => {
    await db.update(workflowSettings).set({ requireApproval: false });

    const result = await createApproval({
      ticketId,
      graphThreadId: "t1",
      kind: "send_email",
      proposal,
      confidence: 0.5,
    });

    expect(result.autoApproved).toBeNull();

    const [row] = await db.select().from(ticketApprovals);
    expect(row.status).toBe("pending");
  });

  it("records an auto-approval row even though no human saw it", async () => {
    await db.update(workflowSettings).set({ requireApproval: false });

    await createApproval({
      ticketId,
      graphThreadId: "t1",
      kind: "triage_out",
      proposal: { reason: "spam" },
      confidence: 1,
    });

    expect(await db.select().from(ticketApprovals)).toHaveLength(1);
  });

  it("returns the pending approval for a ticket", async () => {
    await createApproval({ ticketId, graphThreadId: "t1", kind: "escalate", proposal: { reason: "x" }, confidence: 0.4 });

    const pending = await getPendingApproval(ticketId);
    expect(pending?.kind).toBe("escalate");
    expect(pending?.confidence).toBe(0.4);
  });

  it("records a reviewer's edit", async () => {
    const { id } = await createApproval({ ticketId, graphThreadId: "t1", kind: "send_email", proposal, confidence: 0.4 });

    await decideApproval(
      id,
      { decision: "edit", editedBody: "A better reply.", feedback: null, overrideAction: null },
      userId
    );

    const [row] = await db.select().from(ticketApprovals).where(eq(ticketApprovals.id, id));
    expect(row.status).toBe("decided");
    expect(row.decision).toBe("edit");
    expect(row.editedBody).toBe("A better reply.");
    expect(row.decidedByUserId).toBe(userId);
    expect(row.decidedAt).not.toBeNull();
  });

  it("refuses to decide the same approval twice", async () => {
    const { id } = await createApproval({ ticketId, graphThreadId: "t1", kind: "send_email", proposal, confidence: 0.4 });
    const verdict = { decision: "approve" as const, editedBody: null, feedback: null, overrideAction: null };

    await decideApproval(id, verdict, userId);

    await expect(decideApproval(id, verdict, userId)).rejects.toBeInstanceOf(
      ApprovalAlreadyDecidedError
    );
  });

  it("a double-decide never overwrites the first verdict", async () => {
    const { id } = await createApproval({ ticketId, graphThreadId: "t1", kind: "send_email", proposal, confidence: 0.4 });

    await decideApproval(
      id,
      { decision: "edit", editedBody: "First reviewer's edit.", feedback: null, overrideAction: null },
      userId
    );

    const secondReviewerId = await createTestUser();
    await expect(
      decideApproval(
        id,
        { decision: "approve", editedBody: null, feedback: null, overrideAction: null },
        secondReviewerId
      )
    ).rejects.toBeInstanceOf(ApprovalAlreadyDecidedError);

    // The second, rejected verdict must not have touched the row a double
    // click already decided — a double-click that quietly overwrote the
    // first reviewer's edit would be worse than the error it now throws.
    const [row] = await db.select().from(ticketApprovals).where(eq(ticketApprovals.id, id));
    expect(row.decision).toBe("edit");
    expect(row.editedBody).toBe("First reviewer's edit.");
    expect(row.decidedByUserId).toBe(userId);
  });

  it("supersedes a pending approval when the customer replies", async () => {
    const { id } = await createApproval({ ticketId, graphThreadId: "t1", kind: "send_email", proposal, confidence: 0.4 });

    await supersedePendingApprovals(ticketId);

    const [row] = await db.select().from(ticketApprovals).where(eq(ticketApprovals.id, id));
    expect(row.status).toBe("superseded");
    expect(await getPendingApproval(ticketId)).toBeNull();
  });

  it("refuses a second approval that races an existing pending one on the same thread", async () => {
    await createApproval({ ticketId, graphThreadId: "race-thread", kind: "send_email", proposal, confidence: 0.4 });

    // A second run resolving the same suspended thread — e.g. a retried job —
    // must lose deliberately, not produce a second live proposal alongside
    // the one a reviewer is already looking at.
    await expect(
      createApproval({
        ticketId,
        graphThreadId: "race-thread",
        kind: "close",
        proposal: { sentMessageId: "m-1" },
        confidence: 0.4,
      })
    ).rejects.toBeInstanceOf(ApprovalAlreadyPendingError);

    const rows = await db
      .select()
      .from(ticketApprovals)
      .where(eq(ticketApprovals.graphThreadId, "race-thread"));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("send_email");
  });
});
