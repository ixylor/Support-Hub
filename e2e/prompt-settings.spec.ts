import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

const agentEmail = "e2e-agent@example.com";
const adminEmail = "e2e-admin@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async ({ baseURL }) => {
  // Sign up over HTTP rather than importing lib/auth/server directly: that module
  // reads OAuth secrets via a top-level await, which Playwright's own TypeScript
  // transform can't execute in a file it loads directly (see e2e/login.spec.ts).
  for (const email of [agentEmail, adminEmail]) {
    await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseURL! },
      body: JSON.stringify({ email, password, name: email }),
    }).catch(() => {
      // Already exists from a previous run — sign-in is what these tests verify anyway.
    });
  }

  // Promote directly against the database — there is no UI for this yet, by design
  // (admin promotion tooling is out of scope for Foundation). The `role` field is
  // `input: false` in lib/auth/server.ts, so a direct write is the reliable path.
  await db.update(user).set({ role: "admin" }).where(eq(user.email, adminEmail));
});

test("an agent cannot see the prompt settings link", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(agentEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Prompt Settings" })).not.toBeVisible();
});

test("an admin can edit and save the draft reply prompt", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("link", { name: "Prompt Settings" }).click();
  await page.getByRole("textbox").fill("Updated system prompt content.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(/Active version: \d+/)).toBeVisible();
});
