import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSecrets } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";

export async function getSecret(key: string): Promise<string | null> {
  const [row] = await db
    .select({ encryptedValue: appSecrets.encryptedValue })
    .from(appSecrets)
    .where(eq(appSecrets.key, key))
    .limit(1);

  return row ? decryptSecret(row.encryptedValue) : null;
}

export async function setSecret(
  key: string,
  value: string,
  updatedByUserId: string
): Promise<void> {
  await db
    .insert(appSecrets)
    .values({ key, encryptedValue: encryptSecret(value), updatedByUserId })
    .onConflictDoUpdate({
      target: appSecrets.key,
      set: { encryptedValue: encryptSecret(value), updatedByUserId, updatedAt: new Date() },
    });
}
