import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { setSecret } from "@/lib/secrets/store";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can edit integration credentials." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { clientId, clientSecret } = (body ?? {}) as {
    clientId?: unknown;
    clientSecret?: unknown;
  };

  if (
    typeof clientId !== "string" ||
    typeof clientSecret !== "string" ||
    clientId.trim() === "" ||
    clientSecret.trim() === ""
  ) {
    return NextResponse.json(
      { error: "clientId and clientSecret are required and must be non-empty strings." },
      { status: 400 }
    );
  }

  await setSecret("google_client_id", clientId, session.user.id);
  await setSecret("google_client_secret", clientSecret, session.user.id);

  return NextResponse.json({ ok: true });
}
