import { afterEach, describe, expect, it, vi } from "vitest";
import { microsoftGraphProvider } from "./microsoft-graph";

describe("microsoft graph provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an authorization URL with the required scopes", () => {
    const url = microsoftGraphProvider.getAuthorizationUrl(
      "client-id",
      "https://app.test/callback",
      "state-123"
    );

    expect(url).toContain("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url).toContain("client_id=client-id");
    expect(url).toContain("state=state-123");
  });

  it("exchanges an authorization code for a refresh token and mailbox address", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ refresh_token: "rt-1", access_token: "at-1" }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ mail: "support@example.com" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await microsoftGraphProvider.exchangeCodeForTokens(
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

    const token = await microsoftGraphProvider.refreshAccessToken("client-id", "client-secret", "rt-1");

    expect(token).toBe("at-2");
  });

  it("fetches new messages with their attachments and advances the cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              {
                id: "msg-1",
                conversationId: "conv-1",
                from: { emailAddress: { address: "customer@example.com" } },
                subject: "Help needed",
                body: { content: "<p>Hello</p>" },
                receivedDateTime: "2026-09-19T10:00:00.000Z",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [{ id: "att-1", name: "log.txt", contentType: "text/plain" }] }), {
          status: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await microsoftGraphProvider.getNewMessages("access-token", null);

    expect(result.messages).toEqual([
      {
        providerMessageId: "msg-1",
        providerThreadId: "conv-1",
        senderEmail: "customer@example.com",
        subject: "Help needed",
        bodyText: "Hello",
        sentAt: new Date("2026-09-19T10:00:00.000Z"),
        attachments: [{ id: "att-1", filename: "log.txt", contentType: "text/plain" }],
      },
    ]);
    expect(result.nextCursor).toBe("2026-09-19T10:00:00.000Z");
  });

  it("downloads attachment content as a buffer", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ contentBytes: Buffer.from("file contents").toString("base64") }), {
            status: 200,
          })
        )
    );

    const buffer = await microsoftGraphProvider.downloadAttachment("access-token", "msg-1", {
      id: "att-1",
      filename: "log.txt",
      contentType: "text/plain",
    });

    expect(buffer.toString("utf8")).toBe("file contents");
  });

  it("encodes message and attachment ids in URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ contentBytes: Buffer.from("test").toString("base64") }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await microsoftGraphProvider.downloadAttachment("access-token", "msg?123&test", {
      id: "att#456?789",
      filename: "file.txt",
      contentType: "text/plain",
    });

    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent("msg?123&test"));
    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent("att#456?789"));
  });
});
