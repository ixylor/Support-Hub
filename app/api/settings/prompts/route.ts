import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { activateNewPromptVersion } from "@/lib/prompt-templates";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can edit prompt templates." }, { status: 403 });
  }

  const { key, content } = await request.json();
  await activateNewPromptVersion(key, content, session.user.id);

  return NextResponse.json({ ok: true });
}
