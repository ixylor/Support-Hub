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
  // The end of the run of consecutive successes starting at index 0. A
  // failure anywhere stops the run from growing further, even if later
  // messages succeed — those later successes get re-fetched and harmlessly
  // deduped next cycle once the failing message is retried.
  let consecutiveSuccessEnd = -1;
  let runBroken = false;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    try {
      await ingestMessage(connection.id, message, provider, accessToken);
      ingested += 1;
      if (!runBroken) {
        consecutiveSuccessEnd = i;
      }
    } catch (error) {
      runBroken = true;
      console.error(`Failed to ingest message ${message.providerMessageId}:`, error);
    }
  }

  // Advance the cursor past the longest run of consecutively-successful
  // messages from the start of the batch, rather than requiring the whole
  // batch to succeed. That way one permanently-failing message can't stall
  // ingestion forever — it's retried next cycle while later messages that
  // already succeeded are simply re-fetched and deduped. If the very first
  // message in the batch fails, the cursor can't move at all; the error log
  // above carries the provider message id so an operator can find it.
  if (consecutiveSuccessEnd === messages.length - 1) {
    await updateSyncCursor(connection.id, nextCursor);
  } else if (consecutiveSuccessEnd >= 0) {
    await updateSyncCursor(connection.id, messages[consecutiveSuccessEnd].sentAt.toISOString());
  }

  return NextResponse.json({ ingested });
}
