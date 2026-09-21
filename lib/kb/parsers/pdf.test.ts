import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { aiDeployments, appSecrets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import { activateDeployment, setAzureCredentials } from "@/lib/ai/config";
import { AiNotConfiguredError, PermanentAiError, RetryableAiError } from "@/lib/ai/errors";
import { pdfParser } from "./pdf";

function completion(text: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("pdf parser", () => {
  let adminId: string;
  let pdf: Buffer;

  beforeEach(async () => {
    pdf = await readFile(join(__dirname, "fixtures", "sample.pdf"));
    const [row] = await db
      .insert(user)
      .values({
        id: `pdf-test-${crypto.randomUUID()}`,
        name: "PDF Admin",
        email: `pdf-test-${crypto.randomUUID()}@example.com`,
        role: "admin",
      })
      .returning({ id: user.id });
    adminId = row.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(aiDeployments);
    await db.delete(appSecrets);
  });

  async function configure(): Promise<void> {
    await setAzureCredentials(
      { endpoint: "https://example.openai.azure.com", apiKey: "k", apiVersion: "2024-10-21" },
      adminId
    );
    await activateDeployment(
      { role: "extraction", deploymentName: "gpt-4.1", modelName: "gpt-4.1", dimensions: null },
      adminId
    );
  }

  it("claims application/pdf and nothing else", () => {
    expect(pdfParser.supports("application/pdf")).toBe(true);
    expect(pdfParser.supports("text/plain")).toBe(false);
  });

  it("throws AiNotConfiguredError when no extraction deployment is active", async () => {
    await setAzureCredentials(
      { endpoint: "https://example.openai.azure.com", apiKey: "k", apiVersion: "2024-10-21" },
      adminId
    );

    await expect(pdfParser.extract(pdf)).rejects.toThrow(AiNotConfiguredError);
  });

  it("returns the transcribed text", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      completion("Refunds are issued within fourteen days.")
    );

    expect(await pdfParser.extract(pdf)).toBe("Refunds are issued within fourteen days.");
  });

  it("posts to the extraction deployment's chat completions endpoint", async () => {
    await configure();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(completion("Refunds are issued within fourteen days."));

    await pdfParser.extract(pdf);

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      "https://example.openai.azure.com/openai/deployments/gpt-4.1/chat/completions?api-version=2024-10-21"
    );
  });

  it("treats 429 as retryable", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("slow down", { status: 429 }));

    await expect(pdfParser.extract(pdf)).rejects.toThrow(RetryableAiError);
  });

  it("treats 400 as permanent", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("file too large", { status: 400 })
    );

    await expect(pdfParser.extract(pdf)).rejects.toThrow(PermanentAiError);
  });

  it("returns empty string when the model transcribes nothing", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(completion("   "));

    expect(await pdfParser.extract(pdf)).toBe("");
  });

  it("rejects a response that looks like a summary rather than a transcription", async () => {
    await configure();
    // A refusal or summary is short and arrives where a full page was expected.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      completion("This document describes the company's refund policy.")
    );

    await expect(pdfParser.extract(pdf, { pageCount: 10 })).rejects.toThrow(/summar/i);
  });

  it("does not apply the summarisation guard when the page count is unknown", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(completion("Short but genuine."));

    expect(await pdfParser.extract(pdf)).toBe("Short but genuine.");
  });

  it("throws on a malformed response body", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 })
    );

    await expect(pdfParser.extract(pdf)).rejects.toThrow(PermanentAiError);
  });
});
