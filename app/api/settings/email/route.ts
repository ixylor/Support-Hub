import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getActiveTransportConfig, saveTransport, type SmtpConfig } from "@/lib/mail/config";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return null;
  }
  return session.user as { id: string };
}

// Deliberately permissive: enough to catch a typo, not an attempt to validate
// the RFC. A wrong-but-well-formed address surfaces from the test send.
const ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseConfig(value: unknown): SmtpConfig | string {
  if (typeof value !== "object" || value === null) {
    return "config must be an object.";
  }

  const { host, port, secure, username, fromAddress, fromName } = value as Record<string, unknown>;

  if (typeof host !== "string" || host.trim() === "") return "host is required.";
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return "port must be an integer between 1 and 65535.";
  }
  if (typeof secure !== "boolean") return "secure must be a boolean.";
  if (typeof username !== "string") return "username must be a string.";
  if (typeof fromAddress !== "string" || !ADDRESS_PATTERN.test(fromAddress)) {
    return "fromAddress must be an email address.";
  }
  if (typeof fromName !== "string" || fromName.trim() === "") return "fromName is required.";

  return { host: host.trim(), port, secure, username, fromAddress, fromName };
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Only admins can view email settings." }, { status: 403 });
  }

  // getActiveTransportConfig omits the password by construction, so there is
  // no field here to accidentally forget to strip.
  return NextResponse.json({ transport: await getActiveTransportConfig() });
}

export async function PUT(request: Request) {
  const user = await requireAdmin();
  if (!user) {
    return NextResponse.json({ error: "Only admins can edit email settings." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { name, config, password } = (body ?? {}) as {
    name?: unknown;
    config?: unknown;
    password?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (password !== undefined && typeof password !== "string") {
    return NextResponse.json({ error: "password must be a string." }, { status: 400 });
  }

  const parsed = parseConfig(config);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  try {
    await saveTransport(
      {
        kind: "smtp",
        name: name.trim(),
        config: parsed,
        // An absent or blank field means the admin did not retype the
        // password, so the stored one stands.
        password: password === undefined || password === "" ? null : password,
      },
      user.id
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save email settings." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
