import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readKbFile, saveKbFile } from "./storage";

describe("knowledge base storage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kb-storage-test-"));
    vi.stubEnv("KB_STORAGE_DIR", dir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a file under a directory named for the entry", async () => {
    const entryId = crypto.randomUUID();

    const path = await saveKbFile(entryId, "policy.pdf", Buffer.from("hello"));

    expect(path).toContain(entryId);
    expect(await readFile(path, "utf8")).toBe("hello");
  });

  it("reads a saved file back", async () => {
    const path = await saveKbFile(crypto.randomUUID(), "policy.pdf", Buffer.from("hello"));

    expect((await readKbFile(path)).toString("utf8")).toBe("hello");
  });

  it("rejects a filename that escapes the entry directory", async () => {
    await expect(
      saveKbFile(crypto.randomUUID(), "../escape.pdf", Buffer.from("x"))
    ).rejects.toThrow(/traversal|Invalid/i);
  });

  it("rejects an entry id that escapes the storage root", async () => {
    await expect(saveKbFile("../escape", "a.pdf", Buffer.from("x"))).rejects.toThrow(
      /traversal|Invalid/i
    );
  });

  it("refuses to read a path outside the storage root", async () => {
    await expect(readKbFile(join(dir, "..", "outside.pdf"))).rejects.toThrow(/outside/i);
  });
});
