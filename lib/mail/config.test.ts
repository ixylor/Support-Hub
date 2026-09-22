import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { mailTransports } from "@/lib/db/schema";
import { createTestUser } from "@/lib/test-helpers/users";
import { getActiveTransport, getActiveTransportConfig, saveTransport } from "./config";

const CONFIG = {
  host: "smtp.example.test",
  port: 587,
  secure: false,
  username: "support@example.test",
  fromAddress: "support@example.test",
  fromName: "Example Support",
};

describe("mail transport config", () => {
  let userId: string;

  beforeEach(async () => {
    await db.delete(mailTransports);
    userId = await createTestUser();
  });

  it("returns null when nothing is configured", async () => {
    expect(await getActiveTransport()).toBeNull();
  });

  it("round-trips a saved transport, decrypting the password", async () => {
    await saveTransport({ kind: "smtp", name: "Primary", config: CONFIG, password: "hunter2" }, userId);

    const active = await getActiveTransport();
    expect(active?.config).toEqual(CONFIG);
    expect(active?.password).toBe("hunter2");
  });

  it("never stores the password in plaintext", async () => {
    await saveTransport({ kind: "smtp", name: "Primary", config: CONFIG, password: "hunter2" }, userId);

    const [row] = await db.select().from(mailTransports);
    expect(row.encryptedPassword).not.toContain("hunter2");
    expect(JSON.stringify(row.config)).not.toContain("hunter2");
  });

  it("omits the password from the API-safe read", async () => {
    await saveTransport({ kind: "smtp", name: "Primary", config: CONFIG, password: "hunter2" }, userId);

    const safe = await getActiveTransportConfig();
    expect(JSON.stringify(safe)).not.toContain("hunter2");
    expect(safe?.config.host).toBe("smtp.example.test");
  });

  it("saving again replaces the active row rather than adding a second", async () => {
    await saveTransport({ kind: "smtp", name: "Primary", config: CONFIG, password: "hunter2" }, userId);
    await saveTransport(
      { kind: "smtp", name: "Primary", config: { ...CONFIG, port: 465, secure: true }, password: null },
      userId
    );

    const rows = await db.select().from(mailTransports);
    expect(rows).toHaveLength(1);

    const active = await getActiveTransport();
    expect(active?.config.port).toBe(465);
    // A null password means "leave it alone" — the form never echoes it back.
    expect(active?.password).toBe("hunter2");
  });

  it("refuses a first save with no password", async () => {
    await expect(
      saveTransport({ kind: "smtp", name: "Primary", config: CONFIG, password: null }, userId)
    ).rejects.toThrow(/password/i);
  });
});
