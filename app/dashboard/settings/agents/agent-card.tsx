"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AgentConfig } from "@/lib/agents/config";

// The Select primitive doesn't accept an empty string as a value, so the
// "use the default deployment" option gets a sentinel that's translated back
// to null right before it's sent to the API.
const DEFAULT_DEPLOYMENT_VALUE = "__default__";

export function AgentCard({
  agent,
  deployments,
}: {
  agent: AgentConfig;
  deployments: { id: string; deploymentName: string }[];
}) {
  const [prompt, setPrompt] = useState(agent.prompt);
  // The last server-confirmed prompt. This, not the original `agent` prop, is
  // the baseline `prompt` is diffed against — it's refreshed after every save
  // (see the resync in handleSave), so a save that only touches temperature
  // or isEnabled never re-sends an already-saved prompt.
  const [savedPrompt, setSavedPrompt] = useState(agent.prompt);
  const [temperature, setTemperature] = useState(String(agent.temperature));
  const [deploymentId, setDeploymentId] = useState(agent.aiDeploymentId ?? DEFAULT_DEPLOYMENT_VALUE);
  const [isEnabled, setIsEnabled] = useState(agent.isEnabled);
  const [version, setVersion] = useState(agent.promptVersion);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetches this agent's config and resyncs local state from it. Called
  // after every save attempt (success or failure) rather than trusting an
  // optimistic update, because the PUT route is not atomic: a prompt version
  // can be committed and then a later validation failure (e.g. a bad
  // temperature) can still return an error, leaving the server a step ahead
  // of whatever the card assumed. If the re-fetch itself fails, the last
  // known values are left alone rather than blanking the card.
  async function resyncFromServer() {
    try {
      const response = await fetch("/api/settings/agents");
      if (!response.ok) return;
      const payload = (await response.json()) as { agents?: Array<Record<string, unknown>> };
      const fresh = payload.agents?.find((candidate) => candidate.key === agent.key);
      if (!fresh) return;
      setPrompt(fresh.prompt as string);
      setSavedPrompt(fresh.prompt as string);
      setVersion(fresh.promptVersion as number);
      setTemperature(String(fresh.temperature));
      setDeploymentId((fresh.aiDeploymentId as string | null) ?? DEFAULT_DEPLOYMENT_VALUE);
      setIsEnabled(fresh.isEnabled as boolean);
    } catch {
      // Leave the card showing its last known values; the save error (if any)
      // is already surfaced separately.
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const parsedTemperature = temperature.trim() === "" ? NaN : Number(temperature);
      if (Number.isNaN(parsedTemperature)) {
        throw new Error("Temperature must be a number.");
      }

      const promptChanged = prompt !== savedPrompt;
      const response = await fetch("/api/settings/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: agent.key,
          ...(promptChanged ? { prompt } : {}),
          // These three are deliberately resent on every save, even when
          // unchanged, so the route always has the full current config to
          // validate and persist together with any prompt change.
          aiDeploymentId: deploymentId === DEFAULT_DEPLOYMENT_VALUE ? null : deploymentId,
          temperature: parsedTemperature,
          isEnabled,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to save the agent.");
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save the agent.");
    } finally {
      await resyncFromServer();
      setSaving(false);
    }
  }

  return (
    <section
      data-testid={`agent-card-${agent.key}`}
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{agent.name}</h2>
          <p className="text-sm text-muted-foreground">{agent.description}</p>
        </div>
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label="Enabled" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`prompt-${agent.key}`}>Prompt</Label>
        <Textarea
          id={`prompt-${agent.key}`}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={12}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`model-${agent.key}`}>Model</Label>
          <Select value={deploymentId} onValueChange={setDeploymentId}>
            <SelectTrigger id={`model-${agent.key}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_DEPLOYMENT_VALUE}>
                Use the default chat deployment
              </SelectItem>
              {deployments.map((deployment) => (
                <SelectItem key={deployment.id} value={deployment.id}>
                  {deployment.deploymentName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`temperature-${agent.key}`}>Temperature</Label>
          <Input
            id={`temperature-${agent.key}`}
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <span data-testid="agent-prompt-version" className="text-sm text-muted-foreground">
          Version {version}
        </span>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </section>
  );
}
