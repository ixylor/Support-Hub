import { getAzureCredentials } from "./config";
import { AiNotConfiguredError, PermanentAiError, RetryableAiError } from "./errors";

export interface ChatRequest {
  deploymentName: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  schemaName: string;
  // A JSON Schema object. Azure requires additionalProperties: false and
  // every property listed in `required` when strict mode is on.
  schema: Record<string, unknown>;
}

export interface ChatResult<T> {
  data: T;
  rawResponse: string;
  modelName: string;
}

// Injected at graph construction so tests substitute a fake without
// intercepting fetch.
export type ChatClient = <T>(request: ChatRequest) => Promise<ChatResult<T>>;

interface AzureChatResponse {
  choices: Array<{ message: { content: string | null } }>;
  model: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export const azureChatClient: ChatClient = async <T>(
  request: ChatRequest
): Promise<ChatResult<T>> => {
  const credentials = await getAzureCredentials();
  if (!credentials) {
    throw new AiNotConfiguredError(
      "Azure OpenAI credentials are not configured. Set them in Settings → AI Provider."
    );
  }

  const url = `${credentials.endpoint}/openai/deployments/${request.deploymentName}/chat/completions?api-version=${credentials.apiVersion}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "api-key": credentials.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        temperature: request.temperature,
        response_format: {
          type: "json_schema",
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
      }),
    });
  } catch (error) {
    throw new RetryableAiError(`Chat request failed to reach Azure: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = `Chat request failed with ${response.status}: ${detail.slice(0, 500)}`;
    throw isRetryableStatus(response.status)
      ? new RetryableAiError(message)
      : new PermanentAiError(message);
  }

  const payload = (await response.json()) as AzureChatResponse;
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    // A refusal or a content filter lands here. Retrying produces the same
    // result, so it is permanent.
    throw new PermanentAiError("Azure returned a chat completion with no content.");
  }

  let data: T;
  try {
    data = JSON.parse(content) as T;
  } catch {
    throw new PermanentAiError(
      `Azure returned content that is not valid JSON: ${content.slice(0, 200)}`
    );
  }

  return { data, rawResponse: content, modelName: payload.model };
};
