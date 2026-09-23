"use client";

import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Clock3,
  MailCheck,
  Maximize2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TimelineEntry } from "@/lib/workflow/timeline";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

type TimelineFilter = "all" | "agents" | "reviews";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function statusLabel(status: TimelineEntry["status"]): string {
  return label(status);
}

function statusVariant(
  status: TimelineEntry["status"]
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "rejected") return "destructive";
  if (status === "pending" || status === "auto_approved") return "secondary";
  if (status === "superseded") return "outline";
  return "default";
}

function EntryIcon({ entry }: { entry: TimelineEntry }) {
  if (entry.status === "pending") return <Clock3 className="size-4 text-amber-600" />;
  if (entry.status === "rejected") return <XCircle className="size-4 text-destructive" />;
  if (entry.status === "superseded") {
    return <RotateCcw className="size-4 text-muted-foreground" />;
  }
  if (entry.status === "auto_approved") {
    return <MailCheck className="size-4 text-emerald-600" />;
  }
  if (entry.kind === "agent") return <Bot className="size-4 text-primary" />;
  return <CheckCircle2 className="size-4 text-emerald-600" />;
}

export function RunTimeline({ entries }: { entries: TimelineEntry[] }) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          filter === "all" ||
          (filter === "agents" ? entry.kind === "agent" : entry.kind === "approval")
      ),
    [entries, filter]
  );
  const allOpen = filtered.length > 0 && filtered.every((entry) => openIds.has(entry.id));

  function toggleAll() {
    setOpenIds(allOpen ? new Set() : new Set(filtered.map((entry) => entry.id)));
  }

  return (
    <Card className="flex min-h-0 flex-col border-0 shadow-none">
      <CardHeader className="gap-3 border-b px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="size-4 text-primary" />
              Workflow activity
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {entries.length} {entries.length === 1 ? "event" : "events"} · inspect each step for details
            </p>
          </div>
          {filtered.length > 0 ? (
            <Button
              aria-label={allOpen ? "Collapse all logs" : "Expand all logs"}
              size="icon-xs"
              variant="ghost"
              onClick={toggleAll}
            >
              {allOpen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-1 rounded-md bg-muted/60 p-1">
          <SlidersHorizontal className="mx-1 size-3.5 text-muted-foreground" />
          {(["all", "agents", "reviews"] as const).map((value) => (
            <Button
              key={value}
              size="xs"
              variant={filter === value ? "secondary" : "ghost"}
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "All" : value === "agents" ? "Agents" : "Reviews"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="min-h-0 overflow-auto px-4 py-3">
        {filtered.length === 0 ? (
          <Empty className="min-h-48 p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {entries.length > 0 ? (
                  <CircleAlert className="text-muted-foreground" />
                ) : (
                  <CircleDot className="text-muted-foreground" />
                )}
              </EmptyMedia>
              <EmptyTitle className="text-sm normal-case tracking-normal">
                {entries.length > 0 ? "No matching events" : "No workflow runs yet"}
              </EmptyTitle>
              <EmptyDescription>
                {entries.length > 0
                  ? "Try another activity filter."
                  : "Workflow steps and review decisions will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="flex flex-col gap-2">
            {filtered.map((entry) => {
              const kindLabel = entry.kind === "agent" ? "Agent" : "Review";
              return (
                <li key={entry.id}>
                  <Task
                    open={openIds.has(entry.id)}
                    onOpenChange={(open) =>
                      setOpenIds((current) => {
                        const next = new Set(current);
                        if (open) next.add(entry.id);
                        else next.delete(entry.id);
                        return next;
                      })
                    }
                  >
                    <div className="rounded-md border bg-background px-3 py-3 transition-colors hover:bg-muted/20">
                      <TaskTrigger title={label(entry.label)}>
                        <div className="flex w-full items-center gap-3 text-left">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                            <EntryIcon entry={entry} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-xs font-semibold">
                                {label(entry.label)}
                              </span>
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                {kindLabel}
                              </Badge>
                              <Badge
                                variant={statusVariant(entry.status)}
                                className="px-1.5 py-0 text-[10px]"
                              >
                                {statusLabel(entry.status)}
                              </Badge>
                            </span>
                            <span className="mt-1 block text-[11px] text-muted-foreground">
                              {dateFormatter.format(entry.at)}
                            </span>
                          </span>
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                        </div>
                      </TaskTrigger>
                      <TaskContent>
                        <TaskItem>
                          <p className="whitespace-pre-wrap break-words text-xs leading-5 text-foreground/80">
                            {entry.detail}
                          </p>
                        </TaskItem>
                      </TaskContent>
                    </div>
                  </Task>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
