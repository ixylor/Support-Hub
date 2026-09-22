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
  const [temperature, setTemperature] = useState(String(agent.temperature));
  const [deploymentId, setDeploymentId] = useState(agent.aiDeploymentId ?? DEFAULT_DEPLOYMENT_VALUE);
  const [isEnabled, setIsEnabled] = useState(agent.isEnabled);
  const [version, setVersion] = useState(agent.promptVersion);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const promptChanged = prompt !== agent.prompt;
      const response = await fetch("/api/settings/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: agent.key,
          ...(promptChanged ? { prompt } : {}),
          aiDeploymentId: deploymentId === DEFAULT_DEPLOYMENT_VALUE ? null : deploymentId,
          temperature: Number(temperature),
          isEnabled,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to save the agent.");
      }
      if (promptChanged) {
        setVersion((current) => current + 1);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save the agent.");
    } finally {
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
