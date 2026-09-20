"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Provider = "microsoft" | "google";

const PROVIDER_LABELS: Record<Provider, string> = {
  microsoft: "Microsoft 365",
  google: "Google Workspace",
};

export function IntegrationsForm({
  connection,
  configuredProviders,
}: {
  connection: { provider: Provider; mailboxAddress: string; status: string } | null;
  configuredProviders: Record<string, boolean>;
}) {
  const [provider, setProvider] = useState<Provider>("microsoft");
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
