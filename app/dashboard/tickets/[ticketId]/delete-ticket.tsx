"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export function DeleteTicket({ ticketId, compact = false }: { ticketId: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/tickets/${ticketId}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error ?? "Could not delete ticket.");
      setBusy(false);
      return;
    }
    router.replace("/dashboard/tickets");
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              title="Delete ticket permanently"
            />
          }
        >
          <Trash2 />
          <span>{busy ? "Deleting…" : compact ? "Delete" : "Delete permanently"}</span>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ticket permanently?</AlertDialogTitle>
            <AlertDialogDescription>This removes the conversation, workflow history, and approval records. It cannot be undone or reopened.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={busy} aria-busy={busy}>
              {busy ? <Spinner /> : null}
              {busy ? "Deleting…" : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
