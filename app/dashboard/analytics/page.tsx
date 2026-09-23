import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  Inbox,
  MessageSquareText,
  ShieldCheck,
  TrendingUp,
  Workflow,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/lib/auth/server";
import { getAnalyticsSnapshot, type AnalyticsSnapshot } from "@/lib/analytics/queries";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabels: Record<AnalyticsSnapshot["ticketStatuses"][number]["status"], string> = {
  new: "New",
  pending_review: "Pending review",
  approved: "Approved",
  escalated: "Escalated",
  resolved: "Resolved",
  waiting_on_customer: "Waiting on customer",
  triaged_out: "Triaged out",
};

const statusColors: Record<AnalyticsSnapshot["ticketStatuses"][number]["status"], string> = {
  new: "bg-sky-500",
  pending_review: "bg-amber-500",
  approved: "bg-emerald-500",
  escalated: "bg-rose-500",
  resolved: "bg-slate-400",
  waiting_on_customer: "bg-violet-500",
  triaged_out: "bg-slate-300",
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  iconClassName = "text-primary",
}: {
  label: string;
  value: string;
  description: string;
  icon: typeof Inbox;
  iconClassName?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">{label}</p>
          <p className="mt-3 font-heading text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className={`size-5 ${iconClassName}`} />
        </span>
      </CardContent>
    </Card>
  );
}

function TicketHealth({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const maxCount = Math.max(...snapshot.ticketStatuses.map((item) => item.count), 1);

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2"><Inbox className="size-4 text-primary" /> Ticket health</CardTitle>
        <CardDescription>Where conversations are in the support workflow.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {snapshot.ticketStatuses.length === 0 ? (
          <Empty className="min-h-36 p-4">
            <EmptyHeader>
              <EmptyTitle>No ticket activity yet</EmptyTitle>
              <EmptyDescription>Tickets will appear here when the mailbox is connected.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          snapshot.ticketStatuses.map(({ status, count }) => (
            <div key={status} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`size-2 rounded-full ${statusColors[status]}`} aria-hidden="true" />
                  <span className="truncate">{statusLabels[status]}</span>
                </span>
                <span className="font-medium tabular-nums">{formatNumber(count)}</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={`${statusLabels[status]} tickets`}
                aria-valuemin={0}
                aria-valuemax={maxCount}
                aria-valuenow={count}
              >
                <div
                  className={`h-full rounded-full transition-[width] ${statusColors[status]}`}
                  style={{ width: `${Math.max((count / maxCount) * 100, count > 0 ? 3 : 0)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ApprovalOverview({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  const { approvalTotals } = snapshot;

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Approval control</CardTitle>
        <CardDescription>Human review and automated decision outcomes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">Approval rate</p>
            <p className="mt-2 font-heading text-3xl font-semibold tabular-nums">
              {approvalTotals.approvalRate === null ? "—" : `${approvalTotals.approvalRate}%`}
            </p>
          </div>
          <Badge variant={approvalTotals.pending > 0 ? "outline" : "secondary"} className={approvalTotals.pending > 0 ? "text-amber-600 dark:text-amber-400" : undefined}>
            <Clock3 /> {formatNumber(approvalTotals.pending)} pending
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <DecisionStat label="Approved" value={approvalTotals.approved} icon={CheckCircle2} className="text-emerald-600 dark:text-emerald-400" />
          <DecisionStat label="Rejected" value={approvalTotals.rejected} icon={XCircle} className="text-rose-600 dark:text-rose-400" />
          <DecisionStat label="Superseded" value={approvalTotals.superseded} icon={Archive} className="text-muted-foreground" />
          <DecisionStat label="Total" value={approvalTotals.total} icon={Activity} className="text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionStat({
  label,
  value,
  icon: Icon,
  className,
}: {
  label: string;
  value: number;
  icon: typeof CheckCircle2;
  className: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <Icon className={`mb-2 size-4 ${className}`} />
      <p className="text-lg font-semibold tabular-nums">{formatNumber(value)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function WorkflowTable({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2"><Workflow className="size-4 text-primary" /> Workflow throughput</CardTitle>
        <CardDescription>LLM calls recorded by workflow agent.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {snapshot.workflowAgents.length === 0 ? (
          <Empty className="min-h-40 p-5">
            <EmptyHeader>
              <EmptyTitle>No workflow runs yet</EmptyTitle>
              <EmptyDescription>Workflow activity will be summarized after the first ticket run.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Runs</TableHead>
                <TableHead className="text-right">Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.workflowAgents.map((agent) => (
                <TableRow key={agent.id ?? agent.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary"><Bot className="size-3.5" /></span>
                      <span className="font-medium">{agent.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatNumber(agent.calls)}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {agent.lastRunAt ? dateFormatter.format(agent.lastRunAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity({ snapshot }: { snapshot: AnalyticsSnapshot }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2"><Activity className="size-4 text-primary" /> Recent activity</CardTitle>
        <CardDescription>The latest workflow and approval events.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {snapshot.recentActivity.length === 0 ? (
          <Empty className="min-h-40 p-5">
            <EmptyHeader>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>New workflow events will show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y">
            {snapshot.recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 px-5 py-4">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  {activity.kind === "workflow" ? <Bot className="size-4 text-primary" /> : <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-medium">{activity.label}</p>
                    <Badge variant="secondary">{activity.kind}</Badge>
                  </div>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">{activity.detail}</p>
                </div>
                <time className="shrink-0 text-right text-xs text-muted-foreground" dateTime={activity.at.toISOString()}>
                  {dateFormatter.format(activity.at)}
                </time>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AnalyticsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role?: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const snapshot = await getAnalyticsSnapshot();
  const { ticketTotals, messageTotals, approvalTotals } = snapshot;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">Admin workspace</p>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Analytics</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            A live view of support volume, review decisions, and workflow throughput.
          </p>
        </div>
        <Link href="/dashboard/tickets" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline hover:underline-offset-4">
          Open ticket inbox <ArrowUpRight className="size-4" />
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
        <MetricCard label="All tickets" value={formatNumber(ticketTotals.total)} description={`${formatNumber(ticketTotals.open)} currently active`} icon={Inbox} />
        <MetricCard label="Messages" value={formatNumber(messageTotals.total)} description={`${formatNumber(messageTotals.inbound)} inbound · ${formatNumber(messageTotals.outbound)} outbound`} icon={MessageSquareText} iconClassName="text-sky-600 dark:text-sky-400" />
        <MetricCard label="Pending review" value={formatNumber(ticketTotals.pendingReview)} description="Tickets waiting for a workflow decision" icon={Clock3} iconClassName="text-amber-600 dark:text-amber-400" />
        <MetricCard label="Approval rate" value={approvalTotals.approvalRate === null ? "—" : `${approvalTotals.approvalRate}%`} description={`${formatNumber(approvalTotals.decided)} decisions recorded`} icon={TrendingUp} iconClassName="text-emerald-600 dark:text-emerald-400" />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <TicketHealth snapshot={snapshot} />
        <ApprovalOverview snapshot={snapshot} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <WorkflowTable snapshot={snapshot} />
        <RecentActivity snapshot={snapshot} />
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="size-3.5" /> Metrics are calculated from the current ticket, message, approval, and workflow records.
      </p>
    </div>
  );
}
