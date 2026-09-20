import { EMBEDDING_DIMENSIONS, getActiveDeployment, getAzureCredentials } from "./config";
import { AiNotConfiguredError, PermanentAiError, RetryableAiError } from "./errors";

// Azure accepts up to 2048 inputs per embeddings request, but a smaller batch
// keeps any single retry cheap and stays well inside the token limit for
// chunk-sized text.
export const EMBEDDING_BATCH_SIZE = 96;

interface AzureEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function embedTexts(
  texts: string[]
): Promise<{ embeddings: number[][]; modelName: string }> {
  const credentials = await getAzureCredentials();
  if (!credentials) {
    throw new AiNotConfiguredError(
      "Azure OpenAI credentials are not configured. Set them in Settings → AI Provider."
    );
  }

  const deployment = await getActiveDeployment("embedding");
  if (!deployment) {
    throw new AiNotConfiguredError(
      "No active embedding deployment is configured. Add one in Settings → AI Provider."
    );
  }

  if (texts.length === 0) {
    return { embeddings: [], modelName: deployment.modelName };
  }

  const url = `${credentials.endpoint}/openai/deployments/${deployment.deploymentName}/embeddings?api-version=${credentials.apiVersion}`;
  const embeddings: number[][] = [];

  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "api-key": credentials.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ input: batch }),
      });
    } catch (error) {
      throw new RetryableAiError(
        `Embedding request failed to reach Azure: ${(error as Error).message}`
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const message = `Embedding request failed with ${response.status}: ${detail.slice(0, 500)}`;
      throw isRetryableStatus(response.status)
        ? new RetryableAiError(message)
        : new PermanentAiError(message);
    }

    const payload = (await response.json()) as AzureEmbeddingResponse;

    // Azure documents that `data` may arrive out of order, so index into a
    // fixed-size slot rather than trusting array position.
    const ordered: (number[] | undefined)[] = new Array(batch.length);
    for (const item of payload.data ?? []) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new PermanentAiError(
          `Expected ${EMBEDDING_DIMENSIONS}-dimension embeddings, got ${item.embedding.length}. Check the deployment's model.`
        );
      }
      ordered[item.index] = item.embedding;
    }

    for (let i = 0; i < batch.length; i++) {
      const vector = ordered[i];
      if (!vector) {
        throw new PermanentAiError(
          `Azure returned no embedding for input ${start + i}.`
        );
      }
      embeddings.push(vector);
    }
  }

  return { embeddings, modelName: deployment.modelName };
}
