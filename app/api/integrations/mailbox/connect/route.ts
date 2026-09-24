import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getSecret } from "@/lib/secrets/store";
import { getMailProvider } from "@/lib/ingestion/providers";
import { getActiveMailboxConnection, type MailboxProvider } from "@/lib/mailbox/connection";
import { clientIdSecretKey, MAILBOX_OAUTH_PROVIDERS } from "@/lib/mailbox/oauth-credentials";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can connect a mailbox." }, { status: 403 });
  }

  const url = new URL(request.url);
  const requestedProvider = url.searchParams.get("provider");
  if (!requestedProvider || !MAILBOX_OAUTH_PROVIDERS.includes(requestedProvider as MailboxProvider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${MAILBOX_OAUTH_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }
  const provider = requestedProvider as MailboxProvider;

  if (await getActiveMailboxConnection()) {
    return NextResponse.json(
      { error: "Disconnect the current mailbox before connecting another one." },
      { status: 409 }
    );
  }

  const clientId = await getSecret(clientIdSecretKey(provider));
  if (!clientId) {
    return NextResponse.json({ error: `No OAuth client ID configured for ${provider}.` }, { status: 400 });
  }

  const state = crypto.randomUUID();
  const redirectUri = `${url.origin}/api/integrations/mailbox/callback`;
  const authorizationUrl = getMailProvider(provider).getAuthorizationUrl(clientId, redirectUri, state);

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set("mailbox_oauth_state", `${provider}:${state}`, {
    httpOnly: true,
    // Only literal "localhost" gets browsers' special-cased trustworthy-origin
    // treatment for a `secure` cookie over plain HTTP. Hardcoding `true` here
    // silently drops the cookie on 127.0.0.1, a LAN IP, or a .local dev
    // domain, producing a confusing "OAuth state mismatch" at the callback.
    // Base it on whether this request actually arrived over HTTPS instead.
    secure: url.protocol === "https:" || process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
