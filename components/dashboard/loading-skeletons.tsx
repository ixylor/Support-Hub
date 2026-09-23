import { Skeleton } from "@/components/ui/skeleton";

function LoadingShell({
  label = "Loading workspace",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="animate-in fade-in-0 duration-200">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

function PageHeadingSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-16" />
      <Skeleton className={wide ? "h-9 w-64" : "h-8 w-40"} />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

export function DashboardLoadingSkeleton() {
  return (
    <LoadingShell label="Loading dashboard">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <section className="relative overflow-hidden rounded-2xl border bg-card px-5 py-8 sm:px-8 sm:py-10">
          <Skeleton className="mb-5 h-5 w-28" />
          <Skeleton className="h-10 w-full max-w-2xl" />
          <Skeleton className="mt-3 h-5 w-full max-w-xl" />
          <Skeleton className="mt-2 h-5 w-4/5 max-w-lg" />
        </section>
        <Skeleton className="h-20 w-full rounded-xl" />
        <section className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="rounded-xl border bg-card p-5">
                <div className="mb-8 flex items-center justify-between">
                  <Skeleton className="size-10 rounded-lg" />
                  <Skeleton className="size-4 rounded-full" />
                </div>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-2 h-4 w-full" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </LoadingShell>
  );
}

export function TicketsLoadingSkeleton() {
  return (
    <LoadingShell label="Loading tickets">
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <PageHeadingSkeleton />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-20" />
            ))}
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="hidden items-center gap-6 border-b px-5 py-4 md:flex">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className={index === 0 ? "h-4 w-48" : "h-4 w-24"} />
            ))}
          </div>
          <div className="divide-y">
            {Array.from({ length: 7 }, (_, row) => (
              <div key={row} className="grid min-h-20 gap-3 px-5 py-4 md:grid-cols-[2fr_1.5fr_1fr_1fr_1.2fr_0.5fr_1.2fr] md:items-center">
                <Skeleton className="h-4 w-full max-w-xs" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingShell>
  );
}

export function TicketDetailLoadingSkeleton() {
  return (
    <LoadingShell label="Loading ticket">
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <Skeleton className="h-4 w-32" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-full max-w-xl" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="mt-5 h-16 w-full" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
              <Skeleton className="mt-3 h-16 w-full" />
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="mt-5 flex gap-3">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
          <Skeleton className="h-[520px] w-full rounded-xl" />
        </div>
      </div>
    </LoadingShell>
  );
}

export function SettingsLoadingSkeleton() {
  return (
    <LoadingShell label="Loading settings">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <PageHeadingSkeleton wide />
        <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="h-10 w-28" />
        </section>
        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <Skeleton className="h-6 w-44" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        </section>
      </div>
    </LoadingShell>
  );
}

export function SetupLoadingSkeleton() {
  return (
    <LoadingShell label="Loading setup checklist">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeadingSkeleton wide />
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-start justify-between gap-4 border-b p-5 sm:p-6">
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-48" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="divide-y">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 p-5">
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-full max-w-md" />
                </div>
                <Skeleton className="hidden h-4 w-24 sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingShell>
  );
}
