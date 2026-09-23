import type { ChatClient } from "@/lib/ai/chat";
import { runAgent } from "../run-agent";
import type { RouteResult, TriageResult, WorkflowState } from "../state";
import { formatThread, newestInbound } from "./context";

// Azure's strict json_schema mode requires additionalProperties: false and
// every property present in `required`.
const TRIAGE_SCHEMA = {
  type: "object",
  properties: {
    isGenuine: { type: "boolean" },
    reason: { type: "string" },
    category: { type: "string", enum: ["billing", "technical", "general", "other"] },
    priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
    confidence: { type: "number" },
  },
  required: ["isGenuine", "reason", "category", "priority", "confidence"],
  additionalProperties: false,
};

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["answer", "need_info", "escalate"] },
    reason: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["action", "reason", "confidence"],
  additionalProperties: false,
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string" },
    citedChunkIds: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  required: ["body", "citedChunkIds", "confidence"],
  additionalProperties: false,
};

const QUESTION_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["body", "confidence"],
  additionalProperties: false,
};

function formatKbHits(state: WorkflowState): string {
  if (state.kbHits.length === 0) {
    // Said explicitly rather than omitted: an absent section reads as an
    // oversight, and the router must be able to tell "nothing matched" from
    // "we did not look".
    return "No knowledge base passages matched this ticket.";
  }

  return state.kbHits
    .map((hit, index) => `[${index + 1}] id=${hit.chunkId} title=${hit.entryTitle}\n${hit.text}`)
    .join("\n\n");
}

function feedbackSection(feedback: string | null): string {
  if (!feedback) return "";
  return `\n\nA reviewer rejected your previous attempt with this note. Address it:\n${feedback}`;
}

export async function triageNode(
  state: WorkflowState,
  chat: ChatClient
): Promise<Partial<WorkflowState>> {
  const latest = newestInbound(state.thread);

  const triage = await runAgent<TriageResult>({
    key: "triage",
    userPrompt: `Subject: ${state.subject}\nFrom: ${state.requesterEmail}\n\n${latest?.body ?? ""}`,
    schemaName: "triage",
    schema: TRIAGE_SCHEMA,
    ticketId: state.ticketId,
    graphThreadId: state.graphThreadId,
    chat,
  });

  return { triage };
}

export async function routeNode(
  state: WorkflowState,
  chat: ChatClient
): Promise<Partial<WorkflowState>> {
  const route = await runAgent<RouteResult>({
    key: "router",
    userPrompt: [
      `Subject: ${state.subject}`,
      "",
      "Conversation so far:",
      formatThread(state.thread),
      "",
      "Knowledge base passages:",
      formatKbHits(state),
    ].join("\n"),
    schemaName: "router",
    schema: ROUTE_SCHEMA,
    ticketId: state.ticketId,
    graphThreadId: state.graphThreadId,
    chat,
  });

  return { route };
}

export async function drafterNode(
  state: WorkflowState,
  chat: ChatClient
): Promise<Partial<WorkflowState>> {
  const result = await runAgent<{ body: string; citedChunkIds: string[]; confidence: number }>({
    key: "drafter",
    userPrompt: [
      `Subject: ${state.subject}`,
      "",
      "Conversation so far:",
      formatThread(state.thread),
      "",
      "Knowledge base passages (cite by id):",
      formatKbHits(state),
      feedbackSection(state.feedback),
      "",
      "Return exactly one JSON object matching the response schema. Put the complete customer email in body, cite only retrieved passage ids in citedChunkIds, and set confidence between 0 and 1.",
    ].join("\n"),
    schemaName: "draft",
    schema: DRAFT_SCHEMA,
    ticketId: state.ticketId,
    graphThreadId: state.graphThreadId,
    chat,
  });

  // A citation for a chunk retrieval never returned is a hallucinated source.
  // Dropping it keeps the reviewer's citation list trustworthy.
  const retrievedIds = new Set(state.kbHits.map((hit) => hit.chunkId));

  return {
    outbound: {
      kind: "answer",
      body: result.body,
      citedChunkIds: result.citedChunkIds.filter((id) => retrievedIds.has(id)),
      confidence: result.confidence,
    },
    feedback: null,
    draftAttempts: state.draftAttempts + 1,
  };
}

export async function infoRequesterNode(
  state: WorkflowState,
  chat: ChatClient
): Promise<Partial<WorkflowState>> {
  const result = await runAgent<{ body: string; confidence: number }>({
    key: "info_requester",
    userPrompt: [
      `Subject: ${state.subject}`,
      "",
      "Conversation so far:",
      formatThread(state.thread),
      "",
      `The router decided more information is needed because: ${state.route?.reason ?? "unknown"}`,
      feedbackSection(state.feedback),
      "",
      "Return exactly one JSON object matching the response schema. Put the complete customer question in body and set confidence between 0 and 1.",
    ].join("\n"),
    schemaName: "question",
    schema: QUESTION_SCHEMA,
    ticketId: state.ticketId,
    graphThreadId: state.graphThreadId,
    chat,
  });

  return {
    outbound: {
      kind: "question",
      body: result.body,
      citedChunkIds: [],
      confidence: result.confidence,
    },
    feedback: null,
    infoRounds: state.infoRounds + 1,
  };
}
