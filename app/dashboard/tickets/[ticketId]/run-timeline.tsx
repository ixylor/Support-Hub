import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TimelineEntry } from "@/lib/workflow/timeline";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function RunTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <Card className="mb-6" size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Workflow</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3 border-l pl-4">
          {entries.map((entry, index) => (
            <li key={`${entry.at.toISOString()}-${index}`} className="text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="font-medium">{label(entry.label)}</span>
                <time className="text-xs text-muted-foreground">{dateFormatter.format(entry.at)}</time>
              </div>
              <p className="mt-1 break-words text-muted-foreground">{entry.detail}</p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
