import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getActivePromptTemplate } from "@/lib/prompt-templates";
import { PromptEditorForm } from "./prompt-editor-form";

const DRAFT_REPLY_PROMPT_KEY = "draft_reply_system";

export default async function PromptSettingsPage() {
  // The nav hides this link from non-admins, but that alone doesn't stop
  // direct navigation — the layout only checks for a session, not a role.
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const active = await getActivePromptTemplate(DRAFT_REPLY_PROMPT_KEY);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-lg font-semibold">Draft Reply Prompt</h1>
      <PromptEditorForm
        promptKey={DRAFT_REPLY_PROMPT_KEY}
        initialContent={active?.content ?? ""}
        currentVersion={active?.version ?? 0}
      />
    </div>
  );
}
