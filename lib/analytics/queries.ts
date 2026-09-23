import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agents,
  llmLogs,
  ticketApprovals,
  ticketMessages,
  tickets,
} from "@/lib/db/schema";

export type AnalyticsTicketStatus = (typeof tickets.status.enumValues)[number];
export type AnalyticsApprovalStatus = (typeof ticketApprovals.status.enumValues)[number];

export type AnalyticsSnapshot = {
  ticketTotals: {
    total: number;
    open: number;
    pendingReview: number;
    resolved: number;
    triagedOut: number;
  };
  messageTotals: {
    total: number;
    inbound: number;
    outbound: number;
  };
  approvalTotals: {
    total: number;
    pending: number;
    decided: number;
    approved: number;
    rejected: number;
    superseded: number;
    approvalRate: number | null;
  };
  ticketStatuses: Array<{ status: AnalyticsTicketStatus; count: number }>;
  messageDirections: Array<{
    direction: (typeof ticketMessages.direction.enumValues)[number];
    count: number;
  }>;
  workflowAgents: Array<{
    id: string | null;
    name: string;
    calls: number;
    lastRunAt: Date | null;
  }>;
  recentActivity: Array<{
    id: string;
    kind: "workflow" | "approval";
    label: string;
    detail: string;
    at: Date;
  }>;
};

function sumCounts<T extends { count: number }>(rows: T[]): number {
  return rows.reduce((total, row) => total + Number(row.count), 0);
}

function approvalLabel(kind: string): string {
  return kind
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// PostgreSQL timestamp expressions such as coalesce/max may be returned as
// ISO strings by the driver even when their Drizzle type is Date. Normalize at
// the boundary before the values reach date formatters or sort callbacks.
function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function getAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const [
    ticketStatusRows,
    messageDirectionRows,
    approvalRows,
    workflowAgentRows,
    recentWorkflowRows,
    recentApprovalRows,
  ] = await Promise.all([
    db
      .select({
        status: tickets.status,
        count: sql<number>`count(*)::int`,
      })
      .from(tickets)
      .groupBy(tickets.status)
      .orderBy(asc(tickets.status)),
    db
      .select({
        direction: ticketMessages.direction,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketMessages)
      .groupBy(ticketMessages.direction)
      .orderBy(asc(ticketMessages.direction)),
    db
      .select({
        status: ticketApprovals.status,
        decision: ticketApprovals.decision,
        autoApproved: sql<boolean>`${ticketApprovals.autoApprovedReason} is not null`,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketApprovals)
      .groupBy(
        ticketApprovals.status,
        ticketApprovals.decision,
        sql`${ticketApprovals.autoApprovedReason} is not null`
      ),
    db
      .select({
        id: agents.id,
        name: agents.name,
        calls: sql<number>`count(${llmLogs.id})::int`,
        lastRunAt: sql<Date | null>`max(${llmLogs.createdAt})`,
      })
      .from(llmLogs)
      .leftJoin(agents, eq(agents.id, llmLogs.agentId))
      .groupBy(agents.id, agents.name)
      .orderBy(desc(sql`count(${llmLogs.id})`)),
    db
      .select({
        id: llmLogs.id,
        label: sql<string>`coalesce(${agents.name}, 'Workflow agent')`,
        model: llmLogs.model,
        at: llmLogs.createdAt,
      })
      .from(llmLogs)
      .leftJoin(agents, eq(agents.id, llmLogs.agentId))
      .where(isNotNull(llmLogs.ticketId))
      .orderBy(desc(llmLogs.createdAt))
      .limit(6),
    db
      .select({
        id: ticketApprovals.id,
        kind: ticketApprovals.kind,
        status: ticketApprovals.status,
        decision: ticketApprovals.decision,
        autoApproved: sql<boolean>`${ticketApprovals.autoApprovedReason} is not null`,
        at: sql<Date>`coalesce(${ticketApprovals.decidedAt}, ${ticketApprovals.createdAt})`,
      })
      .from(ticketApprovals)
      .orderBy(desc(sql`coalesce(${ticketApprovals.decidedAt}, ${ticketApprovals.createdAt})`))
      .limit(6),
  ]);

  const ticketCountByStatus = new Map(
    ticketStatusRows.map((row) => [row.status, Number(row.count)])
  );
  const messageCountByDirection = new Map(
    messageDirectionRows.map((row) => [row.direction, Number(row.count)])
  );

  const approvals = approvalRows.map((row) => ({ ...row, count: Number(row.count) }));
  const pendingApprovals = sumCounts(approvals.filter((row) => row.status === "pending"));
  const decidedApprovals = sumCounts(approvals.filter((row) => row.status === "decided"));
  const approvedApprovals = sumCounts(
    approvals.filter(
      (row) =>
        row.status === "decided" &&
        (row.autoApproved || row.decision === "approve" || row.decision === "override")
    )
  );
  const rejectedApprovals = sumCounts(
    approvals.filter((row) => row.status === "decided" && row.decision === "reject_feedback")
  );
  const supersededApprovals = sumCounts(approvals.filter((row) => row.status === "superseded"));
  const totalApprovals = sumCounts(approvals);

  const recentActivity = [
    ...recentWorkflowRows.map((row) => ({
      id: `workflow-${row.id}`,
      kind: "workflow" as const,
      label: row.label,
      detail: `Ran ${row.model}`,
      at: asDate(row.at),
    })),
    ...recentApprovalRows.map((row) => ({
      id: `approval-${row.id}`,
      kind: "approval" as const,
      label: approvalLabel(row.kind),
      detail: row.status === "pending"
        ? "Waiting for review"
        : row.autoApproved
          ? "Auto-approved"
          : row.decision
            ? row.decision.replaceAll("_", " ")
            : row.status,
      at: asDate(row.at),
    })),
  ]
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .slice(0, 8);

  const totalTickets = sumCounts(ticketStatusRows);
  const totalMessages = sumCounts(messageDirectionRows);

  return {
    ticketTotals: {
      total: totalTickets,
      open: totalTickets - (ticketCountByStatus.get("resolved") ?? 0) - (ticketCountByStatus.get("triaged_out") ?? 0),
      pendingReview: ticketCountByStatus.get("pending_review") ?? 0,
      resolved: ticketCountByStatus.get("resolved") ?? 0,
      triagedOut: ticketCountByStatus.get("triaged_out") ?? 0,
    },
    messageTotals: {
      total: totalMessages,
      inbound: messageCountByDirection.get("inbound") ?? 0,
      outbound: messageCountByDirection.get("outbound") ?? 0,
    },
    approvalTotals: {
      total: totalApprovals,
      pending: pendingApprovals,
      decided: decidedApprovals,
      approved: approvedApprovals,
      rejected: rejectedApprovals,
      superseded: supersededApprovals,
      approvalRate: decidedApprovals > 0 ? Math.round((approvedApprovals / decidedApprovals) * 100) : null,
    },
    ticketStatuses: ticketStatusRows.map((row) => ({ status: row.status, count: Number(row.count) })),
    messageDirections: messageDirectionRows.map((row) => ({
      direction: row.direction,
      count: Number(row.count),
    })),
    workflowAgents: workflowAgentRows.map((row) => ({
      id: row.id,
      name: row.name ?? "Workflow agent",
      calls: Number(row.calls),
      lastRunAt: row.lastRunAt ? asDate(row.lastRunAt) : null,
    })),
    recentActivity,
  };
}
