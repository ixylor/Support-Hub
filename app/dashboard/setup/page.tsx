import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Cable,
  CheckCircle2,
  CircleAlert,
  Mail,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { getAzureCredentials, getActiveDeployment } from "@/lib/ai/config";
import { getActiveMailboxConnection } from "@/lib/mailbox/connection";
import { getActiveTransportConfig } from "@/lib/mail/config";
import { getWorkflowSettings } from "@/lib/workflow/settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { buttonVariants } from "@/components/ui/button";

type SetupStep = {
  label: string;
  description: string;
  href: string;
  ready: boolean;
  icon: LucideIcon;
};

export default async function SetupPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role?: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const [azure, chat, mailbox, email, workflow] = await Promise.all([
    getAzureCredentials(),
    getActiveDeployment("chat"),
    getActiveMailboxConnection(),
    getActiveTransportConfig(),
    getWorkflowSettings(),
  ]);

  const workflowReady =
    workflow.isEnabled &&
    Number.isFinite(workflow.autoSendMinConfidence) &&
    workflow.autoSendMinConfidence >= 0 &&
    workflow.autoSendMinConfidence <= 1;

  const steps: SetupStep[] = [
    {
      label: "AI provider",
      description: "Connect Azure OpenAI and activate a chat deployment.",
      href: "/dashboard/settings/ai-provider",
      ready: Boolean(azure && chat),
      icon: Sparkles,
    },
    {
      label: "Email transport",
      description: "Configure SMTP so Support Hub can send replies.",
      href: "/dashboard/settings/email",
      ready: Boolean(email),
      icon: Mail,
    },
    {
      label: "Support mailbox",
      description: "Connect the inbox that receives customer requests.",
      href: "/dashboard/settings/integrations",
      ready: Boolean(mailbox),
      icon: Cable,
    },
    {
      label: "Workflow",
      description: workflowReady
        ? `${workflow.requireApproval ? "Approval required" : "Auto-send enabled"} · confidence floor ${workflow.autoSendMinConfidence}`
        : "Enable the workflow and choose how approvals should be handled.",
      href: "/dashboard/settings/agents",
      ready: workflowReady,
      icon: Settings2,
    },
  ];

  const complete = steps.filter((step) => step.ready).length;
  const percent = Math.round((complete / steps.length) * 100);
  const ready = complete === steps.length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <p className="text-xs text-muted-foreground">First-time setup</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          Let&apos;s get Support Hub ready.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Connect the services Support Hub needs to receive, understand, and send customer
          conversations. You can revisit any step from Settings later.
        </p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Setup checklist</CardTitle>
              <CardDescription className="mt-1 tabular-nums">
                {complete} of {steps.length} required steps complete
              </CardDescription>
            </div>
            <Badge variant={ready ? "default" : "secondary"} className="w-fit">
              {ready ? "Ready to go" : "In progress"}
            </Badge>
          </div>
          <Progress value={percent} aria-label={`${percent}% of setup complete`} className="mt-2">
            <ProgressLabel>Progress</ProgressLabel>
            <ProgressValue />
          </Progress>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {steps.map(({ label, description, href, ready: stepReady, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="group flex items-center gap-4 px-5 py-5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                  stepReady
                    ? "bg-success-subtle text-success"
                    : "bg-warning-subtle text-warning"
                }`}
              >
                {stepReady ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {label}
                  {!stepReady ? <Badge variant="outline">Required</Badge> : null}
                </span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                  {description}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="hidden sm:inline">
                  {stepReady ? (
                    "Configured"
                  ) : (
                    <span className="flex items-center gap-1">
                      <CircleAlert className="size-3.5" /> Needs setup
                    </span>
                  )}
                </span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {ready ? (
        <div className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success-subtle p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Your workspace is ready.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start reviewing conversations in the inbox.
            </p>
          </div>
          <Link href="/dashboard/tickets" className={buttonVariants({ size: "sm" })}>
            Open tickets <ArrowRight />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
