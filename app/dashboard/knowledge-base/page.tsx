import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { knowledgeBaseReadiness, listEntries, listTags } from "@/lib/kb/entries";
import { DocumentList } from "./document-list";
import { SearchBox } from "./search-box";

export default async function KnowledgeBasePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || (session.user as { role: string }).role !== "admin") {
    redirect("/dashboard");
  }

  const [entries, tags, readiness] = await Promise.all([
    listEntries(),
    listTags(),
    knowledgeBaseReadiness(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Knowledge Base</h1>
        <p className="text-muted-foreground text-sm">
          Documents the AI draws on when drafting replies.
        </p>
      </div>

      {!readiness.ready && (
        <Alert variant="destructive">
          <AlertTitle>AI provider not configured</AlertTitle>
          <AlertDescription>
            {readiness.reason} Documents cannot be processed until this is resolved.
          </AlertDescription>
        </Alert>
      )}

      <DocumentList
        entries={entries.map((entry) => ({ ...entry, updatedAt: entry.updatedAt.toISOString() }))}
        knownTags={tags}
        canUpload={readiness.ready}
      />

      <div className="space-y-2">
        <div>
          <h2 className="text-base font-semibold">Test retrieval</h2>
          <p className="text-muted-foreground text-sm">
            Runs the same query the AI would run.
          </p>
        </div>
        <SearchBox knownTags={tags} />
      </div>
    </div>
  );
}
