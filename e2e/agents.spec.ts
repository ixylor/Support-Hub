import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";

const adminEmail = "e2e-agents-admin@example.com";
const agentEmail = "e2e-agents-agent@example.com";
const password = "correct-horse-battery-staple";

test.describe("agents settings", () => {
  test.beforeAll(async ({ baseURL }) => {
    // Sign up over HTTP rather than importing lib/auth/server directly — see
    // the note in e2e/login.spec.ts.
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
    await page.waitForURL("/dashboard");
  }

  test("an admin edits an agent prompt and sees the version increment", async ({ page }) => {
    await signIn(page, adminEmail);
    await page.goto("/dashboard/settings/agents");

    const triage = page.getByTestId("agent-card-triage");
    await expect(triage.getByTestId("agent-prompt-version")).toHaveText("Version 1");

    await triage.getByRole("textbox", { name: "Prompt" }).fill("A revised triage prompt.");
    await triage.getByRole("button", { name: "Save" }).click();

    await expect(triage.getByTestId("agent-prompt-version")).toHaveText("Version 2");
  });

  test("the agents page is not reachable by a non-admin", async ({ page }) => {
    await signIn(page, agentEmail);
    await page.goto("/dashboard/settings/agents");

    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
