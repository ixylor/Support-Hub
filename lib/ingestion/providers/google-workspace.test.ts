import { afterEach, describe, expect, it, vi } from "vitest";
import { googleWorkspaceProvider } from "./google-workspace";

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

describe("google workspace provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an authorization URL requesting offline access and gmail readonly scope", () => {
    const url = googleWorkspaceProvider.getAuthorizationUrl(
      "client-id",
      "https://app.test/callback",
      "state-123"
    );

    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("access_type=offline");
    expect(url).toContain(encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly"));
  });

  it("exchanges an authorization code for a refresh token and mailbox address", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ refresh_token: "rt-1", access_token: "at-1" }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ emailAddress: "support@example.com" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await googleWorkspaceProvider.exchangeCodeForTokens(
      "client-id",
      "client-secret",
      "auth-code",
      "https://app.test/callback"
    );

    expect(result).toEqual({ refreshToken: "rt-1", mailboxAddress: "support@example.com" });
  });

  it("refreshes an access token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at-2" }), { status: 200 }))
    );

    const token = await googleWorkspaceProvider.refreshAccessToken("client-id", "client-secret", "rt-1");

    expect(token).toBe("at-2");
  });

  it("fetches new messages, preferring the text/plain part, and advances the cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "msg-1", threadId: "thread-1" }] }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg-1",
            threadId: "thread-1",
            internalDate: "1758276000000",
            snippet: "Hello there",
            payload: {
              headers: [
                { name: "From", value: "Customer <customer@example.com>" },
                { name: "Subject", value: "Help needed" },
              ],
              parts: [
                { mimeType: "text/plain", body: { data: base64url("Hello there") } },
                {
                  mimeType: "text/plain",
                  filename: "log.txt",
                  body: { attachmentId: "att-1" },
                },
              ],
            },
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await googleWorkspaceProvider.getNewMessages("access-token", null);

    expect(result.messages).toEqual([
      {
        providerMessageId: "msg-1",
        providerThreadId: "thread-1",
        senderEmail: "customer@example.com",
        subject: "Help needed",
        bodyText: "Hello there",
        sentAt: new Date(1758276000000),
        attachments: [{ id: "att-1", filename: "log.txt", contentType: "text/plain" }],
      },
    ]);
    expect(result.nextCursor).toBe(new Date(1758276000000).toISOString());
  });

  it("filters from approximately now, not epoch, when there is no cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const before = Math.floor(Date.now() / 1000);
    await googleWorkspaceProvider.getNewMessages("access-token", null);
    const after = Math.floor(Date.now() / 1000);

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    const query = decodeURIComponent(new URL(requestedUrl).searchParams.get("q") ?? "");
    expect(query).not.toContain("after:0");

    const match = query.match(/after:(\d+)/);
    expect(match).not.toBeNull();
    const afterSeconds = Number(match![1]);
    expect(afterSeconds).toBeGreaterThanOrEqual(before);
    expect(afterSeconds).toBeLessThanOrEqual(after);
  });

  it("filters from the cursor timestamp when a cursor is present", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const cursor = new Date("2024-01-15T00:00:00.000Z").toISOString();
    await googleWorkspaceProvider.getNewMessages("access-token", cursor);

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    const query = decodeURIComponent(new URL(requestedUrl).searchParams.get("q") ?? "");
    const expectedAfterSeconds = Math.floor(new Date(cursor).getTime() / 1000);
    expect(query).toContain(`after:${expectedAfterSeconds}`);
  });

  it("returns messages sorted oldest-first even when Gmail responds newest-first", async () => {
    const older = {
      id: "msg-old",
      threadId: "thread-old",
      internalDate: "1758270000000",
      snippet: "older",
      payload: {
        headers: [
          { name: "From", value: "Customer <customer@example.com>" },
          { name: "Subject", value: "Older" },
        ],
        parts: [{ mimeType: "text/plain", body: { data: base64url("older") } }],
      },
    };
    const newer = {
      id: "msg-new",
      threadId: "thread-new",
      internalDate: "1758276000000",
      snippet: "newer",
      payload: {
        headers: [
          { name: "From", value: "Customer <customer@example.com>" },
          { name: "Subject", value: "Newer" },
        ],
        parts: [{ mimeType: "text/plain", body: { data: base64url("newer") } }],
      },
    };

    // Gmail lists newest-first: put the newer message first in the list response.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [
              { id: "msg-new", threadId: "thread-new" },
              { id: "msg-old", threadId: "thread-old" },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(newer), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(older), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await googleWorkspaceProvider.getNewMessages("access-token", null);

    expect(result.messages.map((message) => message.providerMessageId)).toEqual(["msg-old", "msg-new"]);
    expect(result.nextCursor).toBe(new Date(1758276000000).toISOString());
  });

  it("downloads attachment content as a buffer", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: base64url("file contents") }), { status: 200 })
        )
    );

    const buffer = await googleWorkspaceProvider.downloadAttachment("access-token", "msg-1", {
      id: "att-1",
      filename: "log.txt",
      contentType: "text/plain",
    });

    expect(buffer.toString("utf8")).toBe("file contents");
  });

  it("encodes message and attachment ids in URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: base64url("test") }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await googleWorkspaceProvider.downloadAttachment("access-token", "msg?123&test", {
      id: "att#456?789",
      filename: "file.txt",
      contentType: "text/plain",
    });

    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent("msg?123&test"));
    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent("att#456?789"));
  });
});
