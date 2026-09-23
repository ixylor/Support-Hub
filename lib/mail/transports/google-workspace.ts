import { getSecret } from "@/lib/secrets/store";
import { getActiveMailboxConnection, getDecryptedRefreshToken } from "@/lib/mailbox/connection";
import { clientIdSecretKey, clientSecretSecretKey } from "@/lib/mailbox/oauth-credentials";
import { googleWorkspaceProvider } from "@/lib/ingestion/providers/google-workspace";
import type { MailTransport, OutboundMessage, SentMessage } from "../transport";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function encodedSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject.replace(/[\r\n]/g, " "), "utf8").toString("base64")}?=`;
}

function encodeRawMessage(message: OutboundMessage): string {
  if (/[\r\n]/.test(message.to)) {
    throw new Error("The recipient address contains an invalid line break.");
  }

  const headers = [
    `To: ${message.to}`,
    `Subject: ${encodedSubject(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (message.inReplyTo) headers.push(`In-Reply-To: ${message.inReplyTo}`);
  if (message.references.length > 0) headers.push(`References: ${message.references.join(" ")}`);

  const body = Buffer.from(message.bodyText, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  const raw = `${headers.join("\r\n")}\r\n\r\n${body}`;
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string): string | null {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export function createGoogleWorkspaceTransport(): MailTransport {
  async function accessToken(): Promise<string> {
    const connection = await getActiveMailboxConnection();
    if (!connection || connection.provider !== "google") {
      throw new Error("Connect a Google Workspace mailbox before sending replies.");
    }

    const [clientId, clientSecret, refreshToken] = await Promise.all([
      getSecret(clientIdSecretKey("google")),
      getSecret(clientSecretSecretKey("google")),
      getDecryptedRefreshToken(connection.id),
    ]);
    if (!clientId || !clientSecret) {
      throw new Error("Google Workspace OAuth credentials are not configured.");
    }

    return googleWorkspaceProvider.refreshAccessToken(clientId, clientSecret, refreshToken);
  }

  return {
    async send(message: OutboundMessage): Promise<SentMessage> {
      if (!message.threadId) {
        throw new Error("Cannot send a Google Workspace reply without its Gmail thread id.");
      }

      const token = await accessToken();
      const response = await fetch(`${GMAIL_BASE}/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodeRawMessage(message), threadId: message.threadId }),
      });
      if (!response.ok) {
        throw new Error(`Gmail send failed: ${response.status} ${await response.text()}`);
      }

      const sent = (await response.json()) as { id: string };
      try {
        const metadataResponse = await fetch(
          `${GMAIL_BASE}/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-ID`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!metadataResponse.ok) {
          return { providerMessageId: sent.id, messageIdHeader: null };
        }
        const metadata = (await metadataResponse.json()) as {
          payload?: { headers?: Array<{ name: string; value: string }> };
        };
        return {
          providerMessageId: sent.id,
          messageIdHeader: headerValue(metadata.payload?.headers, "Message-ID"),
        };
      } catch {
        // Sending already succeeded. A metadata read failure must not make the
        // caller retry or report the email itself as failed.
        return { providerMessageId: sent.id, messageIdHeader: null };
      }
    },

    async verify(): Promise<void> {
      const token = await accessToken();
      const response = await fetch(`${GMAIL_BASE}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Gmail mailbox check failed: ${response.status}`);
    },
  };
}
