import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { disconnectActiveMailbox } from "@/lib/mailbox/connection";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can disconnect the mailbox." }, { status: 403 });
  }

  await disconnectActiveMailbox();
  return NextResponse.json({ ok: true });
}
