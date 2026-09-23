"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Mode = "idle" | "edit" | "reject";
type ApprovalState = "pending" | "resolved";

export interface ApprovalProposal {
  kind?: "answer" | "question";
  body?: string;
  reason?: string;
  citedChunkIds?: string[];
}

const OVERRIDE_LABELS: Record<string, string | null> = {
  send_email: null,
  triage_out: "Not junk - continue",
  escalate: "Answer it anyway",
  close: "Not resolved",
};

export function ApprovalPanel({
  ticketId,
  approvalId,
  kind,
  confidence,
  proposal,
  citations,
}: {
  ticketId: string;
  approvalId: string;
  kind: string;
  confidence: number;
  proposal: ApprovalProposal;
  citations: { chunkId: string; entryId: string; title: string }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [text, setText] = useState(proposal.body ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalState, setApprovalState] = useState<ApprovalState>("pending");

  async function decide(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 409) {
          // A second tab/reviewer may have decided it first. A stale panel
          // must never leave buttons that look safe to click again.
          setApprovalState("resolved");
          setMode("idle");
          setError(null);
          router.refresh();
          return;
        }
        setError(payload?.error ?? "Failed to record the decision.");
        return;
      }
      setApprovalState("resolved");
      setMode("idle");
      router.refresh();
    } catch {
      setError("Failed to record the decision.");
    } finally {
      setBusy(false);
    }
  }

  const overrideLabel = OVERRIDE_LABELS[kind] ?? null;
  const resolved = approvalState === "resolved";

  return (
    <Card data-testid="approval-panel" className="mb-6" size="sm">
      <CardHeader className="flex flex-row items-baseline justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          {resolved ? "Approval recorded" : "Waiting for approval"}
          <Badge variant={resolved ? "default" : "secondary"}>
            {resolved ? <><CheckCircle2 className="size-3" /> Resolved</> : "Action required"}
          </Badge>
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {Math.round(confidence * 100)}% confidence
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {resolved ? (
          <p className="text-sm text-muted-foreground" role="status">
            This approval is no longer actionable. The workflow will continue using the recorded decision.
          </p>
        ) : null}
        {proposal.body ? (
          <div className="whitespace-pre-wrap border-l-2 border-primary/40 pl-4 text-sm leading-relaxed">
            {proposal.body}
          </div>
        ) : (
          <p className="text-sm leading-relaxed">{proposal.reason}</p>
        )}

        {citations.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Sources:{" "}
            {citations.map((citation, index) => (
              <span key={citation.chunkId}>
                {index > 0 ? ", " : ""}
                <a className="underline" href={`/dashboard/knowledge-base#${citation.entryId}`}>
                  {citation.title}
                </a>
              </span>
            ))}
          </p>
        ) : null}

        {!resolved && mode === "edit" ? (
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label="Reply"
              value={text}
              rows={8}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => decide({ decision: "edit", editedBody: text })}>
                Send
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {!resolved && mode === "reject" ? (
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label="What was wrong"
              value={note}
              rows={4}
              placeholder="What should be different?"
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => decide({ decision: "reject_feedback", feedback: note })}
              >
                Send back
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {!resolved && mode === "idle" ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => decide({ decision: "approve" })}>
              Approve
            </Button>
            {proposal.body ? (
              <Button variant="outline" disabled={busy} onClick={() => setMode("edit")}>
                Edit &amp; approve
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy} onClick={() => setMode("reject")}>
              Reject with feedback
            </Button>
            {overrideLabel ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => decide({ decision: "override", overrideAction: "continue" })}
              >
                {overrideLabel}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={() => decide({ decision: "take_over" })}>
              Take it over
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
