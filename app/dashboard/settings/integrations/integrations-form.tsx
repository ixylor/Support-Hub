"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function IntegrationsForm() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/settings/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      if (!response.ok) {
        throw new Error("Failed to save integration credentials.");
      }
      setSaved(true);
    } catch {
      setError("Failed to save integration credentials. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Google OAuth</h1>
      <div className="flex flex-col gap-2">
        <Label htmlFor="google-client-id">Client ID</Label>
        <Input id="google-client-id" value={clientId} onChange={(event) => setClientId(event.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="google-client-secret">Client Secret</Label>
        <Input
          id="google-client-secret"
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
      {saved ? (
        <p className="text-sm text-muted-foreground">
          Saved. Restart the server for the new credentials to take effect.
        </p>
      ) : null}
    </div>
  );
}
