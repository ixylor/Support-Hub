import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { ticketAssignments, tickets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import type { TicketPriority } from "./queries";

export type AssignTicketInput = {
  ticketId: string;
  // Omitted leaves the current assignee alone — that is what the inline
  // priority picker sends, so changing a priority can't silently reassign
  // a ticket out from under whoever holds it. Null unassigns.
  assigneeUserId?: string | null;
  // Same three-way distinction: omitted leaves the ticket's current
  // priority untouched, an explicit null clears it.
  priority?: TicketPriority | null;
  remark?: string | null;
  assignedByUserId: string;
};

export type AssignTicketResult =
  | { ok: true }
  | { ok: false; error: "ticket_not_found" | "assignee_not_found" };

// Assigns, reassigns or unassigns a ticket. The caller is responsible for
// checking that the actor is an admin — this function only enforces that
// the ticket and assignee exist.
export async function assignTicket(input: AssignTicketInput): Promise<AssignTicketResult> {
  const { ticketId, assigneeUserId, priority, remark, assignedByUserId } = input;

  return db.transaction(async (tx): Promise<AssignTicketResult> => {
    // Locked for the transaction so a concurrent assignment can't slip
    // between this check and the update, leaving history out of step with
    // the ticket's current assignee.
    const [ticket] = await tx
      .select({ id: tickets.id, assignedToUserId: tickets.assignedToUserId })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .for("update");
    if (!ticket) {
      return { ok: false, error: "ticket_not_found" };
    }

    // A priority-only change still gets a history row, and that row should
    // name whoever actually holds the ticket rather than claiming nobody.
    const resolvedAssigneeId =
      assigneeUserId === undefined ? ticket.assignedToUserId : assigneeUserId;

    if (assigneeUserId !== undefined && assigneeUserId !== null) {
      const [assignee] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, assigneeUserId));
      if (!assignee) {
        // The foreign key would catch this too, but a checked result beats
        // surfacing a raw constraint violation to the route.
        return { ok: false, error: "assignee_not_found" };
      }
    }

    await tx
      .update(tickets)
      .set({
        ...(assigneeUserId === undefined ? {} : { assignedToUserId: assigneeUserId }),
        ...(priority === undefined ? {} : { priority }),
      })
      .where(eq(tickets.id, ticketId));

    const trimmedRemark = remark?.trim();
    await tx.insert(ticketAssignments).values({
      ticketId,
      assignedToUserId: resolvedAssigneeId,
      assignedByUserId,
      priority: priority ?? null,
      remark: trimmedRemark ? trimmedRemark : null,
    });

    return { ok: true };
  });
}
