import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { promptTemplates } from "@/lib/db/schema";

export async function activateNewPromptVersion(
  key: string,
  content: string,
  updatedByUserId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ version: promptTemplates.version })
      .from(promptTemplates)
      .where(eq(promptTemplates.key, key))
      .orderBy(desc(promptTemplates.version))
      .limit(1);

    await tx
      .update(promptTemplates)
      .set({ isActive: false })
      .where(and(eq(promptTemplates.key, key), eq(promptTemplates.isActive, true)));

    await tx.insert(promptTemplates).values({
      key,
      content,
      version: (previous?.version ?? 0) + 1,
      isActive: true,
      updatedByUserId,
    });
  });
}

export async function getActivePromptTemplate(
  key: string
): Promise<{ content: string; version: number } | null> {
  const [row] = await db
    .select({ content: promptTemplates.content, version: promptTemplates.version })
    .from(promptTemplates)
    .where(and(eq(promptTemplates.key, key), eq(promptTemplates.isActive, true)))
    .limit(1);

  return row ?? null;
}
