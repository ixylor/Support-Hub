"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Provider = "microsoft" | "google";

const PROVIDER_LABELS: Record<Provider, string> = {
  microsoft: "Microsoft 365",
  google: "Google Workspace",
};

const PROVIDER_OAUTH_DETAILS: Record<
  Provider,
  { permissions: { scope: string; purpose: string }[]; setup: string[] }
> = {
  google: {
    permissions: [
      {
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        purpose: "Read inbox messages and download their attachments.",
      },
      {
        scope: "https://www.googleapis.com/auth/gmail.send",
        purpose: "Send replies from the connected mailbox.",
      },
    ],
    setup: [
      "In Google Cloud Console, enable the Gmail API and create an OAuth client for a Web application.",
      "Add the redirect URI shown below to the OAuth client and configure the OAuth consent screen.",
      "Enter the OAuth client ID and secret here, save them, then connect the Google Workspace mailbox.",
    ],
  },
  microsoft: {
    permissions: [
      { scope: "User.Read", purpose: "Read the connected user’s basic profile to identify the mailbox." },
      { scope: "Mail.Read", purpose: "Read inbox messages and download their attachments." },
      { scope: "Mail.Send", purpose: "Send replies from the connected mailbox." },
      { scope: "offline_access", purpose: "Keep mailbox syncing in the background using a refresh token." },
    ],
    setup: [
      "In Microsoft Entra, register an app for accounts in any organizational directory (multitenant), then add a Web redirect URI shown below.",
      "Add Microsoft Graph delegated permissions User.Read, Mail.Read, and Mail.Send. Grant admin consent if your tenant requires it.",
      "Create a client secret. Enter the application (client) ID and secret here, save them, then connect the Microsoft 365 mailbox.",
    ],
  },
};

export function IntegrationsForm({
  connection,
  configuredProviders,
}: {
  connection: { provider: Provider; mailboxAddress: string; status: string } | null;
  configuredProviders: Record<string, boolean>;
}) {
  const [provider, setProvider] = useState<Provider>("microsoft");
  const redirectUri =
    typeof window === "undefined"
      ? "https://your-app-host/api/integrations/mailbox/callback"
      : `${window.location.origin}/api/integrations/mailbox/callback`;
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveCredentials() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/integrations/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, clientId, clientSecret }),
      });
      if (!response.ok) {
        throw new Error("Failed to save credentials.");
      }
      setSaved(true);
    } catch {
      setError("Failed to save credentials. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    await fetch("/api/integrations/mailbox/disconnect", { method: "POST" });
    window.location.reload();
  }

  if (connection) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Connected as <span className="font-medium">{connection.mailboxAddress}</span> (
          {PROVIDER_LABELS[connection.provider]}) — status: {connection.status}
        </p>
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-medium">Permissions requested for {PROVIDER_LABELS[connection.provider]}</p>
          <ul className="mt-3 space-y-2">
            {PROVIDER_OAUTH_DETAILS[connection.provider].permissions.map(({ scope, purpose }) => (
              <li key={scope} className="leading-5 text-muted-foreground">
                <code className="break-all text-foreground">{scope}</code> — {purpose}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-muted-foreground">
            These are the OAuth scopes Support Hub requests. Only one mailbox can be connected at a time;
            disconnect this mailbox before switching providers or reconnecting after a permission change.
          </p>
        </div>
        <Button variant="outline" onClick={handleDisconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  const canConnect = saved || configuredProviders[provider];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(Object.keys(PROVIDER_LABELS) as Provider[]).map((option) => (
          <Button
            key={option}
            variant={provider === option ? "default" : "outline"}
            onClick={() => {
              setProvider(option);
              setSaved(false);
            }}
          >
            {PROVIDER_LABELS[option]}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">OAuth setup for {PROVIDER_LABELS[provider]}</p>
        <ol className="mt-2 list-inside list-decimal space-y-1 leading-6 text-muted-foreground">
          {PROVIDER_OAUTH_DETAILS[provider].setup.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <p className="mt-3 font-medium">Permissions Support Hub requests</p>
        <ul className="mt-2 space-y-2">
          {PROVIDER_OAUTH_DETAILS[provider].permissions.map(({ scope, purpose }) => (
            <li key={scope} className="leading-5 text-muted-foreground">
              <code className="break-all text-foreground">{scope}</code> — {purpose}
            </li>
          ))}
        </ul>
        {provider === "google" ? (
          <p className="mt-3 text-muted-foreground">
            Google classifies <code>gmail.readonly</code> as a restricted scope. Production use with
            external workspaces requires OAuth verification; because Support Hub processes mail on
            its server, Google may also require a security assessment.
          </p>
        ) : null}
        <p className="mt-3 text-muted-foreground">OAuth redirect URI</p>
        <code className="mt-1 block break-all text-foreground">{redirectUri}</code>
      </div>

      <Input placeholder="OAuth client ID" value={clientId} onChange={(event) => setClientId(event.target.value)} />
      <Input
        placeholder="OAuth client secret"
        type="password"
        value={clientSecret}
        onChange={(event) => setClientSecret(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button onClick={handleSaveCredentials} disabled={saving}>
          {saving ? "Saving..." : "Save credentials"}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>

      {canConnect ? (
        <a href={`/api/integrations/mailbox/connect?provider=${provider}`}>
          <Button>Connect {PROVIDER_LABELS[provider]} mailbox</Button>
        </a>
      ) : null}
    </div>
  );
}
