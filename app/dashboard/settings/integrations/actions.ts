"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { setSecret } from "@/lib/secrets/store";

export async function saveGoogleCredentials(clientId: string, clientSecret: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    throw new Error("Only admins can edit integration credentials.");
  }

  await setSecret("google_client_id", clientId, session.user.id);
  await setSecret("google_client_secret", clientSecret, session.user.id);
}
