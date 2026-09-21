import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { embedTexts } from "@/lib/ai/embeddings";
import { normalizeTags } from "./tags";

export interface KbSearchResult {
  chunkId: string;
  entryId: string;
  title: string;
  tags: string[];
  chunkText: string;
  score: number;
}

// How many candidates each arm contributes before fusion. Wide enough that a
// result ranked poorly by one arm can still win on the other.
const ARM_LIMIT = 30;
const DEFAULT_LIMIT = 8;

// Reciprocal Rank Fusion's damping constant. 60 is the value from the original
// paper and keeps a strong result in one arm from dominating outright.
const RRF_K = 60;

export async function searchKnowledgeBase(input: {
  query: string;
  tags?: string[];
  limit?: number;
}): Promise<KbSearchResult[]> {
  const query = input.query.trim();
  if (query === "") return [];

  const limit = input.limit ?? DEFAULT_LIMIT;
  // Callers may pass tags straight from user input (e.g. an upcoming skill),
  // not only the already-normalized values listTags() returns.
  const normalizedTags = input.tags ? normalizeTags(input.tags) : [];
  const tags = normalizedTags.length ? normalizedTags : null;

  const { embeddings } = await embedTexts([query]);
  const queryVector = JSON.stringify(embeddings[0]);

  // Both arms run as CTEs in one statement so retrieval is a single round trip.
  // Written as raw SQL because Drizzle cannot express the vector distance
  // operator and ts_rank together with window functions.
  const rows = await db.execute<{
    chunk_id: string;
    entry_id: string;
    title: string;
    tags: string[];
    chunk_text: string;
    score: number;
  }>(sql`
    WITH eligible AS (
      SELECT c.id, c.chunk_text, c.embedding, c.search_vector, e.id AS entry_id, e.title, e.tags
      FROM kb_chunks c
      JOIN kb_entries e ON e.id = c.kb_entry_id
      WHERE e.status = 'ready'
        AND c.embedding IS NOT NULL
        -- sql.param() keeps the array a single bound parameter for postgres.js
        -- to serialize as a Postgres array; interpolating it directly would
        -- have drizzle spread it into a "(a, b, c)" list instead.
        AND (${sql.param(tags)}::text[] IS NULL OR e.tags && ${sql.param(tags)}::text[])
    ),
    vector_arm AS (
      SELECT id, row_number() OVER (ORDER BY embedding <=> ${queryVector}::vector) AS rank
      FROM eligible
      ORDER BY embedding <=> ${queryVector}::vector
      LIMIT ${ARM_LIMIT}
    ),
    text_arm AS (
      SELECT id,
             row_number() OVER (
               ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${query})) DESC
             ) AS rank
      FROM eligible
      WHERE search_vector @@ plainto_tsquery('english', ${query})
      ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${query})) DESC
      LIMIT ${ARM_LIMIT}
    ),
    fused AS (
      SELECT id, SUM(contribution) AS score
      FROM (
        SELECT id, 1.0 / (${RRF_K} + rank) AS contribution FROM vector_arm
        UNION ALL
        SELECT id, 1.0 / (${RRF_K} + rank) AS contribution FROM text_arm
      ) contributions
      GROUP BY id
    )
    SELECT e.id AS chunk_id,
           e.entry_id,
           e.title,
           e.tags,
           e.chunk_text,
           f.score::float8 AS score
    FROM fused f
    JOIN eligible e ON e.id = f.id
    ORDER BY f.score DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    entryId: row.entry_id,
    title: row.title,
    tags: row.tags,
    chunkText: row.chunk_text,
    score: row.score,
  }));
}
