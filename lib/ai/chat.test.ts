import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermanentAiError, RetryableAiError } from "./errors";
import { azureChatClient } from "./chat";

vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  getAzureCredentials: async () => ({
    endpoint: "https://example.openai.azure.test",
    apiKey: "key",
    apiVersion: "2024-10-21",
  }),
}));

const REQUEST = {
  deploymentName: "gpt-4o-mini-dep",
  systemPrompt: "You classify email.",
  userPrompt: "Login is broken.",
  temperature: 0,
  schemaName: "triage",
  schema: {
    type: "object",
    properties: { isGenuine: { type: "boolean" } },
    required: ["isGenuine"],
    additionalProperties: false,
  },
};

function azureResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], model: "gpt-4o-mini" }),
    { status }
  );
}

describe("azure chat client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the structured response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(azureResponse('{"isGenuine":true}')));

    const result = await azureChatClient<{ isGenuine: boolean }>(REQUEST);

    expect(result.data).toEqual({ isGenuine: true });
    expect(result.modelName).toBe("gpt-4o-mini");
    expect(result.rawResponse).toBe('{"isGenuine":true}');
  });

  it("sends the schema so the model must conform", async () => {
    const fetchMock = vi.fn().mockResolvedValue(azureResponse('{"isGenuine":true}'));
    vi.stubGlobal("fetch", fetchMock);

    await azureChatClient(REQUEST);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.temperature).toBe(0);
  });

  it("treats a 429 as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })));

    await expect(azureChatClient(REQUEST)).rejects.toBeInstanceOf(RetryableAiError);
  });

  it("treats a 400 as permanent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad deployment", { status: 400 })));

    await expect(azureChatClient(REQUEST)).rejects.toBeInstanceOf(PermanentAiError);
  });

  it("treats unparseable content as permanent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(azureResponse("not json at all")));

    await expect(azureChatClient(REQUEST)).rejects.toBeInstanceOf(PermanentAiError);
  });

  it("treats a network failure as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(azureChatClient(REQUEST)).rejects.toBeInstanceOf(RetryableAiError);
  });
});
