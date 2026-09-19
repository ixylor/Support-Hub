import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Proxy is not meant for slow data fetching or full session management (see
// Next.js's own guidance) — this is only an optimistic, cookie-presence
// check. The dashboard layout does the authoritative auth.api.getSession
// lookup (including the role check further down in settings pages), so an
// expired-but-cookie-present session still gets caught there. This avoids
// doing a full DB-backed session lookup twice per dashboard request.
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
