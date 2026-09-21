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
  AlertDialogTrigger,
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
import { UploadDialog } from "./upload-dialog";

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

function ViewContentDialog({ entryId, title }: { entryId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/kb/entries/${entryId}`);
      const payload = (await response.json()) as { content?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to load.");
      setContent(payload.content ?? "");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DropdownMenuItem onClick={() => setOpen(true)}>View extracted text</DropdownMenuItem>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{content}</pre>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ entry }: { entry: EntryView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRetry = entry.status === "failed" || isStale(entry);

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
    <AlertDialog>
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
          <ViewContentDialog entryId={entry.id} title={entry.title} />
          <AlertDialogTrigger render={<DropdownMenuItem variant="destructive" />}>
            Delete
          </AlertDialogTrigger>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{entry.title}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the document and its indexed chunks. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={busy}>
            Delete document
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Toolbar({ canUpload, knownTags }: { canUpload: boolean; knownTags: string[] }) {
  if (canUpload) {
    return (
      <div className="flex gap-2">
        <UploadDialog knownTags={knownTags} />
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
              <Button disabled>Upload document</Button>
            </span>
          }
        />
        <TooltipContent>Configure an AI provider before adding documents.</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <span>
              <Button variant="outline" disabled>
                Write article
              </Button>
            </span>
          }
        />
        <TooltipContent>Configure an AI provider before adding documents.</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function DocumentList({
  entries,
  knownTags,
  canUpload,
}: {
  entries: EntryView[];
  knownTags: string[];
  canUpload: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Toolbar canUpload={canUpload} knownTags={knownTags} />

      {entries.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No documents yet</EmptyTitle>
            <EmptyDescription>
              Upload a file or write an article to start building the knowledge base.
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
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{entry.title}</span>
                      {entry.status === "failed" && entry.errorMessage ? (
                        <span className="text-xs text-destructive/90">{entry.errorMessage}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{entry.sourceType}</TableCell>
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
