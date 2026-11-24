import { cn } from "~/lib/utils";

/** Minimalist dark circular emblem matching the header and floating team card avatar. */
export function AthenaAgentBadge({
  size = "md",
  className,
}: {
  readonly size?: "sm" | "md";
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-border/80 bg-message-action text-message-action-foreground shadow-xs dark:border-white/12 dark:bg-message dark:text-foreground",
        size === "sm" ? "size-7" : "size-7",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4 fill-current">
        <rect x="6.5" y="10" width="2.2" height="3.2" rx="1.1" />
        <rect x="15.3" y="10" width="2.2" height="3.2" rx="1.1" />
        <circle cx="12" cy="14.2" r="0.95" />
      </svg>
    </span>
  );
}
