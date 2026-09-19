import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

// Better Auth's default cookie name (no cookiePrefix/cookieName override is
// configured in lib/auth/server.ts) — see better-auth/dist/cookies/index.mjs.
const SESSION_COOKIE = "better-auth.session_token";

describe("dashboard proxy", () => {
  it("redirects to /login when there is no session cookie", () => {
    const response = proxy(new NextRequest("http://localhost:3000/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("passes through when a session cookie is present", () => {
    const response = proxy(
      new NextRequest("http://localhost:3000/dashboard", {
        headers: { cookie: `${SESSION_COOKIE}=some-token-value` },
      })
    );

    expect(response.status).toBe(200);
  });
});
