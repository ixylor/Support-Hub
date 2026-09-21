import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { getAzureCredentials, setAzureCredentials } from "@/lib/ai/config";

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    return NextResponse.json({ error: "Only admins can change AI settings." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
    apiKey?: unknown;
    apiVersion?: unknown;
  } | null;

  if (
    !body ||
    typeof body.endpoint !== "string" ||
    typeof body.apiVersion !== "string" ||
    body.endpoint.trim() === "" ||
    body.apiVersion.trim() === "" ||
    (body.apiKey !== undefined && typeof body.apiKey !== "string")
  ) {
    return NextResponse.json(
      { error: "endpoint and apiVersion are required." },
      { status: 400 }
    );
  }

  // The key is never sent back to the browser, so the client omits it when
  // leaving the stored value untouched; only a non-empty apiKey replaces it.
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  let resolvedApiKey = apiKey;
  if (resolvedApiKey === "") {
    const existing = await getAzureCredentials();
    if (!existing) {
      return NextResponse.json({ error: "An API key is required." }, { status: 400 });
    }
    resolvedApiKey = existing.apiKey;
  }

  await setAzureCredentials(
    {
      endpoint: body.endpoint.trim(),
      apiKey: resolvedApiKey,
      apiVersion: body.apiVersion.trim(),
    },
    session.user.id
  );

  return NextResponse.json({ ok: true });
}
