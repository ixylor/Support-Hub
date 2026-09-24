import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { kbChunks, kbEntries } from "@/lib/db/schema";
import { getActiveDeployment, getAzureCredentials } from "@/lib/ai/config";
import { QUEUES, enqueue } from "@/lib/jobs/boss";
import { normalizeTags } from "./tags";

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

export async function createArticleEntry(input: {
  title: string;
  tags: string[];
  body: string;
  uploadedByUserId: string;
}): Promise<string> {
  const title = requireTitle(input.title);
  const content = input.body.trim();
  if (content === "") {
    throw new Error("Article text is required.");
  }

  const [entry] = await db
    .insert(kbEntries)
    .values({
      title,
      sourceType: "article",
      content,
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
  // kb_chunks cascades on the foreign key, so one delete is enough for the rows.
  await db.delete(kbEntries).where(eq(kbEntries.id, id));
}

export async function requeueEntry(id: string): Promise<void> {
  await db
    .update(kbEntries)
    .set({ status: "pending", errorMessage: null })
    .where(eq(kbEntries.id, id));
  await enqueue(QUEUES.kbProcess, { entryId: id });
}
