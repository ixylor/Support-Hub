import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kbChunks, kbEntries } from "@/lib/db/schema";
import { embedTexts } from "@/lib/ai/embeddings";
import { AiNotConfiguredError, RetryableAiError } from "@/lib/ai/errors";
import { chunkText } from "./chunk";

// Shared by the normal permanent-failure path below and by the job handler,
// which calls this once pg-boss has exhausted its retries on a
// RetryableAiError so the failure lands on the entry instead of only in logs.
export async function markKbEntryFailed(entryId: string, message: string): Promise<void> {
  await db
    .update(kbEntries)
    .set({ status: "failed", errorMessage: message })
    .where(eq(kbEntries.id, entryId));
}

export async function processKbEntry(entryId: string): Promise<void> {
  const [entry] = await db.select().from(kbEntries).where(eq(kbEntries.id, entryId)).limit(1);
  if (!entry) return;

  await db
    .update(kbEntries)
    .set({ status: "processing", errorMessage: null })
    .where(eq(kbEntries.id, entryId));

  try {
    const content = (entry.content ?? "").trim();

    if (content === "") {
      throw new Error(
        "Article text is empty. Add text before processing it."
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

    await markKbEntryFailed(entryId, message);
  }
}
