import { describe, expect, it, vi, beforeEach } from "vitest";
import { PUT } from "./route";

const getSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: () => getSession() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const activateAgentPromptVersion = vi.fn();
const updateAgentConfig = vi.fn();
const listAgentConfigs = vi.fn();
vi.mock("@/lib/agents/prompts", () => ({
  activateAgentPromptVersion: (...args: unknown[]) => activateAgentPromptVersion(...args),
}));
vi.mock("@/lib/agents/config", () => ({
  updateAgentConfig: (...args: unknown[]) => updateAgentConfig(...args),
  listAgentConfigs: vi.fn(),
}));

function request(body: unknown): Request {
  return new Request("http://localhost/api/settings/agents", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("PUT /api/settings/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
  });

  it("refuses a non-admin", async () => {
    getSession.mockResolvedValue({ user: { id: "user-2", role: "agent" } });

    const response = await PUT(request({ key: "triage", isEnabled: false }));

    expect(response.status).toBe(403);
    expect(updateAgentConfig).not.toHaveBeenCalled();
  });

  it("rejects an unknown agent key", async () => {
    const response = await PUT(request({ key: "not_an_agent", isEnabled: true }));

    expect(response.status).toBe(400);
  });

  it("activates a new prompt version only when the prompt changed", async () => {
    const response = await PUT(request({ key: "triage", aiDeploymentId: null, temperature: 0.1, isEnabled: true }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(activateAgentPromptVersion).not.toHaveBeenCalled();
    expect(updateAgentConfig).toHaveBeenCalledWith("triage", {
      aiDeploymentId: null,
      temperature: 0.1,
      isEnabled: true,
    });
  });

  it("activates a new prompt version when one is supplied", async () => {
    const response = await PUT(request({ key: "drafter", prompt: "  a new prompt  " }));

    expect(response.status).toBe(200);
    expect(activateAgentPromptVersion).toHaveBeenCalledWith("drafter", "a new prompt", "user-1");
  });

  it("rejects a blank prompt rather than storing it", async () => {
    const response = await PUT(request({ key: "drafter", prompt: "   " }));

    expect(response.status).toBe(400);
    expect(activateAgentPromptVersion).not.toHaveBeenCalled();
  });

  it("accepts a single-field partial update", async () => {
    const response = await PUT(request({ key: "triage", isEnabled: false }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(updateAgentConfig).toHaveBeenCalledWith("triage", { isEnabled: false });
    expect(activateAgentPromptVersion).not.toHaveBeenCalled();
  });

  it("accepts a partial update with two fields", async () => {
    const response = await PUT(request({ key: "triage", temperature: 0.5, isEnabled: false }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(updateAgentConfig).toHaveBeenCalledWith("triage", { temperature: 0.5, isEnabled: false });
  });

  it("validates all fields before any mutation when multiple fields are supplied", async () => {
    const response = await PUT(request({ key: "triage", prompt: "new text", temperature: "not-a-number" }));

    expect(response.status).toBe(400);
    expect(activateAgentPromptVersion).not.toHaveBeenCalled();
    expect(updateAgentConfig).not.toHaveBeenCalled();
  });

  it("rejects a request with only key and no updatable fields", async () => {
    const response = await PUT(request({ key: "triage" }));

    expect(response.status).toBe(400);
    expect(updateAgentConfig).not.toHaveBeenCalled();
    expect(activateAgentPromptVersion).not.toHaveBeenCalled();
  });
});
