import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

const adminEmail = "e2e-email-admin@example.com";
const password = "correct-horse-battery-staple";

test.beforeAll(async ({ baseURL }) => {
  await fetch(`${baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseURL! },
    body: JSON.stringify({ email: adminEmail, password, name: adminEmail }),
  }).catch(() => {
    // Already exists from a previous run — sign-in is what these tests verify anyway.
  });

  await db.update(user).set({ role: "admin" }).where(eq(user.email, adminEmail));
});

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/dashboard");
}

test("an admin saves SMTP settings and the password is not echoed back", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard/settings/email");

  await page.getByLabel("Host").fill("smtp.example.test");
  await page.getByLabel("Port", { exact: true }).fill("587");
  await page.getByLabel("Username").fill("support@example.test");
  await page.getByLabel("Password").fill("hunter2");
  await page.getByLabel("From address").fill("support@example.test");
  await page.getByLabel("From name").fill("Example Support");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("email-settings-status")).toHaveText("Saved.");

  await page.reload();
  await expect(page.getByLabel("Host")).toHaveValue("smtp.example.test");
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("an invalid port is rejected before saving", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard/settings/email");

  await page.getByLabel("Host").fill("smtp.example.test");
  await page.getByLabel("Port", { exact: true }).fill("0");
  await page.getByLabel("From address").fill("support@example.test");
  await page.getByLabel("From name").fill("Example Support");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("email-settings-status")).toContainText("port");
});
