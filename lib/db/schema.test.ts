import { describe, expect, it } from "vitest";
import { appSecrets, promptTemplates, ticketAiDrafts, tickets } from "./schema";

describe("domain schema", () => {
  it("exposes the columns the AI pipeline phase will rely on", () => {
    expect(Object.keys(ticketAiDrafts)).toEqual(
      expect.arrayContaining(["graphThreadId", "promptTemplateId", "confidenceScore"])
    );
  });

  it("exposes the columns the review dashboard will rely on", () => {
    expect(Object.keys(tickets)).toEqual(
      expect.arrayContaining(["status", "category", "priority"])
    );
  });

  it("supports versioned prompt templates", () => {
    expect(Object.keys(promptTemplates)).toEqual(
      expect.arrayContaining(["key", "version", "isActive"])
    );
  });

  it("stores OAuth credentials as an encrypted value, never plaintext", () => {
    expect(Object.keys(appSecrets)).toEqual(
      expect.arrayContaining(["key", "encryptedValue"])
    );
    expect(Object.keys(appSecrets)).not.toContain("value");
  });
});
