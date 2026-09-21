import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { knowledgeBaseReadiness, requeueEntry } from "@/lib/kb/entries";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can retry processing." }, { status: 403 });
  }

  const readiness = await knowledgeBaseReadiness();
  if (!readiness.ready) {
    return NextResponse.json({ error: readiness.reason }, { status: 409 });
  }

  const { entryId } = await params;
  await requeueEntry(entryId);

  return NextResponse.json({ ok: true });
}
