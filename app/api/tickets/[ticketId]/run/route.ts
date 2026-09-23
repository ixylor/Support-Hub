import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { ticketApprovals, ticketMessages, tickets } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/boss";
import { QUEUES } from "@/lib/jobs/queues";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can run the workflow." }, { status: 403 });
  }

  const { ticketId } = await params;
  const [ticket] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const [latestInbound] = await db
    .select({ sentAt: ticketMessages.sentAt })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "inbound")))
    .orderBy(desc(ticketMessages.sentAt))
    .limit(1);
  const [latestOutbound] = await db
    .select({ sentAt: ticketMessages.sentAt })
    .from(ticketMessages)
    .where(and(eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.direction, "outbound")))
    .orderBy(desc(ticketMessages.sentAt))
    .limit(1);
  const [pendingApproval] = await db
    .select({ id: ticketApprovals.id })
    .from(ticketApprovals)
    .where(and(eq(ticketApprovals.ticketId, ticketId), eq(ticketApprovals.status, "pending")))
    .limit(1);

  if (pendingApproval) {
    return NextResponse.json(
      { error: "This workflow is already waiting for review. Resolve the pending review before running it again.", code: "PENDING_REVIEW" },
      { status: 409 }
    );
  }
  if (latestOutbound && (!latestInbound || latestInbound.sentAt <= latestOutbound.sentAt)) {
    return NextResponse.json(
      { error: "There is no new customer email to process. Wait for a reply before running the workflow again.", code: "NO_NEW_EMAIL" },
      { status: 409 }
    );
  }

  await enqueue(QUEUES.workflowRun, { ticketId, trigger: "manual" });
  return NextResponse.json({ ok: true });
}
