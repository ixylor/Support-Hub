import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { enqueue } from "@/lib/jobs/boss";
import { QUEUES } from "@/lib/jobs/queues";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can run the workflow." }, { status: 403 });
  }

  const { ticketId } = await params;
  await enqueue(QUEUES.workflowRun, { ticketId, trigger: "new_ticket" });
  return NextResponse.json({ ok: true });
}
