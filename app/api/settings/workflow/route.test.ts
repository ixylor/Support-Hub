import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, updateWorkflowSettings } = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateWorkflowSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession } } }));
vi.mock("@/lib/workflow/settings", () => ({ updateWorkflowSettings }));

import { PUT } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/settings/workflow", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/settings/workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    updateWorkflowSettings.mockResolvedValue(undefined);
  });

  it("rejects non-admins", async () => {
    getSession.mockResolvedValue({ user: { id: "agent-1", role: "agent" } });

    const response = await PUT(request({ isEnabled: true, requireApproval: true, autoSendMinConfidence: 0.8 }));

    expect(response.status).toBe(403);
    expect(updateWorkflowSettings).not.toHaveBeenCalled();
  });

  it("rejects malformed settings", async () => {
    const response = await PUT(request({ isEnabled: true, requireApproval: "yes", autoSendMinConfidence: 0.8 }));

    expect(response.status).toBe(400);
    expect(updateWorkflowSettings).not.toHaveBeenCalled();
  });

  it("updates settings for an admin", async () => {
    const settings = { isEnabled: false, requireApproval: false, autoSendMinConfidence: 0.75 };

    const response = await PUT(request(settings));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(updateWorkflowSettings).toHaveBeenCalledWith(settings, "admin-1");
  });

  it("returns validation errors from the settings service", async () => {
    updateWorkflowSettings.mockRejectedValue(new Error("The confidence floor must be between 0 and 1."));

    const response = await PUT(request({ isEnabled: true, requireApproval: false, autoSendMinConfidence: 2 }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("confidence floor");
  });
});
