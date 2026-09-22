import { beforeEach, describe, expect, it, vi } from "vitest";
import { addInboundMessage, createTestTicket } from "@/lib/test-helpers/tickets";
import { formatThread, loadContextNode, retrieveKbNode } from "./context";

const searchKnowledgeBase = vi.fn();
vi.mock("@/lib/kb/retrieve", () => ({
  searchKnowledgeBase: (...args: unknown[]) => searchKnowledgeBase(...args),
}));

describe("context nodes", () => {
  let ticketId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ticketId = await createTestTicket({ subject: "Login is not working" });
  });

  it("loads the thread oldest first", async () => {
    await addInboundMessage(ticketId, "First message");
    await addInboundMessage(ticketId, "Second message");

    const patch = await loadContextNode({ ticketId } as never);

    expect(patch.thread?.map((message) => message.body)).toEqual([
      "First message",
      "Second message",
    ]);
    expect(patch.subject).toBe("Login is not working");
    expect(patch.requesterEmail).toBe("customer@example.test");
  });

  it("counts prior outbound questions as info rounds", async () => {
    await addInboundMessage(ticketId, "Help");

    const patch = await loadContextNode({ ticketId } as never);
    expect(patch.infoRounds).toBe(0);
  });

  it("searches the knowledge base using the subject and the newest inbound message", async () => {
    searchKnowledgeBase.mockResolvedValue([]);
    await addInboundMessage(ticketId, "I get a 403 on sign in");

    await retrieveKbNode({
      ticketId,
      subject: "Login is not working",
      thread: [
        {
          direction: "inbound",
          senderEmail: "customer@example.test",
          body: "I get a 403 on sign in",
          messageIdHeader: null,
          sentAt: new Date(),
        },
      ],
    } as never);

    expect(searchKnowledgeBase).toHaveBeenCalledWith({
      query: "Login is not working\n\nI get a 403 on sign in",
      limit: 8,
    });
  });

  it("maps search results onto kb hits", async () => {
    searchKnowledgeBase.mockResolvedValue([
      { chunkId: "c1", entryId: "e1", title: "Sign-in errors", tags: [], chunkText: "Reset it.", score: 0.9 },
    ]);

    const patch = await retrieveKbNode({
      ticketId,
      subject: "s",
      thread: [
        { direction: "inbound", senderEmail: "c@e.test", body: "b", messageIdHeader: null, sentAt: new Date() },
      ],
    } as never);

    expect(patch.kbHits).toEqual([
      { chunkId: "c1", entryTitle: "Sign-in errors", text: "Reset it.", score: 0.9 },
    ]);
  });

  it("formats a thread with direction labels", () => {
    const formatted = formatThread([
      { direction: "inbound", senderEmail: "c@e.test", body: "Help", messageIdHeader: null, sentAt: new Date() },
      { direction: "outbound", senderEmail: "s@e.test", body: "Which page?", messageIdHeader: null, sentAt: new Date() },
    ]);

    expect(formatted).toContain("Customer: Help");
    expect(formatted).toContain("Support: Which page?");
  });
});
