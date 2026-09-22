import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { listAgentConfigs } from "@/lib/agents/config";
import { listDeployments } from "@/lib/ai/config";
import { AgentCard } from "./agent-card";

export default async function AgentSettingsPage() {
  // The nav hides this link from non-admins, but that alone doesn't stop
  // direct navigation — the layout only checks for a session, not a role.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const [agents, deployments] = await Promise.all([listAgentConfigs(), listDeployments()]);
  const chatDeployments = deployments
    .filter((deployment) => deployment.role === "chat")
    .map((deployment) => ({ id: deployment.id, deploymentName: deployment.deploymentName }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Each step of the ticket workflow is handled by one agent. Editing a prompt saves a new
          version; the previous one is kept.
        </p>
      </div>
      {agents.map((agent) => (
        <AgentCard key={agent.key} agent={agent} deployments={chatDeployments} />
      ))}
    </div>
  );
}
