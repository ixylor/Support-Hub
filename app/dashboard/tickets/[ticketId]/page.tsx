import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import {
  getTicketWithMessages,
  listTicketAssignments,
  type TicketViewer,
} from "@/lib/tickets/queries";
import {
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from "@/lib/tickets/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPendingApproval } from "@/lib/workflow/approvals";
import { getApprovalCitations, getRunTimeline } from "@/lib/workflow/timeline";
import { ApprovalPanel, type ApprovalProposal } from "./approval-panel";
import { MessageList } from "./message-list";
import { AssignDialog } from "./assign-dialog";
import { RunTimeline } from "./run-timeline";
import { RunWorkflowButton } from "./run-workflow-button";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function approvalProposal(value: unknown): ApprovalProposal {
  if (!value || typeof value !== "object") return {};
  const proposal = value as Record<string, unknown>;
  return {
    kind:
      proposal.kind === "answer" || proposal.kind === "question" ? proposal.kind : undefined,
    body: typeof proposal.body === "string" ? proposal.body : undefined,
    reason: typeof proposal.reason === "string" ? proposal.reason : undefined,
    citedChunkIds: Array.isArray(proposal.citedChunkIds)
      ? proposal.citedChunkIds.filter((id): id is string => typeof id === "string")
      : undefined,
  };
}

export default async function TicketThreadPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const viewer: TicketViewer = {
    id: session.user.id,
    role: (session.user as { role: "agent" | "admin" }).role,
  };
  const isAdmin = viewer.role === "admin";

  const { ticketId } = await params;
  if (!UUID_PATTERN.test(ticketId)) {
    notFound();
  }

  // Scoped to the viewer, so an agent who guesses another agent's ticket id
  // gets the same 404 as one that does not exist.
  const ticket = await getTicketWithMessages(ticketId, viewer);
  if (!ticket) {
    notFound();
  }

  const [history, pendingApproval, timeline] = await Promise.all([
    listTicketAssignments(ticket.id),
    getPendingApproval(ticket.id),
    getRunTimeline(ticket.id),
  ]);
  const proposal = approvalProposal(pendingApproval?.proposal);
  const citations = pendingApproval
    ? await getApprovalCitations(pendingApproval.proposal)
    : [];

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/tickets" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to tickets
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{ticket.subject}</h1>
          <p className="text-sm text-muted-foreground">{ticket.requesterEmail}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {isAdmin ? <RunWorkflowButton ticketId={ticket.id} /> : null}
          <Badge variant={STATUS_VARIANTS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
        </div>
      </div>

      {pendingApproval ? (
        <ApprovalPanel
          ticketId={ticket.id}
          approvalId={pendingApproval.id}
          kind={pendingApproval.kind}
          confidence={pendingApproval.confidence}
          proposal={proposal}
          citations={citations}
        />
      ) : null}

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-sm font-medium">Assignment</CardTitle>
          {isAdmin ? (
            <AssignDialog
              ticketId={ticket.id}
              currentAssignee={ticket.assignee}
              currentPriority={ticket.priority}
              currentUserId={viewer.id}
            />
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Assigned to </span>
              {ticket.assignee ? (
                <span className="font-medium">{ticket.assignee.name}</span>
              ) : (
                <span className="text-muted-foreground">nobody yet</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Priority</span>
              {ticket.priority ? (
                <Badge variant={PRIORITY_VARIANTS[ticket.priority]}>
                  {PRIORITY_LABELS[ticket.priority]}
                </Badge>
              ) : (
                <span className="text-muted-foreground">none set</span>
              )}
            </div>
          </div>

          {history.length > 0 ? (
            <div className="flex flex-col gap-3 border-t pt-4">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                History
              </h2>
              <ol className="flex flex-col gap-3">
                {history.map((entry) => (
                  <li key={entry.id} className="text-sm">
                    <p>
                      <span className="font-medium">{entry.assignedBy.name}</span>{" "}
                      {entry.assignee ? (
                        <>
                          assigned this to{" "}
                          <span className="font-medium">
                            {entry.assignee.id === entry.assignedBy.id
                              ? "themselves"
                              : entry.assignee.name}
                          </span>
                        </>
                      ) : (
                        "unassigned this ticket"
                      )}
                      {entry.priority ? ` at ${PRIORITY_LABELS[entry.priority]} priority` : null}
                    </p>
                    {entry.remark ? (
                      <p className="mt-1 border-l-2 pl-3 text-muted-foreground">{entry.remark}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dateFormatter.format(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RunTimeline entries={timeline} />

      <MessageList
        messages={ticket.messages.map((message) => ({
          id: message.id,
          senderEmail: message.senderEmail,
          body: message.body,
          sentAtLabel: dateFormatter.format(message.sentAt),
          attachments: message.attachments,
        }))}
      />
    </div>
  );
}
