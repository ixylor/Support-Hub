import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { kbEntries } from "@/lib/db/schema";
import { deleteEntry } from "@/lib/kb/entries";

// The list query deliberately omits `content` to stay small, so the "view
// article text" dialog fetches it here on demand.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can read knowledge base articles." }, { status: 403 });
  }

  const { entryId } = await params;
  const [entry] = await db
    .select({ content: kbEntries.content })
    .from(kbEntries)
    .where(eq(kbEntries.id, entryId))
    .limit(1);

  if (!entry) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ content: entry.content ?? "" });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can delete knowledge base articles." }, { status: 403 });
  }

  const { entryId } = await params;
  await deleteEntry(entryId);

  return NextResponse.json({ ok: true });
}
