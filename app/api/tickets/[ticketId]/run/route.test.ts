import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  enqueue: vi.fn(),
  db: { select: vi.fn() },
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/jobs/boss", () => ({ enqueue: mocks.enqueue }));
vi.mock("@/lib/db/client", () => ({ db: mocks.db }));

const request = new Request("http://localhost/api/tickets/t1/run", { method: "POST" });
const context = { params: Promise.resolve({ ticketId: "t1" }) };

describe("POST /api/tickets/[ticketId]/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "admin-1", role: "admin" } });
    let selectCount = 0;
    mocks.db.select.mockImplementation(() => {
      const rows = selectCount++ === 0 ? [{ id: "t1" }] : [];
      const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => rows };
      return chain;
    });
  });

  it("rejects a non-admin", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "agent-1", role: "agent" } });

    expect((await POST(request, context)).status).toBe(403);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("queues a manual workflow run", async () => {
    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledWith("workflow.run", {
      ticketId: "t1",
      trigger: "manual",
    });
  });

  it("rejects an unknown ticket", async () => {
    mocks.db.select.mockImplementation(() => {
      const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [] };
      return chain;
    });

    const response = await POST(request, context);

    expect(response.status).toBe(404);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
