import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { activateNewPromptVersion } from "@/lib/prompt-templates";

// The only prompt template key(s) the AI Response Pipeline phase currently
// consumes — keeps arbitrary keys from being created via this endpoint.
const ALLOWED_PROMPT_KEYS = ["draft_reply_system"] as const;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can edit prompt templates." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { key, content } = (body ?? {}) as { key?: unknown; content?: unknown };

  if (typeof key !== "string" || !ALLOWED_PROMPT_KEYS.includes(key as (typeof ALLOWED_PROMPT_KEYS)[number])) {
    return NextResponse.json(
      { error: `key must be one of: ${ALLOWED_PROMPT_KEYS.join(", ")}` },
      { status: 400 }
    );
  }

  if (typeof content !== "string" || content.trim() === "") {
    return NextResponse.json({ error: "content is required and must be a non-empty string." }, { status: 400 });
  }

  await activateNewPromptVersion(key, content, session.user.id);

  return NextResponse.json({ ok: true });
}
