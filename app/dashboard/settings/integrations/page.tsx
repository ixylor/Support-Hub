import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getActiveMailboxConnection } from "@/lib/mailbox/connection";
import { getSecret } from "@/lib/secrets/store";
import { clientIdSecretKey, MAILBOX_OAUTH_PROVIDERS } from "@/lib/mailbox/oauth-credentials";
import { IntegrationsForm } from "./integrations-form";

export default async function IntegrationsSettingsPage() {
  // The nav hides this link from non-admins, but that alone doesn't stop
  // direct navigation — the layout only checks for a session, not a role.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const connection = await getActiveMailboxConnection();
  const configuredProviders: Record<string, boolean> = {};
  for (const provider of MAILBOX_OAUTH_PROVIDERS) {
    configuredProviders[provider] = (await getSecret(clientIdSecretKey(provider))) !== null;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Mailbox Integration</h1>
      <IntegrationsForm connection={connection} configuredProviders={configuredProviders} />
    </div>
  );
}
