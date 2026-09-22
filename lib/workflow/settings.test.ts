import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { workflowSettings } from "@/lib/db/schema";
import { createTestUser } from "@/lib/test-helpers/users";
import { getWorkflowSettings, updateWorkflowSettings } from "./settings";

describe("workflow settings", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await createTestUser();
    await db
      .update(workflowSettings)
      .set({ isEnabled: true, requireApproval: true, autoSendMinConfidence: "0.8" });
  });

  it("reads the seeded row with numbers, not strings", async () => {
    const settings = await getWorkflowSettings();

    expect(settings).toEqual({
      isEnabled: true,
      requireApproval: true,
      autoSendMinConfidence: 0.8,
    });
  });

  it("updates in place rather than inserting a second row", async () => {
    await updateWorkflowSettings(
      { isEnabled: true, requireApproval: false, autoSendMinConfidence: 0.95 },
      userId
    );

    expect(await db.select().from(workflowSettings)).toHaveLength(1);
    expect((await getWorkflowSettings()).autoSendMinConfidence).toBe(0.95);
  });

  it("rejects a confidence floor outside 0..1", async () => {
    await expect(
      updateWorkflowSettings(
        { isEnabled: true, requireApproval: false, autoSendMinConfidence: 1.5 },
        userId
      )
    ).rejects.toThrow(/between 0 and 1/);
  });
});
