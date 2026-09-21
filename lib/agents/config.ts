import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiDeployments, agentPromptVersions, agents } from "@/lib/db/schema";
import { getActiveDeployment } from "@/lib/ai/config";
import type { AgentKey } from "./prompts";

// Azure OpenAI rejects anything outside this range, and a caller passing 3
// should learn that at configuration time rather than mid-run.
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

export class AgentDisabledError extends Error {
  constructor(key: AgentKey) {
    super(`Agent "${key}" is disabled.`);
    this.name = "AgentDisabledError";
  }
}

export interface AgentConfig {
  id: string;
  key: AgentKey;
  name: string;
  description: string;
  aiDeploymentId: string | null;
  // Resolved: the pinned deployment if set, otherwise the active chat one.
  // Null when neither exists, which the caller surfaces as "not configured".
  deploymentName: string | null;
  temperature: number;
  isEnabled: boolean;
  prompt: string;
  promptVersion: number;
}

function selectAgentRows() {
  return db
    .select({
      id: agents.id,
      key: agents.key,
      name: agents.name,
      description: agents.description,
      aiDeploymentId: agents.aiDeploymentId,
      pinnedDeploymentName: aiDeployments.deploymentName,
      temperature: agents.temperature,
      isEnabled: agents.isEnabled,
      prompt: agentPromptVersions.content,
      promptVersion: agentPromptVersions.version,
    })
    .from(agents)
    .innerJoin(
      agentPromptVersions,
      and(
        eq(agentPromptVersions.agentId, agents.id),
        eq(agentPromptVersions.isActive, true)
      )
    )
    .leftJoin(aiDeployments, eq(aiDeployments.id, agents.aiDeploymentId));
}

function toConfig(
  row: Awaited<ReturnType<typeof selectAgentRows>>[number],
  fallbackDeploymentName: string | null
): AgentConfig {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    aiDeploymentId: row.aiDeploymentId,
    deploymentName: row.pinnedDeploymentName ?? fallbackDeploymentName,
    temperature: Number(row.temperature),
    isEnabled: row.isEnabled,
    prompt: row.prompt,
    promptVersion: row.promptVersion,
  };
}

export async function listAgentConfigs(): Promise<AgentConfig[]> {
  const [rows, chat] = await Promise.all([selectAgentRows(), getActiveDeployment("chat")]);
  return rows
    .map((row) => toConfig(row, chat?.deploymentName ?? null))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAgentConfig(key: AgentKey): Promise<AgentConfig> {
  const [rows, chat] = await Promise.all([
    selectAgentRows().where(eq(agents.key, key)),
    getActiveDeployment("chat"),
  ]);

  const row = rows[0];
  if (!row) {
    throw new Error(`Agent "${key}" is missing — has the latest migration run?`);
  }

  const config = toConfig(row, chat?.deploymentName ?? null);
  // Failing closed matters: a caller that silently skipped a disabled triage
  // or router step would produce confidently wrong behavior downstream.
  if (!config.isEnabled) {
    throw new AgentDisabledError(key);
  }
  return config;
}

export async function updateAgentConfig(
  key: AgentKey,
  input: { aiDeploymentId?: string | null; temperature?: number; isEnabled?: boolean }
): Promise<void> {
  if (
    input.temperature !== undefined &&
    (!Number.isFinite(input.temperature) ||
      input.temperature < MIN_TEMPERATURE ||
      input.temperature > MAX_TEMPERATURE)
  ) {
    throw new Error(
      `Agent temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}, got ${input.temperature}.`
    );
  }

  const updates: { aiDeploymentId?: string | null; temperature?: string; isEnabled?: boolean } = {};
  if (input.aiDeploymentId !== undefined) {
    updates.aiDeploymentId = input.aiDeploymentId;
  }
  if (input.temperature !== undefined) {
    updates.temperature = String(input.temperature);
  }
  if (input.isEnabled !== undefined) {
    updates.isEnabled = input.isEnabled;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  await db
    .update(agents)
    .set(updates)
    .where(eq(agents.key, key));
}
