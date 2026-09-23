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
} from "@/lib/tickets/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getPendingApproval } from "@/lib/workflow/approvals";
import { getApprovalCitations, getRunTimeline } from "@/lib/workflow/timeline";
import { ApprovalPanel, type ApprovalProposal } from "./approval-panel";
import { MessageList } from "./message-list";
import { AssignDialog } from "./assign-dialog";
import { RunTimeline } from "./run-timeline";
import { RunWorkflowButton } from "./run-workflow-button";
import { ManualReply } from "./manual-reply";
import { DeleteTicket } from "./delete-ticket";
import { StatusPicker } from "../ticket-pickers";

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
    <div className="min-w-0 max-w-[1600px]">
      <Link href="/dashboard/tickets" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to tickets
      </Link>

      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{ticket.subject}</h1>
          <p className="text-sm text-muted-foreground">{ticket.requesterEmail}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {isAdmin ? <RunWorkflowButton ticketId={ticket.id} /> : null}
          <StatusPicker ticketId={ticket.id} currentStatus={ticket.status} isAdmin={isAdmin} />
          {isAdmin && (ticket.status === "resolved" || ticket.status === "triaged_out") ? (
            <DeleteTicket ticketId={ticket.id} />
          ) : null}
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

      <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/30 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Ticket details</p>
              <CardTitle className="mt-1 text-base">Ownership</CardTitle>
            </div>
            {isAdmin ? (
              <AssignDialog
                ticketId={ticket.id}
                currentAssignee={ticket.assignee}
                currentPriority={ticket.priority}
                currentUserId={viewer.id}
              />
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4 py-4">
          <div className="rounded-md border bg-background p-3">
            <p className="text-xs text-muted-foreground">Assigned agent</p>
            <p className="mt-1 text-sm font-medium">{ticket.assignee?.name ?? "Unassigned"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{ticket.assignee ? "Responsible for the next action" : "Assign an owner to make this ticket visible to an agent"}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Priority</p>
              <div className="mt-2">{ticket.priority ? <Badge variant={PRIORITY_VARIANTS[ticket.priority]}>{PRIORITY_LABELS[ticket.priority]}</Badge> : <span className="text-xs text-muted-foreground">Not set</span>}</div>
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="text-xs text-muted-foreground">Messages</p>
              <p className="mt-2 text-sm font-medium tabular-nums">{ticket.messages.length}</p>
            </div>
          </div>

          <div className="rounded-md border bg-background p-3">
            <p className="text-xs text-muted-foreground">Requester</p>
            <p className="mt-1 break-all text-sm">{ticket.requesterEmail}</p>
          </div>

          {history.length > 0 ? (
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between border-t pt-4 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
                Assignment history <span className="tabular-nums">({history.length})</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
              <ol className="mt-3 flex flex-col gap-3">
                {history.map((entry) => (<li key={entry.id} className="border-l-2 border-muted pl-3 text-sm">
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
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {dateFormatter.format(entry.createdAt)}
                    </p>
                </li>
                ))}
              </ol>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader><CardTitle className="text-sm">Workflow control</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          <p>Run manually after a new customer email arrives. Repeated runs without a new email are blocked.</p>
        </CardContent>
      </Card>
      </aside>

      <main className="min-w-0">
      <MessageList
        messages={ticket.messages.map((message) => ({
          id: message.id,
          direction: message.direction,
          senderEmail: message.senderEmail,
          body: message.body,
          sentAtLabel: dateFormatter.format(message.sentAt),
          attachments: message.attachments,
        }))}
      />
      <ManualReply ticketId={ticket.id} />
      </main>
      <section className="min-w-0 rounded-lg border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
        <RunTimeline entries={timeline} />
      </section>
      </div>
    </div>
  );
}
