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

  if (prompt !== undefined) {
    if (typeof prompt !== "string" || prompt.trim() === "") {
      return NextResponse.json({ error: "prompt must be a non-empty string." }, { status: 400 });
    }
    // A new version is only cut when a prompt is actually supplied, so saving
    // a temperature change does not inflate the version history.
    await activateAgentPromptVersion(key as AgentKey, prompt.trim(), user.id);
  }

  if (temperature !== undefined || aiDeploymentId !== undefined || isEnabled !== undefined) {
    if (typeof temperature !== "number" || typeof isEnabled !== "boolean") {
      return NextResponse.json(
        { error: "temperature must be a number and isEnabled a boolean." },
        { status: 400 }
      );
    }
    if (aiDeploymentId !== null && typeof aiDeploymentId !== "string") {
      return NextResponse.json(
        { error: "aiDeploymentId must be a string or null." },
        { status: 400 }
      );
    }

    try {
      await updateAgentConfig(key as AgentKey, { aiDeploymentId, temperature, isEnabled });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to update the agent." },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
