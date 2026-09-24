"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DeploymentRole } from "@/lib/ai/config";

const ROLES: DeploymentRole[] = ["chat", "embedding"];
const ROLE_LABELS: Record<DeploymentRole, string> = {
  chat: "Chat",
  embedding: "Embedding",
};

interface DeploymentRowView {
  id: string;
  role: DeploymentRole;
  deploymentName: string;
  modelName: string;
  dimensions: number | null;
  isActive: boolean;
  updatedAt: string;
}

async function postJson(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload;
}

function CredentialsForm({
  endpoint,
  apiVersion,
  hasApiKey,
}: {
  endpoint: string;
  apiVersion: string;
  hasApiKey: boolean;
}) {
  const router = useRouter();
  const [endpointValue, setEndpointValue] = useState(endpoint);
  const [apiVersionValue, setApiVersionValue] = useState(apiVersion);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (apiKeyValue.trim() === "" && !hasApiKey) {
        throw new Error("An API key is required.");
      }

      // Sending "" would overwrite a stored key with an empty one, so the
      // field is omitted entirely when the user hasn't typed a replacement;
      // the route then keeps the key already on file.
      const body: { endpoint: string; apiVersion: string; apiKey?: string } = {
        endpoint: endpointValue,
        apiVersion: apiVersionValue,
      };
      if (apiKeyValue.trim() !== "") {
        body.apiKey = apiKeyValue;
      }
      await postJson("/api/settings/ai-provider", "PUT", body);
      setApiKeyValue("");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-endpoint">Endpoint</Label>
        <Input
          id="ai-endpoint"
          placeholder="https://your-resource.openai.azure.com"
          value={endpointValue}
          onChange={(event) => setEndpointValue(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-api-version">API version</Label>
        <Input
          id="ai-api-version"
          placeholder="2024-10-21"
          value={apiVersionValue}
          onChange={(event) => setApiVersionValue(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-api-key">API key</Label>
        <Input
          id="ai-api-key"
          type="password"
          placeholder={hasApiKey ? "Stored — type to replace" : ""}
          value={apiKeyValue}
          onChange={(event) => setApiKeyValue(event.target.value)}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}

function AddDeploymentForm() {
  const router = useRouter();
  const [role, setRole] = useState<DeploymentRole>("chat");
  const [deploymentName, setDeploymentName] = useState("");
  const [modelName, setModelName] = useState("");
  const [dimensions, setDimensions] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/settings/ai-provider/deployments", "POST", {
        role,
        deploymentName,
        modelName,
        dimensions: role === "embedding" && dimensions.trim() !== "" ? Number(dimensions) : null,
      });
      setDeploymentName("");
      setModelName("");
      setDimensions("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="deployment-role">Role</Label>
        <Select value={role} onValueChange={(value) => setRole(value as DeploymentRole)}>
          <SelectTrigger id="deployment-role" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((option) => (
              <SelectItem key={option} value={option}>
                {ROLE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="deployment-name">Deployment name</Label>
        <Input
          id="deployment-name"
          value={deploymentName}
          onChange={(event) => setDeploymentName(event.target.value)}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="model-name">Model name</Label>
        <Input
          id="model-name"
          value={modelName}
          onChange={(event) => setModelName(event.target.value)}
        />
      </div>
      {role === "embedding" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dimensions">Dimensions</Label>
          <Input
            id="dimensions"
            type="number"
            className="w-28"
            value={dimensions}
            onChange={(event) => setDimensions(event.target.value)}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Button type="submit" disabled={saving}>
          {saving ? "Adding..." : "Add deployment"}
        </Button>
      </div>
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </form>
  );
}

function TestButton({ role }: { role: DeploymentRole }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch("/api/settings/ai-provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      setResult(payload);
    } catch {
      setResult({ ok: false, error: "Request failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
        {testing ? "Testing..." : "Test"}
      </Button>
      {result ? (
        <span className={`text-sm ${result.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {result.ok ? "Success." : result.error}
        </span>
      ) : null}
    </div>
  );
}

function DeploymentsTable({ deployments }: { deployments: DeploymentRowView[] }) {
  const router = useRouter();
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDeactivate(id: string) {
    setDeactivatingId(id);
    setError(null);
    try {
      await postJson(`/api/settings/ai-provider/deployments?id=${id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeactivatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Deployment</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Dimensions</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {deployments.map((deployment) => (
            <TableRow key={deployment.id}>
              <TableCell>{ROLE_LABELS[deployment.role]}</TableCell>
              <TableCell>{deployment.deploymentName}</TableCell>
              <TableCell>{deployment.modelName}</TableCell>
              <TableCell>{deployment.dimensions ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={deployment.isActive ? "default" : "secondary"}>
                  {deployment.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                {deployment.isActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deactivatingId === deployment.id}
                    onClick={() => handleDeactivate(deployment.id)}
                  >
                    {deactivatingId === deployment.id ? "Deactivating..." : "Deactivate"}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}

export function ProviderForm({
  endpoint,
  apiVersion,
  hasApiKey,
  deployments,
}: {
  endpoint: string;
  apiVersion: string;
  hasApiKey: boolean;
  deployments: DeploymentRowView[];
}) {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Credentials</h2>
        <CredentialsForm endpoint={endpoint} apiVersion={apiVersion} hasApiKey={hasApiKey} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Deployments</h2>
        <DeploymentsTable deployments={deployments} />
        <AddDeploymentForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Connection test</h2>
        <div className="flex flex-col gap-2">
          {ROLES.map((role) => (
            <div key={role} className="flex items-center gap-3">
              <span className="w-24 text-sm">{ROLE_LABELS[role]}</span>
              <TestButton role={role} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
