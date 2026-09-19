import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { IntegrationsForm } from "./integrations-form";

export default async function IntegrationsSettingsPage() {
  // The nav hides this link from non-admins, but that alone doesn't stop
  // direct navigation — the layout only checks for a session, not a role.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="max-w-md">
      <IntegrationsForm />
    </div>
  );
}
