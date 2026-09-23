import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { deleteTicket } from "@/lib/tickets/lifecycle";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
