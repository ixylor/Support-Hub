"use client";

import { Bot, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function ManualReply({ ticketId }: { ticketId: string }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(action: "draft" | "send") {
    setBusy(action);
    setNotice(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, body }),
      });
      const payload = (await response.json().catch(() => null)) as { body?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not complete the reply.");
      if (action === "draft") setBody(payload?.body ?? "");
      else {
        setBody("");
        setNotice("Reply sent in the existing email thread.");
        window.location.reload();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not complete the reply.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mt-5 border-primary/25">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Send className="size-4 text-primary" />Manual reply</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a short, professional reply…" rows={5} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => submit("draft")}>
            <Sparkles /> {busy === "draft" ? "Writing…" : "Draft with agent"}
          </Button>
          <Button size="sm" disabled={busy !== null || !body.trim()} onClick={() => submit("send")}>
            <Send /> {busy === "send" ? "Sending…" : "Send reply"}
          </Button>
        </div>
        <Alert className="border-muted py-2"><Bot className="size-4" /><AlertDescription className="text-xs">The agent keeps replies concise and professional. Review the draft before sending.</AlertDescription></Alert>
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      </CardContent>
    </Card>
  );
}
