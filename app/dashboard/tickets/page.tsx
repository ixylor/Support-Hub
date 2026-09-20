import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { listTickets, type TicketListItem } from "@/lib/tickets/queries";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { VariantProps } from "class-variance-authority";

const STATUS_VARIANTS: Record<TicketListItem["status"], VariantProps<typeof badgeVariants>["variant"]> = {
  new: "default",
  pending_review: "secondary",
  approved: "secondary",
  escalated: "destructive",
  resolved: "outline",
  waiting_on_customer: "secondary",
};

const STATUS_LABELS: Record<TicketListItem["status"], string> = {
  new: "New",
  pending_review: "Pending Review",
  approved: "Approved",
  escalated: "Escalated",
  resolved: "Resolved",
  waiting_on_customer: "Waiting on Customer",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function TicketsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const ticketRows = await listTickets();

  if (ticketRows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No tickets yet</EmptyTitle>
          <EmptyDescription>
            Tickets appear here once a support mailbox is connected and polled for new mail. Ask
            an admin to connect one on the{" "}
            <Link href="/dashboard/settings/integrations">Integrations</Link> page.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Tickets</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject</TableHead>
            <TableHead>Requester</TableHead>
            <TableHead>Status</TableHead>
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
                <Badge variant={STATUS_VARIANTS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
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
