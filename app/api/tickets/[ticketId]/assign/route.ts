import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { assignTicket } from "@/lib/tickets/assignment";
import { tickets } from "@/lib/db/schema";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIORITIES = tickets.priority.enumValues;
type Priority = (typeof PRIORITIES)[number];

// Long enough for a handover note, short enough that the column can't be
// used as a general-purpose blob store.
const MAX_REMARK_LENGTH = 2000;

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can assign tickets." }, { status: 403 });
  }

  const { ticketId } = await params;
  if (!UUID_PATTERN.test(ticketId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const { assigneeUserId, priority, remark } = (body ?? {}) as {
    assigneeUserId?: unknown;
    priority?: unknown;
    remark?: unknown;
  };

  // Absent means "leave the assignee alone" — the inline priority picker
  // sends exactly that. Null unassigns.
  if (assigneeUserId !== undefined && assigneeUserId !== null) {
    if (typeof assigneeUserId !== "string" || assigneeUserId.trim() === "") {
      return badRequest("assigneeUserId must be a user id, or null to unassign.");
    }
  }

  if (assigneeUserId === undefined && priority === undefined) {
    return badRequest("Provide assigneeUserId, priority, or both.");
  }

  // Absent means "leave the current priority alone"; an explicit null
  // clears it. Both are valid, so the two cases stay distinguishable here.
  if (priority !== undefined && priority !== null) {
    if (typeof priority !== "string" || !PRIORITIES.includes(priority as Priority)) {
      return badRequest(`priority must be one of: ${PRIORITIES.join(", ")}`);
    }
  }

  if (remark !== undefined && remark !== null && typeof remark !== "string") {
    return badRequest("remark must be a string.");
  }
  if (typeof remark === "string" && remark.length > MAX_REMARK_LENGTH) {
    return badRequest(`remark must be ${MAX_REMARK_LENGTH} characters or fewer.`);
  }

  const result = await assignTicket({
    ticketId,
    ...(assigneeUserId === undefined
      ? {}
      : { assigneeUserId: assigneeUserId as string | null }),
    ...(priority === undefined ? {} : { priority: priority as Priority | null }),
    remark: typeof remark === "string" ? remark : null,
    assignedByUserId: session.user.id,
  });

  if (!result.ok) {
    if (result.error === "ticket_not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return badRequest("That user does not exist.");
  }

  return NextResponse.json({ ok: true });
}
