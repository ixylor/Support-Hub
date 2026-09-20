import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSecrets } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";

export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptionError";
  }
}

export async function getSecret(key: string): Promise<string | null> {
  const [row] = await db
    .select({ encryptedValue: appSecrets.encryptedValue })
    .from(appSecrets)
    .where(eq(appSecrets.key, key))
    .limit(1);

  if (!row) {
    return null;
  }

  try {
    return decryptSecret(row.encryptedValue);
  } catch (error) {
    throw new SecretDecryptionError(
      `Failed to decrypt secret "${key}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
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
