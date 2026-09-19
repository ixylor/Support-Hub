"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGoogleCredentials } from "./actions";

export default function IntegrationsSettingsPage() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await saveGoogleCredentials(clientId, clientSecret);
    setSaved(true);
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
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
      <Button onClick={handleSave}>Save</Button>
      {saved ? (
        <p className="text-sm text-muted-foreground">
          Saved. Restart the server for the new credentials to take effect.
        </p>
      ) : null}
    </div>
  );
}
