"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { RiErrorWarningLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
  STATUS_LABELS,
  STATUS_VARIANTS,
  type TicketStatus,
} from "@/lib/tickets/labels";
import type { TicketAssignee, TicketPriority } from "@/lib/tickets/queries";
import { cn } from "cn";
import { AssigneeCombobox } from "./assignee-combobox";

type AssignPayload = {
  assigneeUserId?: string | null;
  priority?: TicketPriority | null;
};

type StatusPayload = { status: TicketStatus };

const STATUS_OPTIONS: TicketStatus[] = [
  "new",
  "pending_review",
  "approved",
  "escalated",
  "waiting_on_customer",
  "resolved",
  "triaged_out",
];

const TERMINAL_STATUSES: TicketStatus[] = ["resolved", "triaged_out"];

// Shared plumbing for both pickers: POST the one field that changed, then
// let the server re-render the row. Fields left out are untouched, so
// changing a priority can't clobber an assignee set from another tab.
function useInlineAssign(ticketId: string) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(payload: AssignPayload) {
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("Assignment failed.");
      }
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return { submit, saving, failed };
}

function useStatusUpdate(ticketId: string) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit({ status }: StatusPayload) {
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("Status update failed.");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return { submit, saving, failed };
}

// A cell that looks like plain text until you hover it, the way GitHub's
// sidebar fields do.
const TRIGGER_CLASS =
  "-mx-2 flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-60";

function FailureMark({ failed }: { failed: boolean }) {
  if (!failed) {
    return null;
  }
  return (
    <RiErrorWarningLine
      className="size-3.5 shrink-0 text-destructive"
      aria-label="Could not save. Try again."
    />
  );
}

export function AssigneePicker({
  ticketId,
  currentAssignee,
  currentUserId,
}: {
  ticketId: string;
  currentAssignee: TicketAssignee | null;
  currentUserId: string;
}) {
  const { submit, saving, failed } = useInlineAssign(ticketId);

  async function choose(assignee: TicketAssignee | null) {
    if ((assignee?.id ?? null) === (currentAssignee?.id ?? null)) {
      return;
    }
    await submit({ assigneeUserId: assignee?.id ?? null });
  }

  return (
    <AssigneeCombobox
      value={currentAssignee}
      onChange={choose}
      currentUserId={currentUserId}
      trigger={
        <button
          type="button"
          className={TRIGGER_CLASS}
          disabled={saving}
          aria-label={
            currentAssignee ? `Assigned to ${currentAssignee.name}. Change.` : "Assign this ticket"
          }
        >
          {saving ? <Spinner className="size-3.5" /> : null}
          <span className={cn("truncate", !currentAssignee && "text-muted-foreground")}>
            {currentAssignee ? currentAssignee.name : "Unassigned"}
          </span>
          <FailureMark failed={failed} />
        </button>
      }
    />
  );
}

const NO_PRIORITY_VALUE = "__none__";

export function PriorityPicker({
  ticketId,
  currentPriority,
}: {
  ticketId: string;
  currentPriority: TicketPriority | null;
}) {
  const [open, setOpen] = useState(false);
  const { submit, saving, failed } = useInlineAssign(ticketId);

  async function choose(priority: TicketPriority | null) {
    setOpen(false);
    if (priority === currentPriority) {
      return;
    }
    await submit({ priority });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={TRIGGER_CLASS}
            disabled={saving}
            aria-label={
              currentPriority
                ? `Priority ${PRIORITY_LABELS[currentPriority]}. Change.`
                : "Set a priority"
            }
          >
            {saving ? <Spinner className="size-3.5" /> : null}
            {currentPriority ? (
              <Badge variant={PRIORITY_VARIANTS[currentPriority]}>
                {PRIORITY_LABELS[currentPriority]}
              </Badge>
            ) : (
              <span className="text-muted-foreground">&mdash;</span>
            )}
            <FailureMark failed={failed} />
          </button>
        }
      />
      <PopoverContent className="w-52 p-0" align="start">
        {/* Four fixed options — small enough to filter in the browser. */}
        <Command>
          <CommandInput placeholder="Search priority..." />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={NO_PRIORITY_VALUE}
                keywords={["none", "clear", "no priority"]}
                data-checked={currentPriority === null}
                onSelect={() => choose(null)}
              >
                <span className="text-muted-foreground">No priority</span>
              </CommandItem>
              {PRIORITIES.map((value) => (
                <CommandItem
                  key={value}
                  value={value}
                  keywords={[PRIORITY_LABELS[value]]}
                  data-checked={value === currentPriority}
                  onSelect={() => choose(value)}
                >
                  <Badge variant={PRIORITY_VARIANTS[value]}>{PRIORITY_LABELS[value]}</Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function StatusPicker({
  ticketId,
  currentStatus,
  isAdmin,
}: {
  ticketId: string;
  currentStatus: TicketStatus;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { submit, saving, failed } = useStatusUpdate(ticketId);
  const terminal = TERMINAL_STATUSES.includes(currentStatus);

  if (!isAdmin) {
    if (terminal) {
      return <Badge variant={STATUS_VARIANTS[currentStatus]}>{STATUS_LABELS[currentStatus]}</Badge>;
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => submit({ status: "resolved" })}
        >
          {saving ? <Spinner className="size-3.5" /> : <CheckCircle2 />}
          Mark as completed
        </Button>
        <FailureMark failed={failed} />
      </div>
    );
  }

  if (terminal) {
    return (
      <Badge variant={STATUS_VARIANTS[currentStatus]} title="Completed tickets cannot be reopened">
        {STATUS_LABELS[currentStatus]}
      </Badge>
    );
  }

  async function choose(status: TicketStatus) {
    setOpen(false);
    if (status !== currentStatus) await submit({ status });
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={TRIGGER_CLASS}
              disabled={saving}
              aria-label={`Status ${STATUS_LABELS[currentStatus]}. Change.`}
            >
              {saving ? <Spinner className="size-3.5" /> : null}
              <Badge variant={STATUS_VARIANTS[currentStatus]}>{STATUS_LABELS[currentStatus]}</Badge>
              <FailureMark failed={failed} />
            </button>
          }
        />
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search status..." />
            <CommandList>
              <CommandEmpty>No match.</CommandEmpty>
              <CommandGroup>
                {STATUS_OPTIONS.map((status) => (
                  <CommandItem
                    key={status}
                    value={status}
                    keywords={[STATUS_LABELS[status]]}
                    data-checked={status === currentStatus}
                    onSelect={() => choose(status)}
                  >
                    <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
                    {status === "resolved" ? (
                      <span className="ml-auto text-xs text-muted-foreground">Mark as completed</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
