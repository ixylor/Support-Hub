import { db } from "@/lib/db/client";
import { llmLogs } from "@/lib/db/schema";
import { getAgentConfig } from "@/lib/agents/config";
import type { AgentKey } from "@/lib/agents/prompts";
import { AiNotConfiguredError } from "@/lib/ai/errors";
import type { ChatClient } from "@/lib/ai/chat";

export interface RunAgentInput {
  key: AgentKey;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  ticketId: string;
  graphThreadId: string;
  chat: ChatClient;
}

export async function runAgent<T>(input: RunAgentInput): Promise<T> {
  // Throws AgentDisabledError when the agent is off. Failing closed is
  // deliberate: routing around a missing triage step would produce
  // confidently wrong behavior downstream.
  const agent = await getAgentConfig(input.key);

  if (!agent.deploymentName) {
    throw new AiNotConfiguredError(
      `Agent "${input.key}" has no deployment, and no active chat deployment is configured. Set one in Settings → AI Provider.`
    );
  }

  const result = await input.chat<T>({
    deploymentName: agent.deploymentName,
    systemPrompt: agent.prompt,
    userPrompt: input.userPrompt,
    temperature: agent.temperature,
    schemaName: input.schemaName,
    schema: input.schema,
  });

  // Logged after the call rather than around it: a failed call throws a typed
  // error the handler acts on, and a log row for a request that produced
  // nothing would only pollute the per-agent cost trail.
  await db.insert(llmLogs).values({
    ticketId: input.ticketId,
    agentId: agent.id,
    graphThreadId: input.graphThreadId,
    prompt: `${agent.prompt}\n\n---\n\n${input.userPrompt}`,
    response: result.rawResponse,
    model: result.modelName,
  });

  return result.data;
}
