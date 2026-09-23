import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";
import { seedTicketWithPendingSendApproval } from "./helpers/workflow";

const adminEmail = "e2e-tickets-admin@example.com";
const password = "correct-horse-battery-staple";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/dashboard");
}

async function adminId(): Promise<string> {
  const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.email, adminEmail));
  return admin.id;
}

test("a reviewer edits a draft and approves it", async ({ page }) => {
  const { ticketId, teardown } = await seedTicketWithPendingSendApproval(await adminId());

  try {
    await signIn(page);
    await page.goto(`/dashboard/tickets/${ticketId}`);

    const panel = page.getByTestId("approval-panel");
    await expect(panel).toContainText("Reset your password.");

    await panel.getByRole("button", { name: "Edit & approve" }).click();
    await panel
      .getByRole("textbox", { name: "Reply" })
      .fill("Try a password reset from the sign-in page.");
    await panel.getByRole("button", { name: "Send" }).click();

    // The first mutation request can include a cold Next route compile and
    // pg-boss startup in CI, so give the real integration boundary time to
    // finish instead of racing the development server's warm-up.
    await expect(page.getByTestId("approval-panel")).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await teardown();
  }
});

test("rejecting requires a note", async ({ page }) => {
  const { ticketId, teardown } = await seedTicketWithPendingSendApproval(await adminId());

  try {
    await signIn(page);
    await page.goto(`/dashboard/tickets/${ticketId}`);

    const panel = page.getByTestId("approval-panel");
    await panel.getByRole("button", { name: "Reject with feedback" }).click();
    await panel.getByRole("button", { name: "Send back" }).click();

    await expect(panel).toContainText("requires a note");
  } finally {
    await teardown();
  }
});
