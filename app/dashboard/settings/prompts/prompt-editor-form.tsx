"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function PromptEditorForm({
  promptKey,
  initialContent,
  currentVersion,
}: {
  promptKey: string;
  initialContent: string;
  currentVersion: number;
}) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(currentVersion);

  async function handleSave() {
    setSaving(true);
    const response = await fetch("/api/settings/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: promptKey, content }),
    });
    if (!response.ok) {
      throw new Error("Failed to save prompt template.");
    }
    setSavedVersion((version) => version + 1);
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={12}
      />
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <span className="text-sm text-muted-foreground">Active version: {savedVersion}</span>
      </div>
    </div>
  );
}
