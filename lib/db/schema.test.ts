import { describe, expect, it } from "vitest";
import { appSecrets, mailboxConnections, promptTemplates, ticketAiDrafts, ticketMessages, tickets } from "./schema";

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

  it("supports a per-provider sync checkpoint on the mailbox connection", () => {
    expect(Object.keys(mailboxConnections)).toEqual(
      expect.arrayContaining(["syncCursor"])
    );
  });

  it("threads tickets by mailbox connection and provider thread id", () => {
    expect(Object.keys(tickets)).toEqual(
      expect.arrayContaining(["mailboxConnectionId", "providerThreadId"])
    );
  });

  it("dedupes ingested messages by provider message id", () => {
    expect(Object.keys(ticketMessages)).toEqual(
      expect.arrayContaining(["providerMessageId"])
    );
  });
});
