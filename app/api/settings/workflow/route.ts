import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { updateWorkflowSettings } from "@/lib/workflow/settings";

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can change these." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { isEnabled, requireApproval, autoSendMinConfidence } = (body ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof isEnabled !== "boolean" ||
    typeof requireApproval !== "boolean" ||
    typeof autoSendMinConfidence !== "number"
  ) {
    return NextResponse.json({ error: "Invalid workflow settings." }, { status: 400 });
  }

  try {
    await updateWorkflowSettings(
      { isEnabled, requireApproval, autoSendMinConfidence },
      (session.user as { id: string }).id
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
