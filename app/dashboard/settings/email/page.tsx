import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getActiveTransportConfig } from "@/lib/mail/config";
import { EmailSettingsForm } from "./email-settings-form";

export default async function EmailSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const transport = await getActiveTransportConfig();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Email</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Outgoing mail settings. Send a test message before relying on these — a wrong password
        should not be discovered from a customer&apos;s ticket.
      </p>
      <EmailSettingsForm
        initialName={transport?.name ?? "Primary"}
        initialConfig={transport?.config ?? null}
      />
    </div>
  );
}
