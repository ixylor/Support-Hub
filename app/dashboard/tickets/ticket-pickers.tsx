"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RiErrorWarningLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
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
import { PRIORITIES, PRIORITY_LABELS, PRIORITY_VARIANTS } from "@/lib/tickets/labels";
import type { TicketAssignee, TicketPriority } from "@/lib/tickets/queries";
import { cn } from "cn";
import { AssigneeCombobox } from "./assignee-combobox";

type AssignPayload = {
  assigneeUserId?: string | null;
  priority?: TicketPriority | null;
};

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
