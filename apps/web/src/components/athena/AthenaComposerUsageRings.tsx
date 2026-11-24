import type { ThreadDetailsUsageInput } from "../chat/ThreadDetailsUsage";
import { resolveThreadDetailsLimits } from "../chat/ThreadDetailsUsage.logic";
import { useNowMinute } from "~/hooks/useNowMinute";
import { usePrimarySettings } from "~/hooks/useSettings";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { useGT } from "gt-react";
import { Link } from "@tanstack/react-router";
import { cn } from "~/lib/utils";

function MiniGaugeRing({
  percent,
  tone = "default",
}: {
  readonly percent: number;
  readonly tone?: "default" | "warning" | "error";
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 5.25;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const strokeClass =
    tone === "error"
      ? "text-error-foreground"
      : tone === "warning"
        ? "text-warning-foreground"
        : "text-foreground/75";

  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 -rotate-90" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-muted-foreground/25"
      />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={strokeClass}
      />
    </svg>
  );
}

/** Inline circular gauges rendered in the micro footer under the composer pill. */
export function AthenaComposerUsageRings({
  providerInstanceId,
  model,
  providers,
  sources,
  contextWindow,
}: ThreadDetailsUsageInput) {
  const gt = useGT();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  // Subscribe to settings changes cleanly so usage formatting stays consistent.
  usePrimarySettings((settings) => settings.timestampFormat);

  const limits = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  const primaryLimitPercent = (() => {
    if (!limits) return null;
    if (limits.kind === "pool") {
      const first = limits.windows[0];
      return first ? { label: first.label, percent: Math.round(first.remainingPercent) } : null;
    }
    const first = limits.limits.windows[0];
    return first ? { label: first.label, percent: Math.round(remainingPercent(first)) } : null;
  })();

  const contextUsedPercent =
    contextWindow &&
    contextWindow.maxTokens != null &&
    contextWindow.maxTokens > 0 &&
    contextWindow.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, contextWindow.usedPercentage)))
      : null;

  if (contextUsedPercent === null && primaryLimitPercent === null) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-2.5 text-xs text-muted-foreground tabular-nums">
      {contextUsedPercent !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                className="inline-flex cursor-default items-center gap-1 rounded px-0.5 text-muted-foreground hover:text-foreground"
                aria-label={gt("Context: {used}% used", { used: contextUsedPercent })}
              />
            }
          >
            <MiniGaugeRing
              percent={contextUsedPercent}
              tone={
                contextUsedPercent >= 90
                  ? "error"
                  : contextUsedPercent >= 80
                    ? "warning"
                    : "default"
              }
            />
            <span>{contextUsedPercent}%</span>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {contextWindow?.maxTokens
              ? gt("Context window: {used}% ({tokens} / {max})", {
                  used: contextUsedPercent,
                  tokens: formatContextWindowTokens(contextWindow.usedTokens),
                  max: formatContextWindowTokens(contextWindow.maxTokens),
                })
              : gt("Context: {used}% used", { used: contextUsedPercent })}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {primaryLimitPercent !== null ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                to="/usage"
                className={cn(
                  "inline-flex items-center gap-1 rounded px-0.5 text-muted-foreground transition-colors hover:text-foreground",
                )}
                aria-label={gt("{label}: {left}% left", {
                  label: primaryLimitPercent.label,
                  left: primaryLimitPercent.percent,
                })}
              />
            }
          >
            <MiniGaugeRing
              percent={primaryLimitPercent.percent}
              tone={
                primaryLimitPercent.percent <= 10
                  ? "error"
                  : primaryLimitPercent.percent <= 20
                    ? "warning"
                    : "default"
              }
            />
            <span>{primaryLimitPercent.percent}%</span>
          </TooltipTrigger>
          <TooltipPopup side="top">
            {gt("{label}: {left}% left", {
              label: primaryLimitPercent.label,
              left: primaryLimitPercent.percent,
            })}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
