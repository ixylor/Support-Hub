import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = "0".repeat(64);
});

describe("secret encryption", () => {
  it("decrypts to the original plaintext", () => {
    const ciphertext = encryptSecret("a-client-secret-value");
    expect(decryptSecret(ciphertext)).toBe("a-client-secret-value");
  });

  it("rejects a tampered ciphertext", () => {
    const ciphertext = encryptSecret("a-client-secret-value");
    const [iv, authTag, data] = ciphertext.split(":");
    const tampered = [iv, authTag, data.slice(0, -2) + "00"].join(":");

    expect(() => decryptSecret(tampered)).toThrow();
  });
});
