import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { listAgentConfigs, updateAgentConfig } from "@/lib/agents/config";
import { activateAgentPromptVersion } from "@/lib/agents/prompts";

const AGENT_KEYS = ["triage", "router", "info_requester", "drafter"] as const;
type AgentKey = (typeof AGENT_KEYS)[number];

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return null;
  }
  return session.user as { id: string };
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only admins can view agents." }, { status: 403 });
  }

  return NextResponse.json({ agents: await listAgentConfigs() });
}

export async function PUT(request: Request) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Only admins can edit agents." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { key, prompt, aiDeploymentId, temperature, isEnabled } = (body ?? {}) as {
    key?: unknown;
    prompt?: unknown;
    aiDeploymentId?: unknown;
    temperature?: unknown;
    isEnabled?: unknown;
  };

  if (typeof key !== "string" || !AGENT_KEYS.includes(key as AgentKey)) {
    return NextResponse.json(
      { error: `key must be one of: ${AGENT_KEYS.join(", ")}` },
      { status: 400 }
    );
  }

  // Validate everything before any mutations.
  let validatedPrompt: string | undefined;
  if (prompt !== undefined) {
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return NextResponse.json({ error: "prompt must be a non-empty string." }, { status: 400 });
    }
    validatedPrompt = prompt.trim();
  }

  // Validate each config field independently.
  const configUpdates: { aiDeploymentId?: string | null; temperature?: number; isEnabled?: boolean } = {};

  if (temperature !== undefined) {
    if (typeof temperature !== "number") {
      return NextResponse.json(
        { error: "temperature must be a number." },
        { status: 400 }
      );
    }
    configUpdates.temperature = temperature;
  }

  if (isEnabled !== undefined) {
    if (typeof isEnabled !== "boolean") {
      return NextResponse.json(
        { error: "isEnabled must be a boolean." },
        { status: 400 }
      );
    }
    configUpdates.isEnabled = isEnabled;
  }

  if (aiDeploymentId !== undefined) {
    if (aiDeploymentId !== null && typeof aiDeploymentId !== "string") {
      return NextResponse.json(
        { error: "aiDeploymentId must be a string or null." },
        { status: 400 }
      );
    }
    configUpdates.aiDeploymentId = aiDeploymentId;
  }

  // Return 400 if only key was supplied with no updatable fields.
  if (validatedPrompt === undefined && Object.keys(configUpdates).length === 0) {
    return NextResponse.json(
      { error: "Request must include at least one updatable field (prompt, temperature, isEnabled, or aiDeploymentId)." },
      { status: 400 }
    );
  }

  // Now perform mutations after all validation passes.
  if (validatedPrompt !== undefined) {
    // A new version is only cut when a prompt is actually supplied, so saving
    // a temperature change does not inflate the version history.
    await activateAgentPromptVersion(key as AgentKey, validatedPrompt, user.id);
  }

  if (Object.keys(configUpdates).length > 0) {
    try {
      await updateAgentConfig(key as AgentKey, configUpdates);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to update the agent." },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
