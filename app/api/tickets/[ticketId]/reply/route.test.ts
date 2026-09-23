import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getTicketWithMessages: vi.fn(),
  runAgent: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock("@/lib/tickets/queries", () => ({
  getTicketWithMessages: mocks.getTicketWithMessages,
}));

vi.mock("@/lib/workflow/run-agent", () => ({
  runAgent: mocks.runAgent,
}));

vi.mock("@/lib/ai/chat", () => ({ azureChatClient: vi.fn() }));

function context(ticketId = "ticket-1") {
  return { params: Promise.resolve({ ticketId }) };
}

describe("POST /api/tickets/[ticketId]/reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1", role: "agent" } });
    mocks.getTicketWithMessages.mockResolvedValue({
      id: "ticket-1",
      subject: "Cannot sign in",
      requesterEmail: "customer@example.test",
      messages: [{ direction: "inbound", body: "I cannot sign in." }],
    });
  });

  it("returns the structured manual writer body so the draft editor receives it", async () => {
    mocks.runAgent.mockResolvedValue({ body: "Use the password reset link." });

    const response = await POST(
      new Request("http://localhost/api/tickets/ticket-1/reply", {
        method: "POST",
        body: JSON.stringify({ action: "draft" }),
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ body: "Use the password reset link." });
    expect(mocks.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "manual_writer",
        schemaName: "manual_reply_draft",
        schema: expect.objectContaining({
          required: ["body"],
          additionalProperties: false,
        }),
        userPrompt: expect.stringContaining("{\"body\":\"the complete email reply\"}"),
      })
    );
  });

  it("does not return an empty draft when the structured response has no body", async () => {
    mocks.runAgent.mockResolvedValue({ response: "Use the password reset link." });

    const response = await POST(
      new Request("http://localhost/api/tickets/ticket-1/reply", {
        method: "POST",
        body: JSON.stringify({ action: "draft" }),
      }),
      context()
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "The draft agent returned no email body. Try drafting again.",
    });
  });
});
