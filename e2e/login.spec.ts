import { test, expect } from "@playwright/test";

const email = "e2e-agent@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async ({ baseURL }) => {
  // Sign up over HTTP rather than importing lib/auth/server directly: that module
  // reads OAuth secrets via a top-level await, which Playwright's own TypeScript
  // transform can't execute in a file it loads directly (it isn't part of the app
  // server bundle, so top-level await there is unsupported, unlike in Next.js itself).
  await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL! },
    body: JSON.stringify({ email, password, name: "E2E Agent" }),
  }).catch(() => {
    // Already exists from a previous run — sign-in is what this test verifies anyway.
  });
});

test("signs in with email and password and reaches the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/dashboard");
});

test("redirects unauthenticated visitors away from the dashboard", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login/);
});
