import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

const agentEmail = "e2e-integrations-agent@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async ({ baseURL }) => {
  // Sign up over HTTP rather than importing lib/auth/server directly: that module
  // reads OAuth secrets via a top-level await, which Playwright's own TypeScript
  // transform can't execute in a file it loads directly (see e2e/login.spec.ts).
  await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL! },
    body: JSON.stringify({ email: agentEmail, password, name: agentEmail }),
  }).catch(() => {
    // Already exists from a previous run — sign-in is what this test verifies anyway.
  });

  await db.update(user).set({ role: "agent" }).where(eq(user.email, agentEmail));
});

test("an agent who navigates directly to the integrations settings URL is redirected away", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(agentEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/dashboard");

  await page.goto("/dashboard/settings/integrations");

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("heading", { name: "Google OAuth" })).not.toBeVisible();
});
