import { Command } from "@langchain/langgraph";
import { and, desc, eq } from "drizzle-orm";
import { azureChatClient } from "@/lib/ai/chat";
import { db } from "@/lib/db/client";
import { ticketApprovals, ticketMessages, ticketSendAttempts } from "@/lib/db/schema";
import { getMailTransport } from "@/lib/mail/transports";
import { compileWorkflowGraph } from "./graph";
import { getWorkflowSettings } from "./settings";

function threadIdFor(ticketId: string, inboundMessageId: string | undefined): string {
  return inboundMessageId
    ? `ticket:${ticketId}:inbound:${inboundMessageId}`
    : `ticket:${ticketId}`;
}

async function graph() {
  return compileWorkflowGraph({
    chat: azureChatClient,
    transport: await getMailTransport(),
  });
}

export async function startWorkflowRun(ticketId: string): Promise<void> {
  const settings = await getWorkflowSettings();
  if (!settings.isEnabled) {
    console.log(`Workflow disabled - skipping ticket ${ticketId}.`);
    return;
  }

  const [latestInbound] = await db
    .select({ id: ticketMessages.id })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "inbound")))
    .orderBy(desc(ticketMessages.sentAt), desc(ticketMessages.id))
    .limit(1);
  const thread = threadIdFor(ticketId, latestInbound?.id);
  // pg-boss delivers at least once, and duplicate queued runs must not create
  // multiple approvals for the same inbound email. A new inbound message gets
  // a different checkpoint and can still start a fresh workflow.
  const [existingApproval] = await db
    .select({ id: ticketApprovals.id })
    .from(ticketApprovals)
    .where(eq(ticketApprovals.graphThreadId, thread))
    .limit(1);
  if (existingApproval) {
    console.log(`Workflow already started for ${thread}; skipping duplicate delivery.`);
    return;
  }

  const compiled = await graph();
  await compiled.invoke(
    { ticketId, graphThreadId: thread },
    { configurable: { thread_id: thread } }
  );
}

export async function resumeWorkflowRun(approvalId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // pg-boss is at-least-once. Holding the row lock across the graph resume
    // means two deliveries of the same approval cannot invoke the graph
    // concurrently; the second delivery sees the consumed status after the
    // first transaction commits.
    const [approval] = await tx
      .select()
      .from(ticketApprovals)
      .where(eq(ticketApprovals.id, approvalId))
      .for("update")
      .limit(1);

    if (!approval || approval.status !== "decided" || !approval.decision) {
      return;
    }

    // A send claim is written before the transport is called. If a worker
    // died after that point, invoking the graph again would replay the same
    // approval even though the transport may already have accepted the mail.
    // Consume the approval instead; a fresh approval is required for any
    // deliberate retry.
    const [sendAttempt] = await tx
      .select({ id: ticketSendAttempts.id })
      .from(ticketSendAttempts)
      .where(eq(ticketSendAttempts.approvalId, approval.id))
      .limit(1);
    if (sendAttempt) {
      await tx
        .update(ticketApprovals)
        .set({ status: "superseded" })
        .where(
          and(eq(ticketApprovals.id, approval.id), eq(ticketApprovals.status, "decided"))
        );
      return;
    }

    const compiled = await graph();
    await compiled.invoke(
      new Command({
        resume: {
          decision: approval.decision,
          editedBody: approval.editedBody,
          feedback: approval.feedback,
          overrideAction: approval.overrideAction,
        },
      }),
      { configurable: { thread_id: approval.graphThreadId } }
    );

    await tx
      .update(ticketApprovals)
      .set({ status: "superseded" })
      .where(
        and(eq(ticketApprovals.id, approval.id), eq(ticketApprovals.status, "decided"))
      );
  });
}
