import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { isThemeValue, THEME_COOKIE_MAX_AGE, THEME_COOKIE_NAME } from "@/lib/theme";

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { theme?: unknown } | null;
  if (!body || !isThemeValue(body.theme)) {
    return NextResponse.json({ error: "theme must be light, dark, or system." }, { status: 400 });
  }

  (await cookies()).set(THEME_COOKIE_NAME, body.theme, {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
  });

  return NextResponse.json({ ok: true });
}
