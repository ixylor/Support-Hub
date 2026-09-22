import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getMailTransport } from "@/lib/mail/transports";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can send a test email." }, { status: 403 });
  }

  try {
    const transport = await getMailTransport();
    await transport.verify();
    await transport.send({
      to: session.user.email,
      subject: "Support Hub test email",
      bodyText:
        "This is a test message from Support Hub. If you are reading it, outgoing email is configured correctly.",
      inReplyTo: null,
      references: [],
    });
  } catch (error) {
    // The SMTP error text is the whole value of this endpoint — "authentication
    // failed" and "connection refused" call for entirely different fixes.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send the test email." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
