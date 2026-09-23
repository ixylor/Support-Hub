import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
} as const;

const markSizeClasses = {
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
} as const;

// Abstract hub-and-spoke glyph: a center node with three connected points.
// Pure currentColor strokes/fills so it works on any background and in both
// themes, and stays legible once the sidebar collapses to rail width.
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 9.6V5.5M9.2 13.6 5.6 17M14.8 13.6 18.4 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <circle cx="12" cy="4.3" r="1.7" fill="currentColor" />
      <circle cx="4.3" cy="18.3" r="1.7" fill="currentColor" />
      <circle cx="19.7" cy="18.3" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  size = "md",
  variant = "full",
  className,
}: {
  size?: keyof typeof sizeClasses;
  /** "mark" renders just the glyph, for the collapsed icon-rail sidebar. */
  variant?: "full" | "mark";
  className?: string;
}) {
  if (variant === "mark") {
    return (
      <span role="img" aria-label="Support Hub" className={cn("inline-flex", className)}>
        <LogoMark className={markSizeClasses[size]} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight",
        sizeClasses[size],
        className
      )}
    >
      <LogoMark className={cn(markSizeClasses[size], "shrink-0")} />
      Support Hub
    </span>
  );
}
