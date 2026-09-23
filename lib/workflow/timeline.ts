import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, kbChunks, kbEntries, llmLogs, ticketApprovals } from "@/lib/db/schema";

export interface TimelineEntry {
  at: Date;
  kind: "agent" | "approval";
  label: string;
  detail: string;
}

export interface ApprovalCitation {
  chunkId: string;
  entryId: string;
  title: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function citedChunkIds(proposal: unknown): string[] {
  if (!proposal || typeof proposal !== "object" || !("citedChunkIds" in proposal)) return [];
  const ids = (proposal as { citedChunkIds?: unknown }).citedChunkIds;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)))];
}

export async function getApprovalCitations(proposal: unknown): Promise<ApprovalCitation[]> {
  const ids = citedChunkIds(proposal);
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      chunkId: kbChunks.id,
      entryId: kbEntries.id,
      title: kbEntries.title,
    })
    .from(kbChunks)
    .innerJoin(kbEntries, eq(kbEntries.id, kbChunks.kbEntryId))
    .where(inArray(kbChunks.id, ids));

  const byId = new Map(rows.map((row) => [row.chunkId, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export async function getRunTimeline(ticketId: string): Promise<TimelineEntry[]> {
  const [calls, approvals] = await Promise.all([
    db
      .select({
        at: llmLogs.createdAt,
        name: agents.name,
        response: llmLogs.response,
        model: llmLogs.model,
      })
      .from(llmLogs)
      .leftJoin(agents, eq(agents.id, llmLogs.agentId))
      .where(eq(llmLogs.ticketId, ticketId))
      .orderBy(asc(llmLogs.createdAt)),
    db
      .select()
      .from(ticketApprovals)
      .where(eq(ticketApprovals.ticketId, ticketId))
      .orderBy(asc(ticketApprovals.createdAt)),
  ]);

  const entries: TimelineEntry[] = [
    ...calls.map((call) => ({
      at: call.at,
      kind: "agent" as const,
      label: call.name ?? "Agent",
      detail: `${call.model}: ${call.response}`,
    })),
    ...approvals.map((approval) => ({
      at: approval.decidedAt ?? approval.createdAt,
      kind: "approval" as const,
      label: approval.kind,
      detail:
        approval.status === "pending"
          ? "Waiting for a reviewer"
          : approval.autoApprovedReason
            ? `Auto-approved (${approval.autoApprovedReason})`
            : approval.decision
              ? `${approval.decision} by a reviewer`
              : "Superseded by a newer customer reply",
    })),
  ];

  return entries.sort((left, right) => left.at.getTime() - right.at.getTime());
}
