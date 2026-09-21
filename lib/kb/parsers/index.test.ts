import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_CONTENT_TYPES, getParser } from "./index";

const fixture = (name: string) => readFile(join(__dirname, "fixtures", name));

describe("parser registry", () => {
  it("returns a parser for every supported content type", () => {
    for (const contentType of Object.keys(SUPPORTED_CONTENT_TYPES)) {
      expect(getParser(contentType)).not.toBeNull();
    }
  });

  it("returns null for an unsupported content type", () => {
    expect(getParser("image/png")).toBeNull();
  });

  it("ignores content type parameters such as charset", () => {
    expect(getParser("text/plain; charset=utf-8")).not.toBeNull();
  });

  it("maps content types to the right source type", () => {
    expect(SUPPORTED_CONTENT_TYPES["text/markdown"]).toBe("markdown");
    expect(SUPPORTED_CONTENT_TYPES["text/plain"]).toBe("text");
    expect(
      SUPPORTED_CONTENT_TYPES[
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ]
    ).toBe("docx");
  });
});

describe("text parser", () => {
  it("extracts plain text verbatim", async () => {
    const parser = getParser("text/plain")!;
    const text = await parser.extract(await fixture("sample.txt"));

    expect(text).toContain("Refunds are issued within fourteen days.");
  });

  it("extracts markdown as-is, preserving its source", async () => {
    const parser = getParser("text/markdown")!;
    const text = await parser.extract(await fixture("sample.md"));

    expect(text).toContain("# Refund Policy");
  });

  it("rejects a buffer that is not valid UTF-8 text", async () => {
    const parser = getParser("text/plain")!;

    await expect(parser.extract(Buffer.from([0xff, 0xfe, 0x00, 0x01]))).rejects.toThrow(
      /text/i
    );
  });
});

describe("docx parser", () => {
  it("extracts paragraph text", async () => {
    const parser = getParser(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )!;
    const text = await parser.extract(await fixture("sample.docx"));

    expect(text).toContain("Refunds are issued within fourteen days.");
  });

  it("throws on a file that is not a valid docx", async () => {
    const parser = getParser(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )!;

    await expect(parser.extract(Buffer.from("not a docx"))).rejects.toThrow();
  });
});
