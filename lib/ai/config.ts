import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiDeployments } from "@/lib/db/schema";
import { getSecret, setSecret, SecretDecryptionError } from "@/lib/secrets/store";

export type DeploymentRole = "chat" | "embedding" | "extraction";

export interface AzureCredentials {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
}

export interface ActiveDeployment {
  id: string;
  role: DeploymentRole;
  deploymentName: string;
  modelName: string;
  dimensions: number | null;
}

export interface DeploymentRow extends ActiveDeployment {
  isActive: boolean;
  updatedAt: Date;
}

const ENDPOINT_KEY = "azure_openai_endpoint";
const API_KEY_KEY = "azure_openai_key";
const API_VERSION_KEY = "azure_openai_api_version";

// kb_chunks.embedding is a fixed-width vector column. Accepting a deployment
// with different dimensions would produce rows the retrieval query can't
// compare, so it's rejected at configuration time instead.
export const EMBEDDING_DIMENSIONS = 1536;

export async function getAzureCredentials(): Promise<AzureCredentials | null> {
  try {
    const [endpoint, apiKey, apiVersion] = await Promise.all([
      getSecret(ENDPOINT_KEY),
      getSecret(API_KEY_KEY),
      getSecret(API_VERSION_KEY),
    ]);

    if (!endpoint || !apiKey || !apiVersion) {
      return null;
    }

    return { endpoint: endpoint.replace(/\/+$/, ""), apiKey, apiVersion };
  } catch (error) {
    // Return null only for undecryptable stored secrets. Other errors
    // (database failures, wrong encryption key) should propagate.
    if (error instanceof SecretDecryptionError) {
      // A wrong or rotated APP_ENCRYPTION_KEY looks identical to corrupt
      // ciphertext from here, so log it — otherwise this surfaces to the
      // admin as "provider not configured", which points at the wrong fix.
      console.error("Failed to decrypt a stored Azure OpenAI credential:", error.message);
      return null;
    }
    throw error;
  }
}

export async function setAzureCredentials(
  credentials: AzureCredentials,
  updatedByUserId: string
): Promise<void> {
  await setSecret(ENDPOINT_KEY, credentials.endpoint.replace(/\/+$/, ""), updatedByUserId);
  await setSecret(API_KEY_KEY, credentials.apiKey, updatedByUserId);
  await setSecret(API_VERSION_KEY, credentials.apiVersion, updatedByUserId);
}

export async function getActiveDeployment(
  role: DeploymentRole
): Promise<ActiveDeployment | null> {
  const [row] = await db
    .select({
      id: aiDeployments.id,
      role: aiDeployments.role,
      deploymentName: aiDeployments.deploymentName,
      modelName: aiDeployments.modelName,
      dimensions: aiDeployments.dimensions,
    })
    .from(aiDeployments)
    .where(and(eq(aiDeployments.role, role), eq(aiDeployments.isActive, true)))
    .limit(1);

  return row ?? null;
}

export async function listDeployments(): Promise<DeploymentRow[]> {
  return db
    .select({
      id: aiDeployments.id,
      role: aiDeployments.role,
      deploymentName: aiDeployments.deploymentName,
      modelName: aiDeployments.modelName,
      dimensions: aiDeployments.dimensions,
      isActive: aiDeployments.isActive,
      updatedAt: aiDeployments.updatedAt,
    })
    .from(aiDeployments)
    .orderBy(desc(aiDeployments.updatedAt));
}

export async function activateDeployment(
  input: {
    role: DeploymentRole;
    deploymentName: string;
    modelName: string;
    dimensions: number | null;
  },
  updatedByUserId: string
): Promise<void> {
  if (input.role === "embedding") {
    if (input.dimensions === null) {
      throw new Error("An embedding deployment requires its dimensions.");
    }
    if (input.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimensions must be ${EMBEDDING_DIMENSIONS} to match the kb_chunks column, got ${input.dimensions}.`
      );
    }
  }

  await db.transaction(async (tx) => {
    // Same reasoning as activateNewPromptVersion: serialize per-role so the
    // deactivate-then-insert pair can't race another activation into two
    // active rows.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai_deployment:${input.role}`}))`);

    await tx
      .update(aiDeployments)
      .set({ isActive: false })
      .where(and(eq(aiDeployments.role, input.role), eq(aiDeployments.isActive, true)));

    await tx.insert(aiDeployments).values({
      role: input.role,
      deploymentName: input.deploymentName,
      modelName: input.modelName,
      dimensions: input.dimensions,
      isActive: true,
      updatedByUserId,
    });
  });
}

export async function deactivateDeployment(id: string): Promise<void> {
  await db.update(aiDeployments).set({ isActive: false }).where(eq(aiDeployments.id, id));
}
