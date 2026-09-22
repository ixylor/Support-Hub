import { Command } from "@langchain/langgraph";
import { eq } from "drizzle-orm";
import { azureChatClient } from "@/lib/ai/chat";
import { db } from "@/lib/db/client";
import { ticketApprovals } from "@/lib/db/schema";
import { getMailTransport } from "@/lib/mail/transports";
import { compileWorkflowGraph } from "./graph";
import { getWorkflowSettings } from "./settings";

function threadIdFor(ticketId: string): string {
  return `ticket:${ticketId}`;
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

  const thread = threadIdFor(ticketId);
  const compiled = await graph();
  await compiled.invoke(
    { ticketId, graphThreadId: thread },
    { configurable: { thread_id: thread } }
  );
}

export async function resumeWorkflowRun(approvalId: string): Promise<void> {
  const [approval] = await db
    .select()
    .from(ticketApprovals)
    .where(eq(ticketApprovals.id, approvalId))
    .limit(1);

  if (!approval || approval.status !== "decided" || !approval.decision) {
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

  // pg-boss is at-least-once. Mark this verdict consumed only after invoke
  // returns so a retry after success cannot apply it to the next interrupt;
  // a thrown invoke remains decided and can be retried safely.
  await db
    .update(ticketApprovals)
    .set({ status: "superseded" })
    .where(eq(ticketApprovals.id, approval.id));
}
