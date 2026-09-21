import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { searchKnowledgeBase } from "@/lib/kb/retrieve";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can search the knowledge base." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    query?: unknown;
    tags?: unknown;
  } | null;

  if (!body || typeof body.query !== "string" || body.query.trim() === "") {
    return NextResponse.json({ error: "query is required." }, { status: 400 });
  }

  try {
    const results = await searchKnowledgeBase({
      query: body.query,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    });
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
