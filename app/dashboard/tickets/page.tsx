import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { listTickets, type TicketListFilter, type TicketViewer } from "@/lib/tickets/queries";
import {
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
  STATUS_LABELS,
  STATUS_VARIANTS,
} from "@/lib/tickets/labels";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { AssigneePicker, PriorityPicker } from "./ticket-pickers";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const FILTERS: { value: TicketListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
];

function parseFilter(value: string | undefined): TicketListFilter {
  return FILTERS.some((filter) => filter.value === value) ? (value as TicketListFilter) : "all";
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
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

  // Agents only ever see their own tickets, so the filter would be a no-op
  // for them — it is an admin-only control.
  const filter = isAdmin ? parseFilter((await searchParams).filter) : "all";
  const ticketRows = await listTickets(viewer, filter);

  const filterBar = isAdmin ? (
    <div className="flex items-center gap-1">
      {FILTERS.map(({ value, label }) => (
        // Styled as a button but genuinely a link: it navigates, and
        // wrapping it in <Button> would strip that from assistive tech.
        <Link
          key={value}
          href={value === "all" ? "/dashboard/tickets" : `/dashboard/tickets?filter=${value}`}
          className={buttonVariants({
            size: "sm",
            variant: filter === value ? "secondary" : "ghost",
          })}
        >
          {label}
        </Link>
      ))}
    </div>
  ) : null;

  if (ticketRows.length === 0) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">Tickets</h1>
          {filterBar}
        </div>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{filter === "all" ? "No tickets yet" : "Nothing here"}</EmptyTitle>
            <EmptyDescription>
              {!isAdmin ? (
                "Tickets appear here once an admin assigns one to you."
              ) : filter === "mine" ? (
                "No tickets are assigned to you right now."
              ) : filter === "unassigned" ? (
                "Every ticket currently has an owner."
              ) : (
                <>
                  Tickets appear here once a support mailbox is connected and polled for new mail.
                  Connect one on the{" "}
                  <Link href="/dashboard/settings/integrations">Integrations</Link> page.
                </>
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Tickets</h1>
        {filterBar}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject</TableHead>
            <TableHead>Requester</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead className="text-right">Messages</TableHead>
            <TableHead>Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ticketRows.map((ticket) => (
            <TableRow key={ticket.id}>
              <TableCell className="max-w-xs truncate font-medium">
                <Link href={`/dashboard/tickets/${ticket.id}`} className="hover:underline">
                  {ticket.subject}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{ticket.requesterEmail}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANTS[ticket.status]}>
                  {STATUS_LABELS[ticket.status]}
                </Badge>
              </TableCell>
              <TableCell>
                {isAdmin ? (
                  <PriorityPicker ticketId={ticket.id} currentPriority={ticket.priority} />
                ) : ticket.priority ? (
                  <Badge variant={PRIORITY_VARIANTS[ticket.priority]}>
                    {PRIORITY_LABELS[ticket.priority]}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">&mdash;</span>
                )}
              </TableCell>
              <TableCell>
                {isAdmin ? (
                  <AssigneePicker
                    ticketId={ticket.id}
                    currentAssignee={ticket.assignee}
                    currentUserId={viewer.id}
                  />
                ) : ticket.assignee ? (
                  ticket.assignee.name
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </TableCell>
              <TableCell className="text-right">{ticket.messageCount}</TableCell>
              <TableCell className="text-muted-foreground">
                {dateFormatter.format(ticket.lastMessageAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
