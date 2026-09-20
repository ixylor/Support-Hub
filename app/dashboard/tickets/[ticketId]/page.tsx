import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getTicketWithMessages, type TicketWithMessages } from "@/lib/tickets/queries";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import { MessageList } from "./message-list";

const STATUS_VARIANTS: Record<TicketWithMessages["status"], VariantProps<typeof badgeVariants>["variant"]> = {
  new: "default",
  pending_review: "secondary",
  approved: "secondary",
  escalated: "destructive",
  resolved: "outline",
  waiting_on_customer: "secondary",
};

const STATUS_LABELS: Record<TicketWithMessages["status"], string> = {
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TicketThreadPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const { ticketId } = await params;
  if (!UUID_PATTERN.test(ticketId)) {
    notFound();
  }

  const ticket = await getTicketWithMessages(ticketId);
  if (!ticket) {
    notFound();
  }

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/tickets" className="text-sm text-muted-foreground hover:underline">
        &larr; Back to tickets
      </Link>

      <div className="mt-3 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{ticket.subject}</h1>
          <p className="text-sm text-muted-foreground">{ticket.requesterEmail}</p>
        </div>
        <Badge variant={STATUS_VARIANTS[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
      </div>

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
