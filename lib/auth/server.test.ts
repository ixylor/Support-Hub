import { describe, expect, it } from "vitest";
import { auth } from "./server";

describe("auth server", () => {
  it("creates a user with the default agent role on sign-up", async () => {
    const email = `test-${crypto.randomUUID()}@example.com`;
    const result = await auth.api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Test Agent" },
    });

    expect(result.user.email).toBe(email);
    expect((result.user as { role: string }).role).toBe("agent");
  });
});
