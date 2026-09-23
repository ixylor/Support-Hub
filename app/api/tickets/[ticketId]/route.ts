import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import { deleteTicket } from "@/lib/tickets/lifecycle";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_STATUSES = tickets.status.enumValues;
type TicketStatus = (typeof TICKET_STATUSES)[number];

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { ticketId } = await params;
  if (!UUID_PATTERN.test(ticketId)) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const status = (body as { status?: unknown } | null)?.status;
  if (typeof status !== "string" || !TICKET_STATUSES.includes(status as TicketStatus)) {
    return badRequest(`status must be one of: ${TICKET_STATUSES.join(", ")}`);
  }

  const viewer = session.user as { id: string; role?: string };
  const isAdmin = viewer.role === "admin";
  const result = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .select({ status: tickets.status, assignedToUserId: tickets.assignedToUserId })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for("update")
      .limit(1);

    if (!ticket) return { ok: false as const, reason: "not_found" as const };
    if (!isAdmin && ticket.assignedToUserId !== viewer.id) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    if (ticket.status === "resolved" || ticket.status === "triaged_out") {
      return { ok: false as const, reason: "terminal" as const };
    }
    if (!isAdmin && status !== "resolved") {
      return { ok: false as const, reason: "agent_restricted" as const };
    }

    await tx.update(tickets).set({ status: status as TicketStatus }).where(eq(tickets.id, ticketId));
    return { ok: true as const };
  });

  if (!result.ok && result.reason === "not_found") {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (!result.ok && result.reason === "forbidden") {
    return NextResponse.json({ error: "You can only update tickets assigned to you." }, { status: 403 });
  }
  if (!result.ok && result.reason === "agent_restricted") {
    return NextResponse.json({ error: "Agents can only mark assigned tickets as completed." }, { status: 403 });
  }
  if (!result.ok) {
    return NextResponse.json({ error: "Completed tickets cannot be reopened or changed." }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if ((session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can permanently delete tickets." }, { status: 403 });
  }

  const { ticketId } = await params;
  if (!UUID_PATTERN.test(ticketId)) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const result = await deleteTicket(ticketId);
  if (!result.ok && result.reason === "not_found") {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: "Only resolved or triaged-out tickets can be permanently deleted." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
