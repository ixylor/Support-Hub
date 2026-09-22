import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const getSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: () => getSession() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const verify = vi.fn();
const send = vi.fn();
const getMailTransport = vi.fn();
vi.mock("@/lib/mail/transports", () => ({
  getMailTransport: () => getMailTransport(),
}));

describe("/api/settings/email/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user-1", role: "admin", email: "admin@example.test" } });
    verify.mockResolvedValue(undefined);
    send.mockResolvedValue({ messageIdHeader: "<id@example.test>", providerMessageId: "<id@example.test>" });
    getMailTransport.mockResolvedValue({ verify, send });
  });

  it("refuses a non-admin", async () => {
    getSession.mockResolvedValue({ user: { id: "user-2", role: "agent", email: "agent@example.test" } });

    const response = await POST();

    expect(response.status).toBe(403);
    expect(getMailTransport).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request", async () => {
    getSession.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(403);
    expect(getMailTransport).not.toHaveBeenCalled();
  });

  it("sends a test email to the admin's address", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.test" })
    );
  });

  it("surfaces the transport's error message when getMailTransport throws", async () => {
    getMailTransport.mockRejectedValue(new Error("No transport is configured."));

    const response = await POST();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No transport is configured." });
  });

  it("surfaces the error message when verify fails", async () => {
    verify.mockRejectedValue(new Error("Connection refused"));

    const response = await POST();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Connection refused" });
    expect(send).not.toHaveBeenCalled();
  });

  it("surfaces the error message when send fails", async () => {
    send.mockRejectedValue(new Error("Authentication failed"));

    const response = await POST();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Authentication failed" });
  });
});
