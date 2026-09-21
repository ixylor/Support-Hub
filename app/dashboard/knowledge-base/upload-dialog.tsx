"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagsInput } from "./tags-input";

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.md";

export function UploadDialog({ knownTags }: { knownTags: string[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setTitle("");
    setTags([]);
    setError(null);
  }

  function chooseFile(chosen: File) {
    setFile(chosen);
    // A filename is a reasonable starting title; the user can still edit it.
    setTitle((current) => (current === "" ? chosen.name.replace(/\.[^./]+$/, "") : current));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);
      formData.append("tags", tags.join(","));

      const response = await fetch("/api/kb/entries", { method: "POST", body: formData });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status !== 201) {
        throw new Error(payload.error ?? "Upload failed.");
      }
      reset();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button />}>Upload document</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>PDF, Word, text or Markdown files.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div
            className="flex flex-col items-center justify-center gap-2 border border-dashed p-8 text-center text-sm text-muted-foreground"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files[0];
              if (dropped) chooseFile(dropped);
            }}
            data-dragging={dragging}
          >
            {file ? (
              <span className="text-foreground">{file.name}</span>
            ) : (
              <span>Drag a file here, or</span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              Choose file
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) chooseFile(chosen);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-title">Title</Label>
            <Input id="upload-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <TagsInput value={tags} onChange={setTags} knownTags={knownTags} />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
