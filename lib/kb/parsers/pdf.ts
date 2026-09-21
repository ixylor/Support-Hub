// Request shape confirmed against the chat-completions `file` content-part
// documented for Azure OpenAI; not yet verified against a live deployment
// (Azure credentials are only enterable via the AI Provider page, added in a
// later phase). Revisit once that page exists.
import { getActiveDeployment, getAzureCredentials } from "@/lib/ai/config";
import { AiNotConfiguredError, PermanentAiError, RetryableAiError } from "@/lib/ai/errors";
import type { DocumentParser } from "./parser";

// A chat model asked to read a document will happily summarise it instead of
// transcribing it, and a summary indexed as source material poisons every
// future retrieval from that document. When the page count is known, output
// below this many characters per page is treated as a failed transcription.
export const MIN_CHARS_PER_PAGE = 120;

const TRANSCRIPTION_PROMPT = [
  "Transcribe this document to plain text, verbatim.",
  "Reproduce every word in reading order, preserving headings, lists and table contents.",
  "Do not summarise, paraphrase, translate, comment, or add any text of your own.",
  "If a page is blank, output nothing for it.",
].join(" ");

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export const pdfParser: DocumentParser & {
  extract(buffer: Buffer, options?: { pageCount?: number }): Promise<string>;
} = {
  supports(contentType) {
    return contentType === "application/pdf";
  },

  async extract(buffer: Buffer, options: { pageCount?: number } = {}) {
    const credentials = await getAzureCredentials();
    if (!credentials) {
      throw new AiNotConfiguredError(
        "Azure OpenAI credentials are not configured. Set them in Settings → AI Provider."
      );
    }

    const deployment = await getActiveDeployment("extraction");
    if (!deployment) {
      throw new AiNotConfiguredError(
        "No active extraction deployment is configured. Add one in Settings → AI Provider."
      );
    }

    const url = `${credentials.endpoint}/openai/deployments/${deployment.deploymentName}/chat/completions?api-version=${credentials.apiVersion}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "api-key": credentials.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: TRANSCRIPTION_PROMPT },
                {
                  type: "file",
                  file: {
                    filename: "document.pdf",
                    file_data: `data:application/pdf;base64,${buffer.toString("base64")}`,
                  },
                },
              ],
            },
          ],
          temperature: 0,
        }),
      });
    } catch (error) {
      throw new RetryableAiError(
        `PDF extraction failed to reach Azure: ${(error as Error).message}`
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const message = `PDF extraction failed with ${response.status}: ${detail.slice(0, 500)}`;
      throw isRetryableStatus(response.status)
        ? new RetryableAiError(message)
        : new PermanentAiError(message);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new PermanentAiError("Azure returned no transcription for the document.");
    }

    const text = content.trim();

    if (
      text.length > 0 &&
      options.pageCount !== undefined &&
      text.length < options.pageCount * MIN_CHARS_PER_PAGE
    ) {
      throw new PermanentAiError(
        `Extraction returned ${text.length} characters for ${options.pageCount} pages, which suggests the model summarised the document rather than transcribing it.`
      );
    }

    return text;
  },
};
