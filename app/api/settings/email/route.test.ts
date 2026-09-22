import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";

const getSession = vi.fn();
vi.mock("@/lib/auth/server", () => ({ auth: { api: { getSession: () => getSession() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const saveTransport = vi.fn();
const getActiveTransportConfig = vi.fn();
vi.mock("@/lib/mail/config", () => ({
  saveTransport: (...args: unknown[]) => saveTransport(...args),
  getActiveTransportConfig: () => getActiveTransportConfig(),
}));

const VALID_CONFIG = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  username: "support@example.test",
  fromAddress: "support@example.test",
  fromName: "Example Support",
};

function put(body: unknown): Request {
  return new Request("http://localhost/api/settings/email", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("/api/settings/email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user-1", role: "admin" } });
    getActiveTransportConfig.mockResolvedValue(null);
  });

  it("refuses a non-admin", async () => {
    getSession.mockResolvedValue({ user: { id: "user-2", role: "agent" } });

    expect((await GET()).status).toBe(403);
    expect((await PUT(put({ name: "Primary", config: VALID_CONFIG, password: "x" }))).status).toBe(403);
    expect(saveTransport).not.toHaveBeenCalled();
  });

  it("saves a valid configuration", async () => {
    const response = await PUT(put({ name: "Primary", config: VALID_CONFIG, password: "hunter2" }));

    expect(response.status).toBe(200);
    expect(saveTransport).toHaveBeenCalledWith(
      { kind: "smtp", name: "Primary", config: VALID_CONFIG, password: "hunter2" },
      "user-1"
    );
  });

  it("treats an omitted password as keep-existing", async () => {
    await PUT(put({ name: "Primary", config: VALID_CONFIG }));

    expect(saveTransport).toHaveBeenCalledWith(
      expect.objectContaining({ password: null }),
      "user-1"
    );
  });

  it("rejects a non-numeric port", async () => {
    const response = await PUT(
      put({ name: "Primary", config: { ...VALID_CONFIG, port: "587" }, password: "x" })
    );

    expect(response.status).toBe(400);
    expect(saveTransport).not.toHaveBeenCalled();
  });

  it("rejects a from address that is not an address", async () => {
    const response = await PUT(
      put({ name: "Primary", config: { ...VALID_CONFIG, fromAddress: "not-an-address" }, password: "x" })
    );

    expect(response.status).toBe(400);
  });

  it("never returns the password", async () => {
    getActiveTransportConfig.mockResolvedValue({
      id: "t-1",
      kind: "smtp",
      name: "Primary",
      config: VALID_CONFIG,
    });

    const body = await (await GET()).text();

    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("password");
  });
});
