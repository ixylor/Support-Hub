import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kbChunks, kbEntries } from "@/lib/db/schema";
import { getActiveDeployment, getAzureCredentials } from "@/lib/ai/config";
import { QUEUES, enqueue } from "@/lib/jobs/boss";
import { SUPPORTED_CONTENT_TYPES, normalizeContentType } from "./parsers";
import { saveKbFile } from "./storage";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface KbEntrySummary {
  id: string;
  title: string;
  sourceType: string;
  tags: string[];
  status: string;
  errorMessage: string | null;
  chunkCount: number;
  updatedAt: Date;
}

// Tags are compared by equality in retrieval filters, so they are normalized on
// the way in rather than at every read site.
function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== "");
  return [...new Set(normalized)].sort();
}

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") {
    throw new Error("A title is required.");
  }
  return trimmed;
}

export async function knowledgeBaseReadiness(): Promise<{ ready: boolean; reason?: string }> {
  if (!(await getAzureCredentials())) {
    return {
      ready: false,
      reason: "Azure OpenAI credentials are not configured. Set them in Settings → AI Provider.",
    };
  }

  if (!(await getActiveDeployment("embedding"))) {
    return {
      ready: false,
      reason:
        "No active embedding deployment is configured. Add one in Settings → AI Provider.",
    };
  }

  return { ready: true };
}

export async function createUploadedEntry(input: {
  title: string;
  tags: string[];
  filename: string;
  contentType: string;
  content: Buffer;
  uploadedByUserId: string;
}): Promise<string> {
  const title = requireTitle(input.title);
  const contentType = normalizeContentType(input.contentType);
  const sourceType = SUPPORTED_CONTENT_TYPES[contentType];

  if (!sourceType) {
    throw new Error(`Files of type ${contentType} are not supported.`);
  }

  if (input.content.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File is too large. The limit is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`
    );
  }

  const [entry] = await db
    .insert(kbEntries)
    .values({
      title,
      sourceType,
      contentType,
      originalFilename: input.filename,
      sizeBytes: input.content.byteLength,
      tags: normalizeTags(input.tags),
      uploadedByUserId: input.uploadedByUserId,
    })
    .returning({ id: kbEntries.id });

  // The storage path is keyed by the entry id, so the row has to exist first.
  const storagePath = await saveKbFile(entry.id, input.filename, input.content);
  await db.update(kbEntries).set({ storagePath }).where(eq(kbEntries.id, entry.id));

  await enqueue(QUEUES.kbProcess, { entryId: entry.id });
  return entry.id;
}

export async function createArticleEntry(input: {
  title: string;
  tags: string[];
  body: string;
  uploadedByUserId: string;
}): Promise<string> {
  const title = requireTitle(input.title);

  const [entry] = await db
    .insert(kbEntries)
    .values({
      title,
      sourceType: "article",
      content: input.body,
      tags: normalizeTags(input.tags),
      uploadedByUserId: input.uploadedByUserId,
    })
    .returning({ id: kbEntries.id });

  await enqueue(QUEUES.kbProcess, { entryId: entry.id });
  return entry.id;
}

export async function listEntries(): Promise<KbEntrySummary[]> {
  return db
    .select({
      id: kbEntries.id,
      title: kbEntries.title,
      sourceType: kbEntries.sourceType,
      tags: kbEntries.tags,
      status: kbEntries.status,
      errorMessage: kbEntries.errorMessage,
      chunkCount: count(kbChunks.id),
      updatedAt: kbEntries.updatedAt,
    })
    .from(kbEntries)
    // Left join so an entry with no chunks still appears, counted as zero.
    .leftJoin(kbChunks, eq(kbChunks.kbEntryId, kbEntries.id))
    .groupBy(kbEntries.id)
    .orderBy(desc(kbEntries.updatedAt));
}

export async function listTags(): Promise<string[]> {
  const rows = await db.execute<{ tag: string }>(
    sql`SELECT DISTINCT unnest(tags) AS tag FROM kb_entries ORDER BY tag`
  );
  return rows.map((row) => row.tag);
}

export async function deleteEntry(id: string): Promise<void> {
  // kb_chunks cascades on the foreign key, so one delete is enough.
  await db.delete(kbEntries).where(eq(kbEntries.id, id));
}

export async function requeueEntry(id: string): Promise<void> {
  await db
    .update(kbEntries)
    .set({ status: "pending", errorMessage: null })
    .where(eq(kbEntries.id, id));
  await enqueue(QUEUES.kbProcess, { entryId: id });
}
