import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agents, aiDeployments, llmLogs } from "@/lib/db/schema";
import { createTestTicket } from "@/lib/test-helpers/tickets";
import { createTestUser } from "@/lib/test-helpers/users";
import { AgentDisabledError } from "@/lib/agents/config";
import type { ChatClient } from "@/lib/ai/chat";
import { runAgent } from "./run-agent";

const SCHEMA = {
  type: "object",
  properties: { verdict: { type: "string" } },
  required: ["verdict"],
  additionalProperties: false,
};

function fakeChat(data: unknown): ChatClient {
  return vi.fn(async () => ({
    data,
    rawResponse: JSON.stringify(data),
    modelName: "gpt-4o-mini",
  })) as unknown as ChatClient;
}

describe("runAgent", () => {
  let ticketId: string;

  beforeEach(async () => {
    await db.delete(llmLogs);
    // agents.ai_deployment_id references ai_deployments.id, so clearing any
    // pin must run before the delete below (same ordering config.test.ts
    // uses).
    await db.update(agents).set({ isEnabled: true, aiDeploymentId: null, temperature: "0.2" });
    await db.delete(aiDeployments);
    // No agent pins a deployment (cleared above), so every agent resolves
    // through this active "chat" fallback — the same path getAgentConfig
    // uses in production when nothing is pinned.
    const userId = await createTestUser();
    await db.insert(aiDeployments).values({
      role: "chat",
      deploymentName: "gpt-4o-mini-dep",
      modelName: "gpt-4o-mini",
      isActive: true,
      updatedByUserId: userId,
    });
    ticketId = await createTestTicket({});
  });

  it("sends the agent's active prompt and temperature", async () => {
    const chat = fakeChat({ verdict: "ok" });

    await runAgent({
      key: "triage",
      userPrompt: "Login is broken.",
      schemaName: "triage",
      schema: SCHEMA,
      ticketId,
      graphThreadId: "thread-1",
      chat,
    });

    const request = (chat as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.systemPrompt).toContain("classify inbound support email");
    expect(request.temperature).toBe(0.2);
    expect(request.userPrompt).toBe("Login is broken.");
  });

  it("returns the parsed data", async () => {
    const result = await runAgent<{ verdict: string }>({
      key: "triage",
      userPrompt: "Login is broken.",
      schemaName: "triage",
      schema: SCHEMA,
      ticketId,
      graphThreadId: "thread-1",
      chat: fakeChat({ verdict: "ok" }),
    });

    expect(result).toEqual({ verdict: "ok" });
  });

  it("logs the call against the agent and the thread", async () => {
    await runAgent({
      key: "router",
      userPrompt: "Decide.",
      schemaName: "router",
      schema: SCHEMA,
      ticketId,
      graphThreadId: "thread-7",
      chat: fakeChat({ verdict: "answer" }),
    });

    const [log] = await db.select().from(llmLogs).where(eq(llmLogs.ticketId, ticketId));
    expect(log.graphThreadId).toBe("thread-7");
    expect(log.agentId).not.toBeNull();
    expect(log.model).toBe("gpt-4o-mini");
    expect(log.response).toBe('{"verdict":"answer"}');
  });

  it("refuses to run a disabled agent", async () => {
    await db.update(agents).set({ isEnabled: false }).where(eq(agents.key, "drafter"));
    const chat = fakeChat({ verdict: "ok" });

    await expect(
      runAgent({
        key: "drafter",
        userPrompt: "Write it.",
        schemaName: "drafter",
        schema: SCHEMA,
        ticketId,
        graphThreadId: "thread-1",
        chat,
      })
    ).rejects.toBeInstanceOf(AgentDisabledError);
    // isEnabled must be checked before the model is ever reached.
    expect(chat).not.toHaveBeenCalled();
  });

  it("fails when no deployment is resolvable", async () => {
    // The agent has no pinned deployment (cleared in beforeEach), and this
    // clears the active "chat" deployment too, so neither fallback resolves.
    await db.delete(aiDeployments);

    await expect(
      runAgent({
        key: "triage",
        userPrompt: "x",
        schemaName: "triage",
        schema: SCHEMA,
        ticketId,
        graphThreadId: "thread-1",
        chat: fakeChat({ verdict: "ok" }),
      })
    ).rejects.toThrow(/deployment/i);
  });
});
