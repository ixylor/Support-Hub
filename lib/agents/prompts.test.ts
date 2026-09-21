import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentPromptVersions, agents } from "@/lib/db/schema";
import {
  activateAgentPromptVersion,
  getActiveAgentPrompt,
  listAgentPromptVersions,
} from "./prompts";
import { createTestUser } from "@/lib/test-helpers/users";

describe("agent prompts", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await createTestUser();
  });

  it("returns the seeded version 1 prompt", async () => {
    const active = await getActiveAgentPrompt("triage");

    expect(active?.version).toBe(1);
    expect(active?.content).toContain("classify inbound support email");
  });

  it("activating a new version supersedes the previous one", async () => {
    await activateAgentPromptVersion("triage", "a new triage prompt", userId);

    const active = await getActiveAgentPrompt("triage");
    expect(active?.version).toBe(2);
    expect(active?.content).toBe("a new triage prompt");

    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.key, "triage"));
    const all = await db
      .select({ version: agentPromptVersions.version, isActive: agentPromptVersions.isActive })
      .from(agentPromptVersions)
      .where(eq(agentPromptVersions.agentId, agent.id));

    expect(all).toHaveLength(2);
    expect(all.filter((row) => row.isActive)).toHaveLength(1);
  });

  it("serializes concurrent activations into distinct versions", async () => {
    await Promise.all([
      activateAgentPromptVersion("router", "first", userId),
      activateAgentPromptVersion("router", "second", userId),
    ]);

    const versions = await listAgentPromptVersions("router");
    expect(versions.map((row) => row.version).sort()).toEqual([1, 2, 3]);
  });

  it("lists versions newest first", async () => {
    await activateAgentPromptVersion("drafter", "v2", userId);

    const versions = await listAgentPromptVersions("drafter");
    expect(versions[0].version).toBe(2);
    expect(versions[0].updatedByUserId).toBe(userId);
    expect(versions[1].updatedByUserId).toBeNull();
  });
});
