import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

test("an admin sees the admin-only links", async ({ page, baseURL }) => {
  const email = "e2e-admin@example.com";
  const password = "correct-horse-battery-staple";

  // Sign up over HTTP rather than importing lib/auth/server directly: that module
  // reads OAuth secrets via a top-level await, which Playwright's own TypeScript
  // transform can't execute in a file it loads directly (see e2e/login.spec.ts).
  await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL! },
    body: JSON.stringify({ email, password, name: "E2E Admin" }),
  }).catch(() => {
    // Already exists from a previous run — sign-in is what this test verifies anyway.
  });

  // Promote to admin directly against the database — there is no UI for this yet,
  // by design (admin promotion tooling is out of scope for Foundation). The `role`
  // field is `input: false` in lib/auth/server.ts, so it cannot be set through
  // Better Auth's user-facing update-user API; a direct write is the reliable path.
  await db.update(user).set({ role: "admin" }).where(eq(user.email, email));

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Knowledge Base" })).toBeVisible();
});
