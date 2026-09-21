import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiDeployments, agents } from "@/lib/db/schema";
import { createTestUser } from "@/lib/test-helpers/users";
import { AgentDisabledError, getAgentConfig, listAgentConfigs, updateAgentConfig } from "./config";

describe("agent config", () => {
  let userId: string;

  beforeEach(async () => {
    userId = await createTestUser();
    await db.update(agents).set({ isEnabled: true, aiDeploymentId: null });
    // agents.ai_deployment_id references ai_deployments.id, so the update
    // above (which clears any pin) must run before this delete.
    await db.delete(aiDeployments);
  });

  it("lists all four agents with their active prompt", async () => {
    const configs = await listAgentConfigs();

    expect(configs).toHaveLength(4);
    expect(configs.map((config) => config.key)).toContain("triage");
    expect(configs.every((config) => config.promptVersion === 1)).toBe(true);
  });

  it("falls back to the active chat deployment when the agent pins none", async () => {
    await db.insert(aiDeployments).values({
      role: "chat",
      deploymentName: "gpt-4o-mini-dep",
      modelName: "gpt-4o-mini",
      isActive: true,
      updatedByUserId: userId,
    });

    const config = await getAgentConfig("triage");
    expect(config.deploymentName).toBe("gpt-4o-mini-dep");
  });

  it("uses the pinned deployment over the chat default", async () => {
    await db.insert(aiDeployments).values({
      role: "chat",
      deploymentName: "default-dep",
      modelName: "gpt-4o-mini",
      isActive: true,
      updatedByUserId: userId,
    });
    const [pinned] = await db
      .insert(aiDeployments)
      .values({
        role: "chat",
        deploymentName: "strong-dep",
        modelName: "gpt-4o",
        isActive: false,
        updatedByUserId: userId,
      })
      .returning({ id: aiDeployments.id });

    await updateAgentConfig("drafter", {
      aiDeploymentId: pinned.id,
      temperature: 0.5,
      isEnabled: true,
    });

    const config = await getAgentConfig("drafter");
    expect(config.deploymentName).toBe("strong-dep");
    expect(config.temperature).toBe(0.5);
  });

  it("throws rather than silently skipping a disabled agent", async () => {
    await updateAgentConfig("router", {
      aiDeploymentId: null,
      temperature: 0,
      isEnabled: false,
    });

    await expect(getAgentConfig("router")).rejects.toBeInstanceOf(AgentDisabledError);
  });

  it("rejects a temperature outside the supported range", async () => {
    await expect(
      updateAgentConfig("triage", { aiDeploymentId: null, temperature: 3, isEnabled: true })
    ).rejects.toThrow(/temperature/i);
  });
});
