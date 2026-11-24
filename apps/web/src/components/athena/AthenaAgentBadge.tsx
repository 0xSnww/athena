import type { ScopedThreadRef } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";

export type AthenaBuddyMood = "idle" | "working" | "attention" | "error" | "happy";

function resolveBuddyMood(shell: ReturnType<typeof useQuietThreadShell>): AthenaBuddyMood {
  if (!shell) return "idle";
  if (shell.hasPendingApprovals || shell.hasPendingUserInput || shell.hasActionableProposedPlan) {
    return "attention";
  }
  if (shell.latestRun?.status === "failed" || shell.runtime?.status === "failed") {
    return "error";
  }
  const runtimeStatus = shell.runtime?.status;
  const runStatus = shell.latestRun?.status;
  if (
    runtimeStatus === "preparing" ||
    runtimeStatus === "queued" ||
    runtimeStatus === "starting" ||
    runtimeStatus === "running" ||
    runStatus === "preparing" ||
    runStatus === "queued" ||
    runStatus === "starting" ||
    runStatus === "running"
  ) {
    return "working";
  }
  return "idle";
}

/** Expressive thread buddy emblem with duty-cycled blinking and live agent-state expressions. */
export function AthenaAgentBadge({
  size = "md",
  threadRef,
  mood: moodOverride,
  className,
}: {
  readonly size?: "sm" | "md";
  readonly threadRef?: ScopedThreadRef | null | undefined;
  readonly mood?: AthenaBuddyMood | undefined;
  readonly className?: string;
}) {
  const shell = useQuietThreadShell(threadRef ?? null);
  const mood = moodOverride ?? resolveBuddyMood(shell);

  return (
    <span
      aria-hidden="true"
      data-athena-buddy-mood={mood}
      className={cn(
        "group/buddy inline-flex shrink-0 items-center justify-center rounded-full border border-border/80 bg-message-action text-message-action-foreground shadow-xs transition-colors dark:border-white/12 dark:bg-message dark:text-foreground",
        mood === "working" && "border-primary/40 dark:border-primary/45",
        mood === "attention" && "border-warning/60 text-warning-foreground dark:border-warning/55",
        mood === "error" && "border-destructive/60 text-destructive dark:border-destructive/55",
        size === "sm" ? "size-7" : "size-7",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4 overflow-visible">
        {mood === "error" ? (
          <g className="stroke-current" fill="none" strokeWidth="1.9" strokeLinecap="round">
            <path d="M6.4 9.6 L9.1 12.3 M9.1 9.6 L6.4 12.3" />
            <path d="M14.9 9.6 L17.6 12.3 M17.6 9.6 L14.9 12.3" />
            <path d="M10.4 15.6 Q12 14.3 13.6 15.6" strokeWidth="1.6" />
          </g>
        ) : mood === "happy" ? (
          <g className="stroke-current" fill="none" strokeWidth="1.9" strokeLinecap="round">
            <path d="M6.1 11.8 Q7.7 9.5 9.3 11.8" />
            <path d="M14.7 11.8 Q16.3 9.5 17.9 11.8" />
            <path d="M10.6 14.4 Q12 15.6 13.4 14.4" strokeWidth="1.5" />
          </g>
        ) : mood === "attention" ? (
          <g className="athena-buddy-face-attention fill-current">
            <g className="athena-buddy-eyes">
              <circle cx="7.7" cy="10.9" r="1.55" />
              <circle cx="16.3" cy="10.9" r="1.55" />
            </g>
            <circle
              cx="12"
              cy="14.7"
              r="1.3"
              fill="none"
              className="stroke-current"
              strokeWidth="1.5"
            />
          </g>
        ) : mood === "working" ? (
          <g className="athena-buddy-face-working fill-current">
            <g className="athena-buddy-eyes">
              <rect x="6.5" y="10.2" width="2.3" height="2.7" rx="1.15" />
              <rect x="15.2" y="10.2" width="2.3" height="2.7" rx="1.15" />
            </g>
            <circle cx="12" cy="14.4" r="0.9" />
          </g>
        ) : (
          <>
            <g className="fill-current group-hover/buddy:hidden">
              <g className="athena-buddy-eyes">
                <rect x="6.5" y="9.8" width="2.2" height="3.3" rx="1.1" />
                <rect x="15.3" y="9.8" width="2.2" height="3.3" rx="1.1" />
              </g>
              <circle cx="12" cy="14.3" r="0.95" />
            </g>
            <g
              className="hidden stroke-current group-hover/buddy:inline"
              fill="none"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <path d="M6.1 11.8 Q7.7 9.5 9.3 11.8" />
              <path d="M14.7 11.8 Q16.3 9.5 17.9 11.8" />
              <path d="M10.6 14.4 Q12 15.6 13.4 14.4" strokeWidth="1.5" />
            </g>
          </>
        )}
      </svg>
    </span>
  );
}
