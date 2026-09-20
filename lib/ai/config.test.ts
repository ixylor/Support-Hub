import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiDeployments, appSecrets } from "@/lib/db/schema";
import { user } from "@/lib/auth/schema";
import {
  activateDeployment,
  deactivateDeployment,
  getActiveDeployment,
  getAzureCredentials,
  listDeployments,
  setAzureCredentials,
} from "./config";

describe("AI provider configuration", () => {
  let adminId: string;

  beforeEach(async () => {
    const [row] = await db
      .insert(user)
      .values({
        id: `ai-config-test-${crypto.randomUUID()}`,
        name: "AI Config Admin",
        email: `ai-config-test-${crypto.randomUUID()}@example.com`,
        role: "admin",
      })
      .returning({ id: user.id });
    adminId = row.id;
  });

  afterEach(async () => {
    await db.delete(aiDeployments);
    await db.delete(appSecrets);
  });

  it("returns null when no credentials are stored", async () => {
    expect(await getAzureCredentials()).toBeNull();
  });

  it("round-trips credentials through the encrypted store", async () => {
    await setAzureCredentials(
      {
        endpoint: "https://example.openai.azure.com",
        apiKey: "test-key",
        apiVersion: "2024-10-21",
      },
      adminId
    );

    expect(await getAzureCredentials()).toEqual({
      endpoint: "https://example.openai.azure.com",
      apiKey: "test-key",
      apiVersion: "2024-10-21",
    });
  });

  it("returns null when only some credential fields are present", async () => {
    await db.insert(appSecrets).values({
      key: "azure_openai_endpoint",
      encryptedValue: "irrelevant",
      updatedByUserId: adminId,
    });

    // A half-configured provider is not configured. Returning a partial object
    // would push the failure into a confusing fetch error later.
    expect(await getAzureCredentials()).toBeNull();
  });

  it("strips a trailing slash from the endpoint", async () => {
    await setAzureCredentials(
      {
        endpoint: "https://example.openai.azure.com/",
        apiKey: "test-key",
        apiVersion: "2024-10-21",
      },
      adminId
    );

    const credentials = await getAzureCredentials();
    expect(credentials?.endpoint).toBe("https://example.openai.azure.com");
  });

  it("returns null when no deployment is active for a role", async () => {
    expect(await getActiveDeployment("embedding")).toBeNull();
  });

  it("activating a deployment retires the previous one for that role", async () => {
    await activateDeployment(
      { role: "embedding", deploymentName: "old", modelName: "text-embedding-3-small", dimensions: 1536 },
      adminId
    );
    await activateDeployment(
      { role: "embedding", deploymentName: "new", modelName: "text-embedding-3-small", dimensions: 1536 },
      adminId
    );

    const active = await getActiveDeployment("embedding");
    expect(active?.deploymentName).toBe("new");

    const all = await listDeployments();
    expect(all).toHaveLength(2);
    expect(all.filter((d) => d.isActive)).toHaveLength(1);
  });

  it("does not disturb other roles when activating one", async () => {
    await activateDeployment(
      { role: "chat", deploymentName: "gpt-4.1", modelName: "gpt-4.1", dimensions: null },
      adminId
    );
    await activateDeployment(
      { role: "embedding", deploymentName: "text-embedding-3-small", modelName: "text-embedding-3-small", dimensions: 1536 },
      adminId
    );

    expect((await getActiveDeployment("chat"))?.deploymentName).toBe("gpt-4.1");
    expect((await getActiveDeployment("embedding"))?.deploymentName).toBe("text-embedding-3-small");
  });

  it("rejects an embedding deployment without dimensions", async () => {
    await expect(
      activateDeployment(
        { role: "embedding", deploymentName: "bad", modelName: "text-embedding-3-small", dimensions: null },
        adminId
      )
    ).rejects.toThrow(/dimensions/i);
  });

  it("rejects an embedding deployment whose dimensions do not match the column", async () => {
    await expect(
      activateDeployment(
        { role: "embedding", deploymentName: "large", modelName: "text-embedding-3-large", dimensions: 3072 },
        adminId
      )
    ).rejects.toThrow(/1536/);
  });

  it("deactivating leaves no active deployment for the role", async () => {
    await activateDeployment(
      { role: "chat", deploymentName: "gpt-4.1", modelName: "gpt-4.1", dimensions: null },
      adminId
    );
    const [row] = await db.select().from(aiDeployments).where(eq(aiDeployments.isActive, true));

    await deactivateDeployment(row.id);

    expect(await getActiveDeployment("chat")).toBeNull();
  });
});
