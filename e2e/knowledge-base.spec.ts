import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/auth/schema";
import { kbEntries } from "@/lib/db/schema";
import { knowledgeBaseReadiness } from "@/lib/kb/entries";

const adminEmail = "e2e-kb-admin@example.com";
const agentEmail = "e2e-kb-agent@example.com";
const password = "correct-horse-battery-staple";

test.describe("knowledge base", () => {
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

  test("an agent cannot reach the knowledge base", async ({ page }) => {
    await signIn(page, agentEmail);
    await expect(page.getByRole("link", { name: "Knowledge Base" })).toHaveCount(0);

    await page.goto("/dashboard/knowledge-base");
    await expect(page).toHaveURL("/dashboard");
  });

  // No Azure OpenAI credentials are configured in the test database — they can
  // only be entered by a human through the AI Provider settings page, and
  // doing that here would mean mocking the provider inside an E2E test, which
  // defeats the point of testing the real stack. This exercises the blocked
  // path that exists today instead of faking a pass on the happy path.
  test("an admin without a configured AI provider is blocked from adding documents", async ({
    page,
  }) => {
    const readiness = await knowledgeBaseReadiness();
    test.skip(
      readiness.ready,
      "An AI provider is configured in this environment; the blocked-upload path doesn't apply here."
    );

    await signIn(page, adminEmail);
    await page.goto("/dashboard/knowledge-base");

    await expect(page.getByText("AI provider not configured")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload document" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Write article" })).toBeDisabled();
  });

  // Requires both the worker (started via playwright.config.ts's webServer
  // array) and a configured Azure OpenAI embedding deployment. The latter can
  // only be set up by a human through the AI Provider page, so this test
  // skips cleanly rather than asserting nothing when it's missing.
  test("an admin uploads a document, it becomes ready, and retrieval finds it", async ({
    page,
  }) => {
    const readiness = await knowledgeBaseReadiness();
    test.skip(
      !readiness.ready,
      "No AI provider is configured in this environment — configure Azure OpenAI " +
        "credentials and an embedding deployment via Settings → AI Provider to run this test."
    );

    await signIn(page, adminEmail);
    await page.goto("/dashboard/knowledge-base");

    await page.getByRole("button", { name: "Upload document" }).click();
    await page.setInputFiles("input[type=file]", "e2e/fixtures/kb-sample.md");
    await page.getByLabel("Title").fill("Warranty policy");
    await page.getByRole("button", { name: "Upload" }).click();

    const row = page.getByRole("row", { name: /Warranty policy/ });
    await expect(row).toBeVisible();

    // The worker processes asynchronously; poll the list rather than sleeping.
    await expect(async () => {
      await page.reload();
      await expect(row.getByText("Ready")).toBeVisible();
    }).toPass({ timeout: 60_000 });

    await page.getByLabel("Test retrieval query").fill("WARR_8891");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.getByText("Warranty policy")).toBeVisible();

    await db.delete(kbEntries).where(eq(kbEntries.title, "Warranty policy"));
  });

  test("an admin deletes a document", async ({ page }) => {
    // Seeded directly rather than relying on the upload test's output: that
    // test skips when no AI provider is configured, and this one shouldn't
    // depend on that.
    const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.email, adminEmail));
    const title = `Seeded for deletion ${randomUUID()}`;
    await db.insert(kbEntries).values({
      title,
      sourceType: "article",
      status: "ready",
      uploadedByUserId: admin.id,
    });

    await signIn(page, adminEmail);
    await page.goto("/dashboard/knowledge-base");

    const row = page.getByRole("row", { name: new RegExp(title) });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete document" }).click();

    await expect(row).toHaveCount(0);
  });
});
