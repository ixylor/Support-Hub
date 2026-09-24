import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getActiveMailboxConnection } from "@/lib/mailbox/connection";
import { getSecret } from "@/lib/secrets/store";
import { clientIdSecretKey, MAILBOX_OAUTH_PROVIDERS } from "@/lib/mailbox/oauth-credentials";
import { IntegrationsForm } from "./integrations-form";

const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  mailbox_already_connected: "Disconnect the current mailbox before connecting another one.",
};

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
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

  const rawError = (await searchParams).error;
  const errorCode = Array.isArray(rawError) ? rawError[0] : rawError;
  const callbackError = errorCode
    ? (CALLBACK_ERROR_MESSAGES[errorCode] ?? "Something went wrong connecting the mailbox. Please try again.")
    : null;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Mailbox Integration</h1>
      {callbackError ? <p className="mb-4 text-sm text-destructive">{callbackError}</p> : null}
      <IntegrationsForm connection={connection} configuredProviders={configuredProviders} />
    </div>
  );
}
