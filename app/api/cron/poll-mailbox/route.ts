import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { QUEUES, enqueue } from "@/lib/jobs/boss";

// The poll itself is now a scheduled pg-boss job (see lib/jobs/handlers.ts).
// This route remains so an operator can trigger one immediately without
// waiting for the next scheduled run.
export async function POST(request: NextRequest) {
  const providedSecret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!providedSecret || providedSecret.length !== expectedSecret.length) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await enqueue(QUEUES.mailboxPoll, {});

  return NextResponse.json({ queued: true });
}
