import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-2xl",
} as const;

export function Logo({ size = "md" }: { size?: keyof typeof sizeClasses }) {
  return (
    <span className={cn("font-heading font-semibold tracking-tight", sizeClasses[size])}>
      Support Hub
    </span>
  );
}
