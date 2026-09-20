import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
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
import type { ProviderMessage } from "@/lib/ingestion/provider";

export async function POST(request: NextRequest) {
  const providedSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!providedSecret || providedSecret.length !== expectedSecret.length) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret))) {
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
  let refreshToken: string;
  try {
    refreshToken = await getDecryptedRefreshToken(connection.id);
  } catch (error) {
    await setMailboxConnectionStatus(connection.id, "error");
    console.error(`Failed to decrypt refresh token for connection ${connection.id}:`, error);
    return NextResponse.json({ ingested: 0, reason: "refresh token retrieval failed" });
  }

  let accessToken: string;
  try {
    accessToken = await provider.refreshAccessToken(clientId, clientSecret, refreshToken);
  } catch (error) {
    await setMailboxConnectionStatus(connection.id, "error");
    console.error(`Failed to refresh access token for connection ${connection.id}:`, error);
    return NextResponse.json({ ingested: 0, reason: "token refresh failed" });
  }

  let messages: ProviderMessage[];
  let nextCursor: string;
  try {
    const result = await provider.getNewMessages(accessToken, connection.syncCursor);
    messages = result.messages;
    nextCursor = result.nextCursor;
  } catch (error) {
    await setMailboxConnectionStatus(connection.id, "error");
    console.error(`Failed to fetch messages for connection ${connection.id}:`, error);
    return NextResponse.json({ ingested: 0, reason: "message fetch failed" });
  }

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
