import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { auth } from "@/lib/auth/server";
import { proxy } from "./proxy";

describe("dashboard proxy", () => {
  it("redirects to /login when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);

    const response = await proxy(
      new NextRequest("http://localhost:3000/dashboard")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("passes through when a session exists", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce({
      user: { id: "1", role: "agent" },
    } as never);

    const response = await proxy(
      new NextRequest("http://localhost:3000/dashboard")
    );

    expect(response.status).toBe(200);
  });

  it("redirects to /login when session lookup fails", async () => {
    vi.mocked(auth.api.getSession).mockRejectedValueOnce(
      new Error("Auth service unavailable")
    );

    const response = await proxy(
      new NextRequest("http://localhost:3000/dashboard")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });
});
