import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DIR = "./storage/attachments-test";

describe("attachment storage", () => {
  beforeEach(() => {
    vi.stubEnv("ATTACHMENTS_DIR", TEST_DIR);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("writes attachment content under a per-message directory and returns the path", async () => {
    const { saveAttachment } = await import("./attachment-storage");

    const path = await saveAttachment("msg-1", "log.txt", Buffer.from("hello"));

    expect(path).toContain("msg-1");
    expect(path).toContain("log.txt");
    expect((await readFile(path)).toString("utf8")).toBe("hello");
  });

  it("keeps attachments from different messages in separate directories", async () => {
    const { saveAttachment } = await import("./attachment-storage");

    const pathA = await saveAttachment("msg-a", "file.txt", Buffer.from("a"));
    const pathB = await saveAttachment("msg-b", "file.txt", Buffer.from("b"));

    expect(pathA).not.toBe(pathB);
    expect((await readFile(pathA)).toString("utf8")).toBe("a");
    expect((await readFile(pathB)).toString("utf8")).toBe("b");
  });
});
