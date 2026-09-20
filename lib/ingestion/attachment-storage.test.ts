import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
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

  it("sanitizes path traversal filenames and writes nothing outside the message directory", async () => {
    const { saveAttachment } = await import("./attachment-storage");

    const path = await saveAttachment("msg-1", "../../../../etc/passwd", Buffer.from("evil"));

    // Traversal attempt is neutralized: file saved with basename only
    expect(path).toContain("msg-1");
    expect(path).toContain("passwd");
    // Nothing outside the message directory
    const messageDir = resolve(TEST_DIR, "msg-1");
    expect(existsSync(resolve(messageDir, "..", "..", "etc", "passwd"))).toBe(false);
    expect(existsSync(resolve(messageDir, "..", "..", "..", "etc", "passwd"))).toBe(false);
  });

  it("sanitizes absolute path filenames and writes nothing outside the message directory", async () => {
    const { saveAttachment } = await import("./attachment-storage");

    const absolutePath = process.platform === "win32" ? "C:\\windows\\temp.txt" : "/etc/passwd";
    const path = await saveAttachment("msg-1", absolutePath, Buffer.from("evil"));

    // Absolute path is neutralized: file saved with basename only
    expect(path).toContain("msg-1");
    expect(path).toContain(process.platform === "win32" ? "temp.txt" : "passwd");
    // Nothing outside the message directory
    const messageDir = resolve(TEST_DIR, "msg-1");
    expect(existsSync(resolve(messageDir, "..", "..", "windows", "temp.txt"))).toBe(false);
    expect(existsSync(resolve(messageDir, "..", "..", "etc", "passwd"))).toBe(false);
  });

  it("rejects dot-only filenames and writes nothing outside the message directory", async () => {
    const { saveAttachment } = await import("./attachment-storage");

    await expect(saveAttachment("msg-1", ".", Buffer.from("evil"))).rejects.toThrow(/Invalid/);
    await expect(saveAttachment("msg-1", "..", Buffer.from("evil"))).rejects.toThrow(/Invalid/);

    const messageDir = resolve(TEST_DIR, "msg-1");
    expect(existsSync(messageDir)).toBe(true);
    const files = await readdir(messageDir).catch(() => []);
    expect(files).toHaveLength(0);
  });
});
