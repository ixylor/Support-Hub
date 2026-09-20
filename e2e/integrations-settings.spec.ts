import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

const adminEmail = "e2e-integrations-admin@example.com";
const agentEmail = "e2e-integrations-agent@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async ({ baseURL }) => {
  for (const email of [adminEmail, agentEmail]) {
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
  // Wait for the post-sign-in redirect to complete before the caller navigates
  // again — otherwise a following page.goto can cancel the in-flight sign-in
  // request before the session cookie is set.
  await page.waitForURL("/dashboard");
}

test("an agent cannot see or reach the integrations page", async ({ page }) => {
  await signIn(page, agentEmail);
  await expect(page.getByRole("link", { name: "Integrations" })).toHaveCount(0);

  await page.goto("/dashboard/settings/integrations");
  await expect(page).toHaveURL("/dashboard");
});

test("an admin saves OAuth credentials and can then start a connection", async ({ page }) => {
  await signIn(page, adminEmail);
  await page.goto("/dashboard/settings/integrations");

  await page.getByPlaceholder("OAuth client ID").fill("test-client-id");
  await page.getByPlaceholder("OAuth client secret").fill("test-client-secret");
  await page.getByRole("button", { name: "Save credentials" }).click();

  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Microsoft 365 mailbox" })).toBeVisible();
});
