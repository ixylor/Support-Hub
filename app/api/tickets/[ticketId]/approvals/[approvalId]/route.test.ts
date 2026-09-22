import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  decideApproval: vi.fn(),
  getApprovalForTicket: vi.fn(),
  enqueue: vi.fn(),
  canDecideApproval: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/workflow/approvals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workflow/approvals")>()),
  decideApproval: mocks.decideApproval,
  getApprovalForTicket: mocks.getApprovalForTicket,
}));
vi.mock("@/lib/jobs/boss", () => ({ enqueue: mocks.enqueue }));
vi.mock("@/lib/workflow/permissions", () => ({
  canDecideApproval: mocks.canDecideApproval,
}));

function post(body: unknown): Request {
  return new Request("http://localhost/api/tickets/t1/approvals/a1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ ticketId: "t1", approvalId: "a1" }) };

describe("POST /api/tickets/[ticketId]/approvals/[approvalId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
    mocks.getApprovalForTicket.mockResolvedValue({
      id: "a1",
      status: "pending",
      decision: null,
      editedBody: null,
      feedback: null,
      overrideAction: null,
    });
    mocks.canDecideApproval.mockResolvedValue(true);
  });

  it("rejects an anonymous caller", async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await POST(post({ decision: "approve" }), context)).status).toBe(401);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("rejects an approval that does not belong to the URL ticket", async () => {
    mocks.getApprovalForTicket.mockResolvedValue(null);

    expect((await POST(post({ decision: "approve" }), context)).status).toBe(404);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("rejects a reviewer who may not decide this ticket", async () => {
    mocks.canDecideApproval.mockResolvedValue(false);

    expect((await POST(post({ decision: "approve" }), context)).status).toBe(403);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const request = new Request("http://localhost/api/tickets/t1/approvals/a1", {
      method: "POST",
      body: "{",
    });

    expect((await POST(request, context)).status).toBe(400);
  });

  it("rejects an unknown decision", async () => {
    expect((await POST(post({ decision: "maybe" }), context)).status).toBe(400);
  });

  it("requires edited text for an edit", async () => {
    expect((await POST(post({ decision: "edit", editedBody: "  " }), context)).status).toBe(400);
  });

  it("requires a note for a rejection", async () => {
    expect((await POST(post({ decision: "reject_feedback" }), context)).status).toBe(400);
  });

  it("requires an action for an override", async () => {
    expect((await POST(post({ decision: "override" }), context)).status).toBe(400);
  });

  it("records the decision and queues the resume", async () => {
    const response = await POST(post({ decision: "approve" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.decideApproval).toHaveBeenCalledWith(
      "a1",
      { decision: "approve", editedBody: null, feedback: null, overrideAction: null },
      "user-1"
    );
    expect(mocks.enqueue).toHaveBeenCalledWith("workflow.resume", { approvalId: "a1" });
  });

  it("returns 409 when another reviewer already decided it", async () => {
    const { ApprovalAlreadyDecidedError } = await import("@/lib/workflow/approvals");
    mocks.decideApproval.mockRejectedValue(new ApprovalAlreadyDecidedError());

    expect((await POST(post({ decision: "approve" }), context)).status).toBe(409);
    expect(mocks.enqueue).toHaveBeenCalledWith("workflow.resume", { approvalId: "a1" });
  });

  it("requeues an already-recorded matching verdict", async () => {
    mocks.getApprovalForTicket.mockResolvedValue({
      id: "a1",
      status: "decided",
      decision: "edit",
      editedBody: "Reviewed reply",
      feedback: null,
      overrideAction: null,
    });

    const response = await POST(
      post({ decision: "edit", editedBody: "Reviewed reply" }),
      context
    );

    expect(response.status).toBe(200);
    expect(mocks.decideApproval).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith("workflow.resume", { approvalId: "a1" });
  });
});
