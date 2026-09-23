import { Skeleton } from "@/components/ui/skeleton";

function MetricSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="size-10 rounded-lg" />
      </div>
    </div>
  );
}

function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="space-y-2 border-b p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="space-y-5 p-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="space-y-2">
            <div className="flex justify-between gap-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading analytics" className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 animate-in fade-in-0 duration-200">
      <span className="sr-only">Loading analytics…</span>
      <header className="space-y-3 border-b pb-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <MetricSkeleton key={index} />)}
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton rows={2} />
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <CardSkeleton rows={5} />
        <CardSkeleton rows={5} />
      </section>
    </div>
  );
}
