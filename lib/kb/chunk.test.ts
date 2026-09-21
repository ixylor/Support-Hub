import { describe, expect, it } from "vitest";
import { CHUNK_OVERLAP, CHUNK_SIZE, chunkText } from "./chunk";

const sentence = "Refunds are issued within fourteen days of the original purchase date. ";

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    expect(chunkText("Short policy.")).toEqual(["Short policy."]);
  });

  it("never emits a chunk longer than the chunk size", () => {
    const chunks = chunkText(sentence.repeat(200));

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("splits long text into more than one chunk", () => {
    expect(chunkText(sentence.repeat(200)).length).toBeGreaterThan(1);
  });

  it("overlaps consecutive chunks", () => {
    const chunks = chunkText(sentence.repeat(200));
    const tail = chunks[0].slice(-40);

    expect(chunks[1]).toContain(tail);
  });

  it("prefers paragraph boundaries when splitting", () => {
    const paragraph = `${sentence.repeat(8)}\n\n`;
    const chunks = chunkText(paragraph.repeat(4));

    // A chunk that ended mid-paragraph would end without sentence punctuation.
    expect(chunks[0].trimEnd().endsWith(".")).toBe(true);
  });

  it("splits a single oversized paragraph that has no sentence breaks", () => {
    const chunks = chunkText("x".repeat(CHUNK_SIZE * 3));

    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("emits no empty chunks", () => {
    for (const chunk of chunkText(sentence.repeat(200))) {
      expect(chunk.trim()).not.toBe("");
    }
  });

  it("preserves the full text across chunks", () => {
    const text = sentence.repeat(50);
    const joined = chunkText(text).join(" ");

    for (const word of ["Refunds", "fourteen", "purchase"]) {
      expect(joined).toContain(word);
    }
  });

  it("makes progress rather than looping when overlap exceeds a chunk", () => {
    expect(CHUNK_OVERLAP).toBeLessThan(CHUNK_SIZE);
    expect(chunkText("y".repeat(CHUNK_SIZE * 2)).length).toBeLessThan(100);
  });
});
