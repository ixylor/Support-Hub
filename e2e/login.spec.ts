import { test, expect } from "@playwright/test";
import { auth } from "@/lib/auth/server";

const email = "e2e-agent@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async () => {
  await auth.api.signUpEmail({ body: { email, password, name: "E2E Agent" } }).catch(() => {
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
