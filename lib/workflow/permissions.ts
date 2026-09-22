import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";

export async function canDecideApproval(
  ticketId: string,
  viewer: { id: string; role: string }
): Promise<boolean> {
  if (viewer.role === "admin") return true;

  const [ticket] = await db
    .select({ assignedToUserId: tickets.assignedToUserId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);

  return ticket?.assignedToUserId === viewer.id;
}
