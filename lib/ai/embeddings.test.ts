import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { aiDeployments, appSecrets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import { activateDeployment, setAzureCredentials } from "./config";
import { AiNotConfiguredError, PermanentAiError, RetryableAiError } from "./errors";
import { EMBEDDING_BATCH_SIZE, embedTexts } from "./embeddings";

function vectorOf(seed: number): number[] {
  return Array.from({ length: 1536 }, () => seed);
}

function embeddingResponse(count: number, startSeed = 0): Response {
  return new Response(
    JSON.stringify({
      data: Array.from({ length: count }, (_, i) => ({
        index: i,
        embedding: vectorOf(startSeed + i),
      })),
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("embedTexts", () => {
  let adminId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(user)
      .values({
        id: `embeddings-test-${crypto.randomUUID()}`,
        name: "Embeddings Admin",
        email: `embeddings-test-${crypto.randomUUID()}@example.com`,
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
      {
        role: "embedding",
        deploymentName: "embed-deploy",
        modelName: "text-embedding-3-small",
        dimensions: 1536,
      },
      adminId
    );
  }

  it("throws AiNotConfiguredError when credentials are missing", async () => {
    await expect(embedTexts(["hello"])).rejects.toThrow(AiNotConfiguredError);
  });

  it("throws AiNotConfiguredError when no embedding deployment is active", async () => {
    await setAzureCredentials(
      { endpoint: "https://example.openai.azure.com", apiKey: "k", apiVersion: "2024-10-21" },
      adminId
    );

    await expect(embedTexts(["hello"])).rejects.toThrow(/embedding deployment/i);
  });

  it("returns an empty result without calling Azure for empty input", async () => {
    await configure();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await embedTexts([]);

    expect(result.embeddings).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the deployment's embeddings endpoint with the api-key header", async () => {
    await configure();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(embeddingResponse(1));

    await embedTexts(["hello"]);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      "https://example.openai.azure.com/openai/deployments/embed-deploy/embeddings?api-version=2024-10-21"
    );
    expect((init?.headers as Record<string, string>)["api-key"]).toBe("k");
    expect(JSON.parse(String(init?.body))).toEqual({ input: ["hello"] });
  });

  it("splits input into batches and preserves overall order", async () => {
    await configure();
    const total = EMBEDDING_BATCH_SIZE + 5;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(embeddingResponse(EMBEDDING_BATCH_SIZE, 0))
      .mockResolvedValueOnce(embeddingResponse(5, EMBEDDING_BATCH_SIZE));

    const result = await embedTexts(Array.from({ length: total }, (_, i) => `text ${i}`));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.embeddings).toHaveLength(total);
    expect(result.embeddings[0][0]).toBe(0);
    expect(result.embeddings[total - 1][0]).toBe(total - 1);
  });

  it("reorders results by the index Azure returns", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: vectorOf(1) },
            { index: 0, embedding: vectorOf(0) },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await embedTexts(["first", "second"]);

    expect(result.embeddings[0][0]).toBe(0);
    expect(result.embeddings[1][0]).toBe(1);
  });

  it("reports the model name from the active deployment", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(embeddingResponse(1));

    const result = await embedTexts(["hello"]);

    expect(result.modelName).toBe("text-embedding-3-small");
  });

  it("treats 429 as retryable", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("slow down", { status: 429 }));

    await expect(embedTexts(["hello"])).rejects.toThrow(RetryableAiError);
  });

  it("treats 503 as retryable", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(embedTexts(["hello"])).rejects.toThrow(RetryableAiError);
  });

  it("treats a network failure as retryable", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    await expect(embedTexts(["hello"])).rejects.toThrow(RetryableAiError);
  });

  it("treats 404 as permanent", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("deployment not found", { status: 404 })
    );

    await expect(embedTexts(["hello"])).rejects.toThrow(PermanentAiError);
  });

  it("rejects a vector of unexpected width", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }), { status: 200 })
    );

    await expect(embedTexts(["hello"])).rejects.toThrow(/1536/);
  });

  it("rejects a response missing an embedding for an input", async () => {
    await configure();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(embeddingResponse(1));

    await expect(embedTexts(["one", "two"])).rejects.toThrow(PermanentAiError);
  });
});
