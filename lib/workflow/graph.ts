import { END, START, StateGraph } from "@langchain/langgraph";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import type { ChatClient } from "@/lib/ai/chat";
import type { MailTransport } from "@/lib/mail/transport";
import { drafterNode, infoRequesterNode, routeNode, triageNode } from "./nodes/agents";
import { loadContextNode, retrieveKbNode } from "./nodes/context";
import { awaitApproval, beginApproval } from "./nodes/gate";
import { TicketMailboxNotFoundError, sendNode } from "./nodes/send";
import {
  MAX_DRAFT_ATTEMPTS,
  MAX_INFO_ROUNDS,
  WorkflowStateAnnotation,
  type GateVerdict,
  type WorkflowState,
} from "./state";

export interface WorkflowDeps {
  chat: ChatClient;
  transport: MailTransport;
}

async function setTicketStatus(
  ticketId: string,
  status: "escalated" | "resolved" | "waiting_on_customer" | "triaged_out"
): Promise<void> {
  await db.update(tickets).set({ status }).where(eq(tickets.id, ticketId));
}

// Reads the verdict awaitApproval just resolved. awaitApproval always sets
// it on the way out (either straight through for an auto-approval, or from
// interrupt()'s resume value) — a missing verdict here would mean this ran
// before awaitApproval, which is a wiring bug, not a state this function
// should quietly tolerate.
function requireVerdict(patch: Partial<WorkflowState>): GateVerdict {
  if (!patch.verdict) {
    throw new Error("awaitApproval returned no verdict.");
  }
  return patch.verdict;
}

export function buildWorkflowGraph(deps: WorkflowDeps) {
  const graph = new StateGraph(WorkflowStateAnnotation)
    .addNode("load_context", loadContextNode)
    // Named run_triage / run_route rather than triage / route: LangGraph
    // refuses a node name that collides with a state channel name, and
    // "triage" and "route" are both fields on WorkflowState.
    .addNode("run_triage", (state: WorkflowState) => triageNode(state, deps.chat))
    .addNode("retrieve_kb", retrieveKbNode)
    .addNode("run_route", (state: WorkflowState) => routeNode(state, deps.chat))
    .addNode("drafter", (state: WorkflowState) => drafterNode(state, deps.chat))
    .addNode("info_requester", (state: WorkflowState) => infoRequesterNode(state, deps.chat))

    // Triage found junk. A human confirms before a real customer's email is
    // buried, unless autonomy is on and confidence is high.
    //
    // Each gate below is two graph nodes, not one: `<gate>_begin` calls
    // beginApproval (creates the approval row, never interrupts) and
    // `<gate>_await` calls awaitApproval (which may suspend). LangGraph
    // checkpoints between nodes, not mid-node, and only the node that calls
    // interrupt() re-executes when a run resumes. Collapsing these back into
    // one node would make beginApproval run again on every resume, minting a
    // second pending approval row after the first was already decided — the
    // exact defect lib/workflow/nodes/gate.ts's split exists to prevent. See
    // that file's comments for the full explanation.
    .addNode("gate_triage_out_begin", (state: WorkflowState) =>
      beginApproval({
        state,
        kind: "triage_out",
        proposal: {
          reason: state.triage?.reason,
          category: state.triage?.category,
          priority: state.triage?.priority,
        },
        confidence: state.triage?.confidence ?? 0,
      })
    )
    .addNode("gate_triage_out_await", async (state: WorkflowState) => {
      const patch = await awaitApproval(state);
      const verdict = requireVerdict(patch);

      if (verdict.decision === "override") {
        // The reviewer says this is genuine after all.
        return { ...patch, triage: state.triage ? { ...state.triage, isGenuine: true } : null };
      }

      await setTicketStatus(state.ticketId, "triaged_out");
      return { ...patch, endReason: state.triage?.reason ?? "triaged out" };
    })

    .addNode("gate_escalate_begin", (state: WorkflowState) =>
      beginApproval({
        state,
        kind: "escalate",
        proposal: { reason: state.endReason ?? state.route?.reason ?? "needs a person" },
        confidence: state.route?.confidence ?? 0,
      })
    )
    .addNode("gate_escalate_await", async (state: WorkflowState) => {
      const patch = await awaitApproval(state);
      const verdict = requireVerdict(patch);

      if (verdict.decision === "override") {
        // Answer it anyway. Attempts reset so the override is not immediately
        // undone by a retry cap the reviewer never saw.
        return {
          ...patch,
          route: { action: "answer", reason: "reviewer override", confidence: 1 },
          draftAttempts: 0,
        };
      }

      await setTicketStatus(state.ticketId, "escalated");
      return { ...patch, endReason: state.endReason ?? state.route?.reason ?? "escalated" };
    })

    .addNode("gate_send_begin", (state: WorkflowState) =>
      beginApproval({
        state,
        kind: "send_email",
        proposal: {
          kind: state.outbound?.kind,
          body: state.outbound?.body,
          citedChunkIds: state.outbound?.citedChunkIds ?? [],
        },
        confidence: state.outbound?.confidence ?? 0,
      })
    )
    .addNode("gate_send_await", async (state: WorkflowState) => {
      const patch = await awaitApproval(state);
      const verdict = requireVerdict(patch);

      if (verdict.decision === "take_over") {
        await setTicketStatus(state.ticketId, "escalated");
        return { ...patch, endReason: "a reviewer took the ticket over", outbound: null };
      }

      if (verdict.decision === "reject_feedback") {
        return { ...patch, feedback: verdict.feedback, outbound: null };
      }

      try {
        await sendNode(state, verdict, deps.transport);
      } catch (error) {
        if (error instanceof TicketMailboxNotFoundError) {
          // The transport already delivered the reply by the time this
          // throws — only the bookkeeping failed. Letting that crash the
          // run would leave the ticket stuck with no signal anyone would
          // see; escalating puts it in front of a human instead, and
          // clearing outbound (with feedback left null) routes this to END
          // below rather than into a retry loop or a close gate for a
          // draft nothing further should touch.
          await setTicketStatus(state.ticketId, "escalated");
          return { ...patch, endReason: `sent, but ${error.message}`, outbound: null };
        }
        throw error;
      }

      if (state.outbound?.kind === "question") {
        await setTicketStatus(state.ticketId, "waiting_on_customer");
        return { ...patch, endReason: "waiting on the customer" };
      }
      return patch;
    })

    .addNode("gate_close_begin", (state: WorkflowState) =>
      beginApproval({
        state,
        kind: "close",
        proposal: { body: state.outbound?.body },
        confidence: state.outbound?.confidence ?? 0,
      })
    )
    .addNode("gate_close_await", async (state: WorkflowState) => {
      const patch = await awaitApproval(state);
      const verdict = requireVerdict(patch);

      if (verdict.decision === "approve" || verdict.decision === "edit") {
        await setTicketStatus(state.ticketId, "resolved");
        return { ...patch, endReason: "resolved" };
      }

      // Override, rejection or take-over all mean "not resolved" — the answer
      // is already sent, so the only thing left is where the ticket rests.
      await setTicketStatus(state.ticketId, "waiting_on_customer");
      return { ...patch, endReason: "not resolved by the reviewer" };
    });

  graph
    .addEdge(START, "load_context")
    .addEdge("load_context", "run_triage")
    .addConditionalEdges("run_triage", (state: WorkflowState) =>
      state.triage?.isGenuine ? "retrieve_kb" : "gate_triage_out_begin"
    )
    .addEdge("gate_triage_out_begin", "gate_triage_out_await")
    // An overridden triage_out continues; an approved one ended the run.
    .addConditionalEdges("gate_triage_out_await", (state: WorkflowState) =>
      state.triage?.isGenuine ? "retrieve_kb" : END
    )
    .addEdge("retrieve_kb", "run_route")
    .addConditionalEdges("run_route", (state: WorkflowState) => {
      if (state.route?.action === "escalate") return "gate_escalate_begin";
      if (state.route?.action === "need_info") {
        // Checked here rather than inside the node so the cap holds even if a
        // reviewer overrides an escalation back into the loop.
        return state.infoRounds >= MAX_INFO_ROUNDS ? "gate_escalate_begin" : "info_requester";
      }
      return "drafter";
    })
    .addEdge("gate_escalate_begin", "gate_escalate_await")
    // Branches on the reviewer's decision, not on state.route.action: this
    // gate is reached three different ways (the router choosing "escalate"
    // directly, the info-round cap, and the draft-attempt cap below), and in
    // the draft-attempt case route.action is already "answer" going in —
    // indistinguishable from what an override sets it to. Only an actual
    // override should retry the draft; everything else ends the run here.
    .addConditionalEdges("gate_escalate_await", (state: WorkflowState) =>
      state.verdict?.decision === "override" ? "drafter" : END
    )
    .addEdge("drafter", "gate_send_begin")
    .addEdge("info_requester", "gate_send_begin")
    .addEdge("gate_send_begin", "gate_send_await")
    .addConditionalEdges("gate_send_await", (state: WorkflowState) => {
      // A rejection cleared the draft and set feedback; retry until the cap.
      if (state.outbound === null && state.feedback !== null) {
        if (state.draftAttempts >= MAX_DRAFT_ATTEMPTS) return "gate_escalate_begin";
        return state.route?.action === "need_info" ? "info_requester" : "drafter";
      }
      if (state.outbound === null) return END; // take_over, or an unrecorded-but-sent reply
      return state.outbound.kind === "question" ? END : "gate_close_begin";
    })
    .addEdge("gate_close_begin", "gate_close_await")
    .addEdge("gate_close_await", END);

  return graph;
}

export async function compileWorkflowGraph(deps: WorkflowDeps) {
  const { getCheckpointer } = await import("./checkpointer");
  return buildWorkflowGraph(deps).compile({ checkpointer: await getCheckpointer() });
}
