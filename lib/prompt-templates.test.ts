import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { promptTemplates } from "@/lib/db/schema";
import { auth } from "@/lib/auth/server";
import { activateNewPromptVersion, getActivePromptTemplate } from "./prompt-templates";

describe("prompt template versioning", () => {
  let userId: string;

  beforeAll(async () => {
    const result = await auth.api.signUpEmail({
      body: { email: `prompt-test-${crypto.randomUUID()}@example.com`, password: "x".repeat(16), name: "Seed" },
    });
    userId = result.user.id;
  });

  it("deactivates the previous version when a new one is activated", async () => {
    const key = `test-prompt-${crypto.randomUUID()}`;

    await activateNewPromptVersion(key, "version one", userId);
    await activateNewPromptVersion(key, "version two", userId);

    const rows = await db.select().from(promptTemplates).where(eq(promptTemplates.key, key));
    const active = rows.filter((row) => row.isActive);

    expect(active).toHaveLength(1);
    expect(active[0].content).toBe("version two");
    expect(active[0].version).toBe(2);
  });

  it("returns the active version's content", async () => {
    const key = `test-prompt-${crypto.randomUUID()}`;
    await activateNewPromptVersion(key, "the content", userId);

    const result = await getActivePromptTemplate(key);

    expect(result).toEqual({ content: "the content", version: 1 });
  });
});
