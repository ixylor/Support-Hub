import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import postgres from "postgres";
import { auth } from "@/lib/auth/server";
import { getSecret } from "@/lib/secrets/store";
import { getMailProvider } from "@/lib/ingestion/providers";
import {
  connectMailbox,
  MailboxAlreadyConnectedError,
  type MailboxProvider,
} from "@/lib/mailbox/connection";
import { clientIdSecretKey, clientSecretSecretKey, MAILBOX_OAUTH_PROVIDERS } from "@/lib/mailbox/oauth-credentials";

// The unique partial index that enforces "at most one active mailbox
// connection" (mailbox_connections_one_active) is only race-safe when an
// active row already exists for connectMailbox's UPDATE to lock. Two
// concurrent first-time connects can both pass that UPDATE and then race on
// the INSERT, so the loser gets a raw unique-violation here rather than a
// clean application error. Catch it and redirect with an error instead of
// letting a 500 reach the admin.
const UNIQUE_VIOLATION = "23505";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can connect a mailbox." }, { status: 403 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieValue = request.cookies.get("mailbox_oauth_state")?.value;

  if (!code || !returnedState || !cookieValue) {
    return NextResponse.json({ error: "Missing OAuth code or state." }, { status: 400 });
  }

  const [rawProvider, expectedState] = cookieValue.split(":");
  if (returnedState !== expectedState || !MAILBOX_OAUTH_PROVIDERS.includes(rawProvider as MailboxProvider)) {
    return NextResponse.json({ error: "OAuth state mismatch." }, { status: 400 });
  }
  const provider = rawProvider as MailboxProvider;

  const clientId = await getSecret(clientIdSecretKey(provider));
  const clientSecret = await getSecret(clientSecretSecretKey(provider));
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: `No OAuth credentials configured for ${provider}.` }, { status: 400 });
  }

  const tokens = await getMailProvider(provider).exchangeCodeForTokens(
    clientId,
    clientSecret,
    code,
    `${url.origin}/api/integrations/mailbox/callback`
  );

  try {
    await connectMailbox({
      provider,
      mailboxAddress: tokens.mailboxAddress,
      refreshToken: tokens.refreshToken,
      connectedByUserId: session.user.id,
    });
  } catch (error) {
    if (error instanceof MailboxAlreadyConnectedError) {
      const response = NextResponse.redirect(
        new URL("/dashboard/settings/integrations?error=mailbox_already_connected", url.origin)
      );
      response.cookies.delete("mailbox_oauth_state");
      return response;
    }
    if (error instanceof postgres.PostgresError && error.code === UNIQUE_VIOLATION) {
      const response = NextResponse.redirect(
        new URL("/dashboard/settings/integrations?error=mailbox_already_connected", url.origin)
      );
      response.cookies.delete("mailbox_oauth_state");
      return response;
    }
    throw error;
  }

  const response = NextResponse.redirect(new URL("/dashboard/settings/integrations", url.origin));
  response.cookies.delete("mailbox_oauth_state");
  return response;
}
