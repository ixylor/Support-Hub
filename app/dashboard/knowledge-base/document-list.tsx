"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RiMoreLine } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArticleDialog } from "./article-dialog";

interface EntryView {
  id: string;
  title: string;
  sourceType: string;
  tags: string[];
  status: string;
  errorMessage: string | null;
  chunkCount: number;
  updatedAt: string;
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000;

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive"> = {
  ready: "default",
  pending: "secondary",
  processing: "secondary",
  failed: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  ready: "Ready",
  pending: "Pending",
  processing: "Processing",
  failed: "Failed",
};

function isStale(entry: EntryView): boolean {
  if (entry.status !== "processing") return false;
  return Date.now() - new Date(entry.updatedAt).getTime() > STALE_THRESHOLD_MS;
}

// A fixed locale and time zone so the server render and the client's first
// render produce identical text — toLocaleString() depends on the runtime's
// default locale and time zone, which differ between the Node process doing
// SSR and the browser doing hydration, and React discards the whole tree on
// a text mismatch. Upgraded to the admin's own local time after mount, once
// there is no longer a server-rendered version to match.
const UPDATED_AT_FALLBACK_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function UpdatedAtCell({ value }: { value: string }) {
  const [display, setDisplay] = useState(() => `${UPDATED_AT_FALLBACK_FORMAT.format(new Date(value))} UTC`);

  useEffect(() => {
    setDisplay(new Date(value).toLocaleString());
  }, [value]);

  return <>{display}</>;
}

interface ViewContentState {
  open: boolean;
  loading: boolean;
  error: string | null;
  content: string | null;
}

const CLOSED_VIEW_CONTENT: ViewContentState = {
  open: false,
  loading: false,
  error: null,
  content: null,
};

// Base UI unmounts the menu popup when an item is clicked, so this dialog is
// rendered as a sibling of the menu and opened imperatively — nesting it in
// the menu content would tear it down at the moment it opens.
function ViewContentDialog({
  title,
  state,
  onOpenChange,
}: {
  title: string;
  state: ViewContentState;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {state.loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : state.error ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{state.content}</pre>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ entry }: { entry: EntryView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewContentState>(CLOSED_VIEW_CONTENT);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const canRetry = entry.status === "failed" || isStale(entry);

  async function handleView() {
    setView({ open: true, loading: true, error: null, content: null });
    try {
      const response = await fetch(`/api/kb/entries/${entry.id}`);
      const payload = (await response.json()) as { content?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load.");
      setView((prev) => ({ ...prev, loading: false, content: payload.content ?? "" }));
    } catch (err) {
      setView((prev) => ({ ...prev, loading: false, error: (err as Error).message }));
    }
  }

  async function handleRetry() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/kb/entries/${entry.id}/retry`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Retry failed.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/kb/entries/${entry.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Delete failed.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Actions" disabled={busy}>
              <RiMoreLine />
            </Button>
          }
        />
        <DropdownMenuContent>
          {canRetry ? <DropdownMenuItem onClick={handleRetry}>Retry</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={handleView}>View text</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ViewContentDialog
        title={entry.title}
        state={view}
        onOpenChange={(open) => setView((prev) => (open ? { ...prev, open } : CLOSED_VIEW_CONTENT))}
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{entry.title}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the article and its indexed chunks. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={busy}>
            Delete article
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Toolbar({ canCreate, knownTags }: { canCreate: boolean; knownTags: string[] }) {
  if (canCreate) {
    return (
      <div className="flex gap-2">
        <ArticleDialog knownTags={knownTags} />
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <span>
              <Button disabled>Write article</Button>
            </span>
          }
        />
        <TooltipContent>Configure an AI provider before adding articles.</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function DocumentList({
  entries,
  knownTags,
  canCreate,
}: {
  entries: EntryView[];
  knownTags: string[];
  canCreate: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Toolbar canCreate={canCreate} knownTags={knownTags} />

      {entries.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No articles yet</EmptyTitle>
            <EmptyDescription>
              Write a text article to start building the knowledge base.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Chunks</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const stale = isStale(entry);
              return (
                <TableRow id={entry.id} key={entry.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{entry.title}</span>
                      {entry.status === "failed" && entry.errorMessage ? (
                        <span className="text-xs text-destructive/90">{entry.errorMessage}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>Article</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {entry.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[entry.status] ?? "secondary"}>
                      {stale ? "Processing (stalled)" : STATUS_LABELS[entry.status] ?? entry.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.chunkCount}</TableCell>
                  <TableCell>
                    <UpdatedAtCell value={entry.updatedAt} />
                  </TableCell>
                  <TableCell>
                    <RowActions entry={entry} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
