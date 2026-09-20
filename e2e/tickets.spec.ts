import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";
import { mailboxConnections, ticketMessages, tickets } from "@/lib/db/schema";

const agentEmail = "e2e-tickets-agent@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async ({ baseURL }) => {
  await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL! },
    body: JSON.stringify({ email: agentEmail, password, name: agentEmail }),
  }).catch(() => {
    // Already exists from a previous run — sign-in is what these tests verify anyway.
  });
});

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/dashboard");
}

test("an agent with no tickets sees the empty state", async ({ page }) => {
  await signIn(page, agentEmail);
  await page.goto("/dashboard/tickets");

  await expect(page.getByText("No tickets yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Integrations" })).toBeVisible();
});

test("an agent can view a ticket's message thread", async ({ page }) => {
  const seededUser = await db.select().from(user).where(eq(user.email, agentEmail));
  const [connection] = await db
    .insert(mailboxConnections)
    .values({
      provider: "microsoft",
      mailboxAddress: "support@example.com",
      encryptedRefreshToken: "unused-in-this-test",
      connectedByUserId: seededUser[0].id,
      status: "disconnected",
    })
    .returning({ id: mailboxConnections.id });
  const [ticket] = await db
    .insert(tickets)
    .values({
      subject: "Cannot log in to my account",
      requesterEmail: "customer@example.com",
      status: "new",
      mailboxConnectionId: connection.id,
      providerThreadId: crypto.randomUUID(),
    })
    .returning({ id: tickets.id });
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

  try {
    await signIn(page, agentEmail);
    await page.goto("/dashboard/tickets");

    await expect(page.getByRole("link", { name: "Cannot log in to my account" })).toBeVisible();
    await page.getByRole("link", { name: "Cannot log in to my account" }).click();

    await expect(page.getByText("I can't log in, it says my password is wrong.")).toBeVisible();
    await expect(page.getByText("Thanks for reaching out, let's reset your password.")).toBeVisible();
  } finally {
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
    await db.delete(tickets).where(eq(tickets.id, ticket.id));
    await db.delete(mailboxConnections).where(eq(mailboxConnections.id, connection.id));
  }
});
