import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import {
  createArticleEntry,
  createUploadedEntry,
  knowledgeBaseReadiness,
  listEntries,
} from "@/lib/kb/entries";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return null;
  }
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only admins can read the knowledge base." }, { status: 403 });
  }

  return NextResponse.json({ entries: await listEntries() });
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Only admins can add documents." }, { status: 403 });
  }

  const readiness = await knowledgeBaseReadiness();
  if (!readiness.ready) {
    return NextResponse.json({ error: readiness.reason }, { status: 409 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");

      if (!(file instanceof File)) {
        return NextResponse.json({ error: "A file is required." }, { status: 400 });
      }

      const id = await createUploadedEntry({
        title: String(form.get("title") ?? file.name),
        tags: String(form.get("tags") ?? "")
          .split(",")
          .filter((tag) => tag.trim() !== ""),
        filename: file.name,
        contentType: file.type,
        content: Buffer.from(await file.arrayBuffer()),
        uploadedByUserId: session.user.id,
      });

      return NextResponse.json({ id }, { status: 201 });
    }

    const body = (await request.json()) as { title?: unknown; body?: unknown; tags?: unknown };

    if (typeof body.title !== "string" || typeof body.body !== "string") {
      return NextResponse.json(
        { error: "title and body are required strings." },
        { status: 400 }
      );
    }

    const id = await createArticleEntry({
      title: body.title,
      body: body.body,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      uploadedByUserId: session.user.id,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
