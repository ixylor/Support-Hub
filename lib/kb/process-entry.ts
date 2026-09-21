import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kbChunks, kbEntries } from "@/lib/db/schema";
import { embedTexts } from "@/lib/ai/embeddings";
import { AiNotConfiguredError, RetryableAiError } from "@/lib/ai/errors";
import { chunkText } from "./chunk";
import { getParser } from "./parsers";
import { readKbFile } from "./storage";

async function extractContent(entry: typeof kbEntries.$inferSelect): Promise<string> {
  // A typed-in article already holds its text; there is nothing to parse.
  if (entry.sourceType === "article") {
    return entry.content ?? "";
  }

  if (!entry.storagePath || !entry.contentType) {
    throw new Error("Uploaded entry is missing its stored file reference.");
  }

  const parser = getParser(entry.contentType);
  if (!parser) {
    throw new Error(`No parser is registered for ${entry.contentType}.`);
  }

  const buffer = await readKbFile(entry.storagePath);
  return parser.extract(buffer);
}

export async function processKbEntry(entryId: string): Promise<void> {
  const [entry] = await db.select().from(kbEntries).where(eq(kbEntries.id, entryId)).limit(1);
  if (!entry) return;

  await db
    .update(kbEntries)
    .set({ status: "processing", errorMessage: null })
    .where(eq(kbEntries.id, entryId));

  try {
    const content = (await extractContent(entry)).trim();

    if (content === "") {
      throw new Error(
        "The document contained no readable text. It may be empty or corrupt."
      );
    }

    const chunks = chunkText(content);
    const { embeddings, modelName } = await embedTexts(chunks);

    // Delete-then-insert inside one transaction: a reprocess replaces the
    // entry's chunks atomically, so there is never a window where the entry is
    // ready with half its chunks, and a failure leaves the old ones untouched.
    await db.transaction(async (tx) => {
      await tx.delete(kbChunks).where(eq(kbChunks.kbEntryId, entryId));

      if (chunks.length > 0) {
        await tx.insert(kbChunks).values(
          chunks.map((chunkTextValue, index) => ({
            kbEntryId: entryId,
            chunkIndex: index,
            chunkText: chunkTextValue,
            embedding: embeddings[index],
          }))
        );
      }

      await tx
        .update(kbEntries)
        .set({
          content,
          contentHash: createHash("sha256").update(content).digest("hex"),
          embeddingModel: modelName,
          status: "ready",
          errorMessage: null,
        })
        .where(eq(kbEntries.id, entryId));
    });
  } catch (error) {
    // Retryable failures are rethrown so pg-boss backs off and tries again; the
    // row stays `processing` because the attempt is not over.
    if (error instanceof RetryableAiError) {
      throw error;
    }

    // Everything else will fail identically next time, so record it where the
    // admin can see it instead of burning two more attempts.
    const message =
      error instanceof AiNotConfiguredError
        ? error.message
        : (error as Error).message || "Processing failed.";

    await db
      .update(kbEntries)
      .set({ status: "failed", errorMessage: message })
      .where(eq(kbEntries.id, entryId));
  }
}
