import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";
import {
  mailboxConnections,
  ticketAssignments,
  ticketMessages,
  tickets,
} from "@/lib/db/schema";

const agentEmail = "e2e-tickets-agent@example.com";
const otherAgentEmail = "e2e-tickets-other-agent@example.com";
const adminEmail = "e2e-tickets-admin@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async ({ baseURL }) => {
  // Sign up over HTTP rather than importing lib/auth/server directly — see the
  // note in e2e/prompt-settings.spec.ts.
  for (const email of [agentEmail, otherAgentEmail, adminEmail]) {
    await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseURL! },
      body: JSON.stringify({ email, password, name: email }),
    }).catch(() => {
      // Already exists from a previous run — sign-in is what these tests verify anyway.
    });
  }

  await db.update(user).set({ role: "admin" }).where(eq(user.email, adminEmail));
});

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/dashboard");
}

async function userIdFor(email: string): Promise<string> {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return row.id;
}

// Seeds a mailbox connection plus tickets, and hands back a teardown that
// removes everything it created.
async function seedTickets(
  specs: { subject: string; assignTo?: string | null; withMessages?: boolean }[]
) {
  const connectedBy = await userIdFor(adminEmail);
  const [connection] = await db
    .insert(mailboxConnections)
    .values({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      encryptedRefreshToken: "unused-in-this-test",
      connectedByUserId: connectedBy,
      status: "disconnected",
    })
    .returning({ id: mailboxConnections.id });

  const ticketIds: string[] = [];
  for (const spec of specs) {
    const [ticket] = await db
      .insert(tickets)
      .values({
        subject: spec.subject,
        requesterEmail: "customer@example.com",
        status: "new",
        mailboxConnectionId: connection.id,
        providerThreadId: crypto.randomUUID(),
        assignedToUserId: spec.assignTo ?? null,
      })
      .returning({ id: tickets.id });
    ticketIds.push(ticket.id);

    if (spec.withMessages) {
      await db.insert(ticketMessages).values([
        {
          ticketId: ticket.id,
          direction: "inbound",
          senderEmail: "customer@example.com",
          body: "I can't log in, it says my password is wrong.",
          providerMessageId: crypto.randomUUID(),
          sentAt: new Date("2026-09-18T09:00:00Z"),
        },
        {
          ticketId: ticket.id,
          direction: "outbound",
          senderEmail: "agent@example.com",
          body: "Thanks for reaching out, let's reset your password.",
          providerMessageId: crypto.randomUUID(),
          sentAt: new Date("2026-09-18T09:30:00Z"),
        },
      ]);
    }
  }

  async function teardown() {
    await db.delete(ticketMessages).where(inArray(ticketMessages.ticketId, ticketIds));
    await db.delete(ticketAssignments).where(inArray(ticketAssignments.ticketId, ticketIds));
    await db.delete(tickets).where(inArray(tickets.id, ticketIds));
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connection.id));
  }

  return { ticketIds, teardown };
}

test("an agent with no assigned tickets sees the empty state", async ({ page }) => {
  await signIn(page, agentEmail);
  await page.goto("/dashboard/tickets");

  await expect(page.getByText("Tickets appear here once an admin assigns one to you.")).toBeVisible();
});

test("an agent can view the message thread of a ticket assigned to them", async ({ page }) => {
  const agentId = await userIdFor(agentEmail);
  const { teardown } = await seedTickets([
    { subject: "Cannot log in to my account", assignTo: agentId, withMessages: true },
  ]);

  try {
    await signIn(page, agentEmail);
    await page.goto("/dashboard/tickets");

    await page.getByRole("link", { name: "Cannot log in to my account" }).click();

    await expect(page.getByText("I can't log in, it says my password is wrong.")).toBeVisible();
    await expect(
      page.getByText("Thanks for reaching out, let's reset your password.")
    ).toBeVisible();
  } finally {
    await teardown();
  }
});

test("an agent sees only their own tickets, not unassigned or other agents' ones", async ({
  page,
}) => {
  const agentId = await userIdFor(agentEmail);
  const otherAgentId = await userIdFor(otherAgentEmail);
  const { teardown } = await seedTickets([
    { subject: "Mine to handle", assignTo: agentId },
    { subject: "Belongs to someone else", assignTo: otherAgentId },
    { subject: "Still in the queue", assignTo: null },
  ]);

  try {
    await signIn(page, agentEmail);
    await page.goto("/dashboard/tickets");

    await expect(page.getByRole("link", { name: "Mine to handle" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Belongs to someone else" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Still in the queue" })).toHaveCount(0);
  } finally {
    await teardown();
  }
});

test("an agent who navigates straight to another agent's ticket gets a 404", async ({ page }) => {
  const otherAgentId = await userIdFor(otherAgentEmail);
  const { ticketIds, teardown } = await seedTickets([
    { subject: "Belongs to someone else", assignTo: otherAgentId },
  ]);

  try {
    await signIn(page, agentEmail);
    await page.goto(`/dashboard/tickets/${ticketIds[0]}`);

    await expect(page.getByText("Belongs to someone else")).toHaveCount(0);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  } finally {
    await teardown();
  }
});

test("an admin sees every ticket and can filter down to the unassigned queue", async ({ page }) => {
  const agentId = await userIdFor(agentEmail);
  const { teardown } = await seedTickets([
    { subject: "Already owned", assignTo: agentId },
    { subject: "Still in the queue", assignTo: null },
  ]);

  try {
    await signIn(page, adminEmail);
    await page.goto("/dashboard/tickets");

    await expect(page.getByRole("link", { name: "Already owned" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Still in the queue" })).toBeVisible();

    await page.getByRole("link", { name: "Unassigned" }).click();

    await expect(page.getByRole("link", { name: "Still in the queue" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Already owned" })).toHaveCount(0);
  } finally {
    await teardown();
  }
});

test("an admin assigns a ticket from the table and the agent then sees it", async ({ page }) => {
  const { ticketIds, teardown } = await seedTickets([{ subject: "Needs an owner", assignTo: null }]);

  try {
    await signIn(page, adminEmail);
    await page.goto("/dashboard/tickets");

    // The inline picker: click the cell, search, pick a person.
    await page.getByRole("button", { name: "Assign this ticket" }).click();
    await page.getByPlaceholder("Search people...").fill(agentEmail);
    await page.getByRole("option", { name: agentEmail }).click();

    await expect(page.getByRole("button", { name: `Assigned to ${agentEmail}. Change.` })).toBeVisible();

    // And the agent can now reach it, which is the point of assigning.
    await signIn(page, agentEmail);
    await page.goto(`/dashboard/tickets/${ticketIds[0]}`);
    await expect(page.getByRole("heading", { name: "Needs an owner" })).toBeVisible();
  } finally {
    await teardown();
  }
});

test("an admin sets a priority from the table without disturbing the assignee", async ({ page }) => {
  const agentId = await userIdFor(agentEmail);
  const { teardown } = await seedTickets([{ subject: "Needs triage", assignTo: agentId }]);

  try {
    await signIn(page, adminEmail);
    await page.goto("/dashboard/tickets");

    await page.getByRole("button", { name: "Set a priority" }).click();
    await page.getByPlaceholder("Search priority...").fill("Urgent");
    await page.getByRole("option", { name: "Urgent" }).click();

    await expect(page.getByRole("button", { name: "Priority Urgent. Change." })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Assigned to ${agentEmail}. Change.` })
    ).toBeVisible();
  } finally {
    await teardown();
  }
});

test("an agent cannot assign: the ticket page shows no assign control", async ({ page }) => {
  const agentId = await userIdFor(agentEmail);
  const { ticketIds, teardown } = await seedTickets([
    { subject: "Mine to handle", assignTo: agentId },
  ]);

  try {
    await signIn(page, agentEmail);
    await page.goto(`/dashboard/tickets/${ticketIds[0]}`);

    await expect(page.getByText("Assignment")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reassign" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assign" })).toHaveCount(0);
  } finally {
    await teardown();
  }
});
