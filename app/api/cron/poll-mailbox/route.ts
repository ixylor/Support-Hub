import { NextResponse, type NextRequest } from "next/server";
import {
  getActiveMailboxConnection,
  getDecryptedRefreshToken,
  setMailboxConnectionStatus,
  updateSyncCursor,
} from "@/lib/mailbox/connection";
import { getSecret } from "@/lib/secrets/store";
import { getMailProvider } from "@/lib/ingestion/providers";
import { ingestMessage } from "@/lib/ingestion/ingest-message";
import { clientIdSecretKey, clientSecretSecretKey } from "@/lib/mailbox/oauth-credentials";

export async function POST(request: NextRequest) {
  const providedSecret = request.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || providedSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const connection = await getActiveMailboxConnection();
  if (!connection) {
    return NextResponse.json({ ingested: 0, reason: "no active mailbox connection" });
  }

  const clientId = await getSecret(clientIdSecretKey(connection.provider));
  const clientSecret = await getSecret(clientSecretSecretKey(connection.provider));
  if (!clientId || !clientSecret) {
    await setMailboxConnectionStatus(connection.id, "error");
    return NextResponse.json({ ingested: 0, reason: "missing OAuth credentials" });
  }

  const provider = getMailProvider(connection.provider);
  const refreshToken = await getDecryptedRefreshToken(connection.id);

  let accessToken: string;
  try {
    accessToken = await provider.refreshAccessToken(clientId, clientSecret, refreshToken);
  } catch {
    await setMailboxConnectionStatus(connection.id, "error");
    return NextResponse.json({ ingested: 0, reason: "token refresh failed" });
  }

  const { messages, nextCursor } = await provider.getNewMessages(accessToken, connection.syncCursor);

  let ingested = 0;
  let lastSuccessfulIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    try {
      await ingestMessage(connection.id, message, provider, accessToken);
      ingested += 1;
      lastSuccessfulIndex = i;
    } catch (error) {
      console.error(`Failed to ingest message ${message.providerMessageId}:`, error);
    }
  }

  // Only advance cursor if we successfully ingested all messages in this batch.
  // This ensures transient failures are retried on the next poll cycle rather
  // than being silently skipped. ingestMessage is idempotent (dedupes on
  // provider_message_id), so re-processing previously successful messages is safe.
  if (lastSuccessfulIndex === messages.length - 1) {
    await updateSyncCursor(connection.id, nextCursor);
  }

  return NextResponse.json({ ingested });
}
