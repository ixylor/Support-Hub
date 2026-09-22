import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import { createTestTicket } from "@/lib/test-helpers/tickets";
import { createTestUser } from "@/lib/test-helpers/users";
import { canDecideApproval } from "./permissions";

describe("approval permissions", () => {
  let ticketId: string;
  let adminId: string;
  let agentId: string;

  beforeEach(async () => {
    ticketId = await createTestTicket({});
    adminId = await createTestUser("admin");
    agentId = await createTestUser("agent");
  });

  it("lets an admin decide any ticket", async () => {
    await expect(
      canDecideApproval(ticketId, { id: adminId, role: "admin" })
    ).resolves.toBe(true);
  });

  it("lets an agent decide a ticket assigned to them", async () => {
    await db.update(tickets).set({ assignedToUserId: agentId }).where(eq(tickets.id, ticketId));

    await expect(
      canDecideApproval(ticketId, { id: agentId, role: "agent" })
    ).resolves.toBe(true);
  });

  it("refuses an agent when the ticket is unassigned", async () => {
    await expect(
      canDecideApproval(ticketId, { id: agentId, role: "agent" })
    ).resolves.toBe(false);
  });
});
