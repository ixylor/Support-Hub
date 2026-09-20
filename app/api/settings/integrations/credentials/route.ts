import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getSecret, setSecret } from "@/lib/secrets/store";
import type { MailboxProvider } from "@/lib/mailbox/connection";
import {
  clientIdSecretKey,
  clientSecretSecretKey,
  MAILBOX_OAUTH_PROVIDERS,
} from "@/lib/mailbox/oauth-credentials";

async function requireAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Only admins can view integration credentials." }, { status: 403 });
  }

  const configured: Record<string, boolean> = {};
  for (const provider of MAILBOX_OAUTH_PROVIDERS) {
    configured[provider] = (await getSecret(clientIdSecretKey(provider))) !== null;
  }

  return NextResponse.json({ configured });
}

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Only admins can edit integration credentials." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { provider, clientId, clientSecret } = (body ?? {}) as {
    provider?: unknown;
    clientId?: unknown;
    clientSecret?: unknown;
  };

  if (typeof provider !== "string" || !MAILBOX_OAUTH_PROVIDERS.includes(provider as MailboxProvider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${MAILBOX_OAUTH_PROVIDERS.join(", ")}` },
      { status: 400 }
    );
  }
  if (typeof clientId !== "string" || clientId.trim() === "") {
    return NextResponse.json({ error: "clientId is required." }, { status: 400 });
  }
  if (typeof clientSecret !== "string" || clientSecret.trim() === "") {
    return NextResponse.json({ error: "clientSecret is required." }, { status: 400 });
  }

  const typedProvider = provider as MailboxProvider;
  await setSecret(clientIdSecretKey(typedProvider), clientId, session.user.id);
  await setSecret(clientSecretSecretKey(typedProvider), clientSecret, session.user.id);

  return NextResponse.json({ ok: true });
}
