import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { ArrowRight, BookOpen, Inbox, Settings2 } from "lucide-react";
import { Logo } from "@/components/branding/logo";
import { auth } from "@/lib/auth/server";
import { getAzureCredentials, getActiveDeployment } from "@/lib/ai/config";
import { getActiveMailboxConnection } from "@/lib/mailbox/connection";
import { getActiveTransportConfig } from "@/lib/mail/config";
import { getWorkflowSettings } from "@/lib/workflow/settings";

const destinations = [
  { href: "/dashboard/tickets", label: "Open tickets", description: "Review conversations and follow up with customers.", icon: Inbox },
  { href: "/dashboard/knowledge-base", label: "Knowledge base", description: "Keep answers and internal guidance easy to find.", icon: BookOpen },
  { href: "/dashboard/settings/agents", label: "Configure agents", description: "Tune workflows, models, and support automation.", icon: Settings2 },
];

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
  const visibleDestinations = isAdmin ? destinations : destinations.slice(0, 1);
  const setupState = isAdmin
    ? await Promise.all([
        getAzureCredentials(),
        getActiveDeployment("chat"),
        getActiveMailboxConnection(),
        getActiveTransportConfig(),
        getWorkflowSettings(),
      ])
    : null;
  const setupIncomplete =
    isAdmin &&
    setupState !== null &&
    !(setupState[0] && setupState[1] && setupState[2] && setupState[3] && setupState[4].isEnabled);

  // Keep the first admin visit focused: the setup checklist is the only
  // useful destination until the required connections exist.
  if (setupIncomplete) {
    redirect("/dashboard/setup");
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-5 py-8 sm:px-8 sm:py-10">
        <div className="relative max-w-2xl">
          <Logo size="sm" className="mb-5 text-primary" />
          <p className="mb-2 text-xs text-muted-foreground">Support workspace</p>
          <h1 className="text-xl font-semibold tracking-tight">Keep every customer conversation moving.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Start with your inbox, find a trusted answer, or adjust the tools that help your team respond with confidence.
          </p>
        </div>
        <div className="pointer-events-none absolute -right-16 -bottom-24 size-64 rounded-full bg-primary/10 blur-3xl" />
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Jump back in</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose a workspace to get started.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {visibleDestinations.map(({ href, label, description, icon: Icon }) => (
            <Link key={href} href={href} className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="mb-8 flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
                <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
