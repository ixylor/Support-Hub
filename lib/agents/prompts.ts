import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentPromptVersions, agents } from "@/lib/db/schema";

export type AgentKey = (typeof agents.key.enumValues)[number];

async function getAgentId(key: AgentKey): Promise<string> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.key, key)).limit(1);
  if (!row) {
    // The seeded rows are created by migration, so a miss means the database is
    // behind the code rather than that the caller passed something invalid.
    throw new Error(`Agent "${key}" is missing — has the latest migration run?`);
  }
  return row.id;
}

export async function activateAgentPromptVersion(
  key: AgentKey,
  content: string,
  updatedByUserId: string
): Promise<void> {
  const agentId = await getAgentId(key);

  await db.transaction(async (tx) => {
    // Serializes concurrent activations for the same agent so the
    // read-then-write below can't race: without this, two callers could both
    // read the same "previous version" and both insert, producing duplicate
    // active rows. Released automatically at transaction end.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`agent_prompt:${agentId}`}))`);

    const [previous] = await tx
      .select({ version: agentPromptVersions.version })
      .from(agentPromptVersions)
      .where(eq(agentPromptVersions.agentId, agentId))
      .orderBy(desc(agentPromptVersions.version))
      .limit(1);

    await tx
      .update(agentPromptVersions)
      .set({ isActive: false })
      .where(
        and(eq(agentPromptVersions.agentId, agentId), eq(agentPromptVersions.isActive, true))
      );

    await tx.insert(agentPromptVersions).values({
      agentId,
      content,
      version: (previous?.version ?? 0) + 1,
      isActive: true,
      updatedByUserId,
    });
  });
}

export async function getActiveAgentPrompt(
  key: AgentKey
): Promise<{ id: string; content: string; version: number } | null> {
  const [row] = await db
    .select({
      id: agentPromptVersions.id,
      content: agentPromptVersions.content,
      version: agentPromptVersions.version,
    })
    .from(agentPromptVersions)
    .innerJoin(agents, eq(agents.id, agentPromptVersions.agentId))
    .where(and(eq(agents.key, key), eq(agentPromptVersions.isActive, true)))
    .limit(1);

  return row ?? null;
}

export async function listAgentPromptVersions(
  key: AgentKey
): Promise<{ version: number; createdAt: Date; updatedByUserId: string | null }[]> {
  return db
    .select({
      version: agentPromptVersions.version,
      createdAt: agentPromptVersions.createdAt,
      updatedByUserId: agentPromptVersions.updatedByUserId,
    })
    .from(agentPromptVersions)
    .innerJoin(agents, eq(agents.id, agentPromptVersions.agentId))
    .where(eq(agents.key, key))
    .orderBy(desc(agentPromptVersions.version));
}
