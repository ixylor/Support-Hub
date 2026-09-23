"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/tickets/labels";
import type { TicketAssignee, TicketPriority } from "@/lib/tickets/queries";
import { AssigneeCombobox } from "../assignee-combobox";

const NO_PRIORITY = "none";

export function AssignDialog({
  ticketId,
  currentAssignee,
  currentPriority,
  currentUserId,
}: {
  ticketId: string;
  currentAssignee: TicketAssignee | null;
  currentPriority: TicketPriority | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assignee, setAssignee] = useState<TicketAssignee | null>(currentAssignee);
  const [priority, setPriority] = useState<string>(currentPriority ?? NO_PRIORITY);
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAssign() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assigneeUserId: assignee?.id ?? null,
          priority: priority === NO_PRIORITY ? null : priority,
          remark,
        }),
      });
      if (!response.ok) {
        throw new Error("Assignment failed.");
      }
      setRemark("");
      setOpen(false);
      // The card, the history and the list all read from the server, so a
      // refresh is what makes the change visible.
      router.refresh();
    } catch {
      setError("Could not update the assignment. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {currentAssignee ? "Reassign" : "Assign"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign ticket</DialogTitle>
          <DialogDescription>
            Choose who owns this ticket. Every change is recorded in the assignment history.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Assignee</Label>
            <AssigneeCombobox
              value={assignee}
              onChange={setAssignee}
              currentUserId={currentUserId}
              contentClassName="w-[var(--anchor-width)] p-0"
              trigger={
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between border-b border-input bg-transparent py-2 text-left text-sm transition-colors focus-visible:border-b-ring focus-visible:outline-none"
                >
                  <span className={assignee ? undefined : "text-muted-foreground"}>
                    {assignee ? assignee.name : "Unassigned"}
                  </span>
                  <span className="text-xs text-muted-foreground">Choose</span>
                </button>
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Select value={priority}
              onValueChange={(value) => {
                if (value) setPriority(value);
              }}
            >
              <SelectTrigger id="priority" aria-label="Priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PRIORITY}>No priority</SelectItem>
                {PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="remark">Remark</Label>
            <Textarea
              id="remark"
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              placeholder="Context for whoever picks this up (optional)"
              rows={3}
              maxLength={2000}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={saving} aria-busy={saving}>
            {saving ? <Spinner /> : null}
            {saving ? "Saving..." : "Save assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
