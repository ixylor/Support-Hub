import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getAzureCredentials, listDeployments } from "@/lib/ai/config";
import { ProviderForm } from "./provider-form";

export default async function AiProviderSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const credentials = await getAzureCredentials();
  const deployments = await listDeployments();

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">AI Provider</h1>
        <p className="text-muted-foreground text-sm">
          Azure OpenAI credentials and the model deployments this application uses.
        </p>
      </div>
      <ProviderForm
        // The key is never sent to the browser; the form shows whether one is
        // stored and replaces it only when a new value is typed.
        endpoint={credentials?.endpoint ?? ""}
        apiVersion={credentials?.apiVersion ?? ""}
        hasApiKey={credentials !== null}
        deployments={deployments.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() }))}
      />
    </div>
  );
}
