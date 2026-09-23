"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WorkflowSettings } from "@/lib/workflow/settings";

export function WorkflowPanel({ initial }: { initial: WorkflowSettings }) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/settings/workflow", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setStatus(response.ok ? "Saved." : (payload?.error ?? "Failed to save."));
    } catch {
      setStatus("Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <h2 className="font-medium">Workflow</h2>

      <div className="flex items-center gap-3">
        <Switch
          id="isEnabled"
          checked={settings.isEnabled}
          onCheckedChange={(checked) => setSettings({ ...settings, isEnabled: checked })}
        />
        <Label htmlFor="isEnabled">Run the workflow on new tickets</Label>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="requireApproval"
          checked={settings.requireApproval}
          onCheckedChange={(checked) => setSettings({ ...settings, requireApproval: checked })}
        />
        <Label htmlFor="requireApproval">Require a human to approve every decision</Label>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="floor">Auto-approve above confidence</Label>
        <Input
          id="floor"
          type="number"
          min={0}
          max={1}
          step={0.05}
          disabled={settings.requireApproval}
          value={settings.autoSendMinConfidence}
          onChange={(event) =>
            setSettings({ ...settings, autoSendMinConfidence: Number(event.target.value) })
          }
        />
        <p className="text-sm text-muted-foreground">
          Anything the system is less sure about than this still waits for a person.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          Save
        </Button>
        {status ? (
          <span data-testid="workflow-status" className="text-sm text-muted-foreground">
            {status}
          </span>
        ) : null}
      </div>
    </section>
  );
}
