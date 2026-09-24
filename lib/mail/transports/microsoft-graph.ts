import { randomUUID } from "node:crypto";
import { getSecret } from "@/lib/secrets/store";
import { getActiveMailboxConnection, getDecryptedRefreshToken } from "@/lib/mailbox/connection";
import { clientIdSecretKey, clientSecretSecretKey } from "@/lib/mailbox/oauth-credentials";
import { microsoftGraphProvider } from "@/lib/ingestion/providers/microsoft-graph";
import type { MailTransport, OutboundMessage, SentMessage } from "../transport";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export function createMicrosoftGraphTransport(): MailTransport {
  async function accessToken(): Promise<string> {
    const connection = await getActiveMailboxConnection();
    if (!connection || connection.provider !== "microsoft") {
      throw new Error("Connect a Microsoft 365 mailbox before sending replies.");
    }

    const [clientId, clientSecret, refreshToken] = await Promise.all([
      getSecret(clientIdSecretKey("microsoft")),
      getSecret(clientSecretSecretKey("microsoft")),
      getDecryptedRefreshToken(connection.id),
    ]);
    if (!clientId || !clientSecret) {
      throw new Error("Microsoft 365 OAuth credentials are not configured.");
    }

    return microsoftGraphProvider.refreshAccessToken(clientId, clientSecret, refreshToken);
  }

  return {
    async send(message: OutboundMessage): Promise<SentMessage> {
      if (!message.replyToProviderMessageId) {
        throw new Error("Cannot send a Microsoft 365 reply without its original message id.");
      }

      const token = await accessToken();
      const response = await fetch(
        `${GRAPH_BASE}/me/messages/${encodeURIComponent(message.replyToProviderMessageId)}/reply`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: message.bodyText }),
        }
      );
      if (!response.ok) {
        throw new Error(`Microsoft Graph reply failed: ${response.status} ${await response.text()}`);
      }

      // Graph accepts the reply asynchronously and returns no message body.
      // This local id is only an audit key; actual threading is owned by Graph.
      return { providerMessageId: `graph-sent-${randomUUID()}`, messageIdHeader: null };
    },

    async verify(): Promise<void> {
      const token = await accessToken();
      const response = await fetch(`${GRAPH_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Microsoft Graph mailbox check failed: ${response.status}`);
    },
  };
}
