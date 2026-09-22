"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SmtpConfig } from "@/lib/mail/config";

const EMPTY: SmtpConfig = {
  host: "",
  port: 587,
  secure: false,
  username: "",
  fromAddress: "",
  fromName: "",
};

export function EmailSettingsForm({
  initialName,
  initialConfig,
}: {
  initialName: string;
  initialConfig: SmtpConfig | null;
}) {
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState<SmtpConfig>(initialConfig ?? EMPTY);
  // Always starts blank: the server never sends the stored password back, and
  // a blank submission means "keep it".
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Tracks whether a transport now exists, independent of the initial server
  // prop, so the test button enables immediately after a first-time save
  // instead of waiting for a page reload.
  const [configured, setConfigured] = useState(initialConfig !== null);

  function set<K extends keyof SmtpConfig>(key: K, value: SmtpConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function post(url: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch(url, {
        method: body === undefined ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setStatus(payload?.error ?? "Something went wrong.");
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const ok = await post("/api/settings/email", {
      name,
      config,
      ...(password === "" ? {} : { password }),
    });
    if (ok) {
      setStatus("Saved.");
      setPassword("");
      setConfigured(true);
    }
  }

  async function handleTest() {
    if (await post("/api/settings/email/test")) {
      setStatus("Test email sent.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="host">Host</Label>
          <Input id="host" value={config.host} onChange={(event) => set("host", event.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            type="number"
            value={config.port}
            onChange={(event) => set("port", Number(event.target.value))}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="secure"
          checked={config.secure}
          onCheckedChange={(checked) => set("secure", checked)}
        />
        <Label htmlFor="secure">Connect with implicit TLS (used on 465)</Label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={config.username}
            onChange={(event) => set("username", event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            placeholder={initialConfig ? "Unchanged" : ""}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fromAddress">From address</Label>
          <Input
            id="fromAddress"
            value={config.fromAddress}
            onChange={(event) => set("fromAddress", event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fromName">From name</Label>
          <Input
            id="fromName"
            value={config.fromName}
            onChange={(event) => set("fromName", event.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={busy}>
          Save
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={busy || !configured}>
          Send test email
        </Button>
        {status ? (
          <span data-testid="email-settings-status" className="text-sm text-muted-foreground">
            {status}
          </span>
        ) : null}
      </div>
    </div>
  );
}
