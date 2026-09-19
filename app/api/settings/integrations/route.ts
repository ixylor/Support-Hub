import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { setSecret } from "@/lib/secrets/store";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can edit integration credentials." }, { status: 403 });
  }

  const { clientId, clientSecret } = await request.json();
  await setSecret("google_client_id", clientId, session.user.id);
  await setSecret("google_client_secret", clientSecret, session.user.id);

  return NextResponse.json({ ok: true });
}
