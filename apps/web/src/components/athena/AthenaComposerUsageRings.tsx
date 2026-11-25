import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import {
  type LimitPace,
  type LimitPoolWindow,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { formatDuration, limitsNotice } from "@t3tools/shared/usageLimitsCopy";
import { Link } from "@tanstack/react-router";
import { msg, useGT, useLocale, useMessages } from "gt-react";
import { ArrowUpRightIcon, Minimize2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { usePrimarySettings } from "~/hooks/useSettings";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { formatUpcomingTimestamp } from "~/timestampFormat";
import { formatContextWindowCompactionMessage } from "../chat/compaction.logic";
import type { ThreadDetailsUsageInput } from "../chat/ThreadDetailsUsage";
import {
  nextPoolReset,
  poolSources,
  resolveThreadDetailsLimits,
  type ThreadDetailsLimits,
} from "../chat/ThreadDetailsUsage.logic";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const PACE_LABEL: Record<LimitPace, string> = {
  ahead: msg("Ahead of pace"),
  on: msg("On pace"),
  under: msg("Under pace"),
};

type UsageTone = "error" | "warning" | null;

function limitTone(left: number): UsageTone {
  if (left <= 10) return "error";
  if (left <= 20) return "warning";
  return null;
}

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

function PopoverUsageBarRow({
  label,
  fill,
  tone,
  tick = null,
  value,
  subtitle,
  tooltip,
}: {
  readonly label: string;
  readonly fill: number | null;
  readonly tone: UsageTone;
  readonly tick?: number | null;
  readonly value: string;
  readonly subtitle?: string | null;
  readonly tooltip: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            className="flex cursor-default flex-col gap-1 rounded-xl px-2 py-1.5 transition-colors outline-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/[0.07]"
          />
        }
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-muted-foreground">{label}</span>
          <span
            className={cn(
              "shrink-0 font-medium tabular-nums",
              tone === "error"
                ? "text-error-foreground"
                : tone === "warning"
                  ? "text-warning-foreground"
                  : fill === null
                    ? "text-muted-foreground"
                    : "text-foreground/90",
            )}
          >
            {value}
          </span>
        </div>
        {fill !== null ? (
          <div className="relative h-1.5 w-full rounded-full bg-muted-foreground/20 dark:bg-white/[0.08]">
            {fill > 0 ? (
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  tone === "error"
                    ? "bg-error"
                    : tone === "warning"
                      ? "bg-warning"
                      : "bg-foreground/80",
                )}
                style={{ width: `max(${Math.max(0, Math.min(100, fill))}%, 6px)` }}
              />
            ) : null}
            {tick !== null ? (
              <span
                aria-hidden
                className="absolute -top-0.5 h-2.5 w-px -translate-x-1/2 bg-foreground/75"
                style={{ left: `clamp(1px, ${tick}%, calc(100% - 1px))` }}
              />
            ) : null}
          </div>
        ) : null}
        {subtitle ? <span className="text-2xs text-muted-foreground/80">{subtitle}</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="left" sideOffset={10}>
        <div className="flex flex-col gap-0.5">{tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}

function InstanceLimitRows({
  windows,
  now,
}: {
  readonly windows: readonly ServerProviderUsageWindow[];
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);

  return windows.map((window) => {
    const left = remainingPercent(window);
    const pace = paceOf(window, now);
    const timeLeft = paceRemainingPercent(window, now);
    const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
    const resetLine =
      window.resetsAt && resetsAt > now
        ? gt("Resets in {duration} · {time}", {
            duration: formatDuration(resetsAt - now, m),
            time: formatUpcomingTimestamp(window.resetsAt, timestampFormat, now, undefined, m),
          })
        : null;

    return (
      <PopoverUsageBarRow
        key={window.id}
        label={window.label}
        fill={left}
        tone={limitTone(left)}
        tick={timeLeft}
        value={`${left}%`}
        subtitle={resetLine}
        tooltip={
          <>
            <span className="text-foreground">
              {gt("{label}: {left}% left", { label: window.label, left })}
            </span>
            {pace && timeLeft !== null ? (
              <span className="text-muted-foreground">
                {m(PACE_LABEL[pace])} · {gt("{timeLeft}% of the window left", { timeLeft })}
              </span>
            ) : null}
            {resetLine ? <span className="text-muted-foreground">{resetLine}</span> : null}
          </>
        }
      />
    );
  });
}

function PoolLimitRows({
  windows,
  now,
}: {
  readonly windows: readonly LimitPoolWindow[];
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);

  return windows.map((window) => {
    const left = window.remainingPercent;
    const accounts = window.members.length;
    const from = poolSources(window);
    const sourceLabels = [...from.hubs, ...(from.signedIn ? [gt("Signed-in accounts")] : [])];
    const next = nextPoolReset(window, now);
    const resetsAt = next?.member.window.resetsAt;
    const reset =
      next && resetsAt
        ? {
            duration: formatDuration(next.at - now, m),
            time: formatUpcomingTimestamp(resetsAt, timestampFormat, now, undefined, m),
          }
        : null;
    const resetLine =
      next && reset
        ? accounts > 1
          ? gt("+{percent}% in {duration} · {time}", {
              percent: next.restoresPercent,
              ...reset,
            })
          : gt("Resets in {duration} · {time}", reset)
        : null;

    return (
      <PopoverUsageBarRow
        key={window.id}
        label={window.label}
        fill={left}
        tone={limitTone(left)}
        value={`${left}%`}
        subtitle={resetLine}
        tooltip={
          <>
            <span className="text-foreground">
              {accounts > 1
                ? gt("{label}: {left}% left across {accounts} accounts", {
                    label: window.label,
                    left,
                    accounts,
                  })
                : gt("{label}: {left}% left", { label: window.label, left })}
            </span>
            {window.pace ? (
              <span className="text-muted-foreground">{m(PACE_LABEL[window.pace])}</span>
            ) : null}
            {resetLine ? <span className="text-muted-foreground">{resetLine}</span> : null}
            {sourceLabels.length > 0 ? (
              <span className="text-muted-foreground">
                {gt("From {sources}", { sources: sourceLabels.join(", ") })}
              </span>
            ) : null}
          </>
        }
      />
    );
  });
}

/** Shared compact list of hoverable usage limit bars for popovers. */
export function AthenaUsageLimitsList({
  limits,
  now,
}: {
  readonly limits: ThreadDetailsLimits;
  readonly now: number;
}) {
  const gt = useGT();
  const m = useMessages();
  if (limits.kind === "pool") {
    return (
      <div className="flex flex-col gap-0.5">
        <PoolLimitRows windows={limits.windows} now={now} />
      </div>
    );
  }
  const notice = limitsNotice(limits.limits, m);
  if (notice) {
    return (
      <PopoverUsageBarRow
        label={gt("Limits", { $context: "usage limits row label" })}
        fill={null}
        tone={null}
        value={gt("Unavailable")}
        tooltip={<span className="text-foreground">{notice}</span>}
      />
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <InstanceLimitRows windows={limits.limits.windows} now={now} />
    </div>
  );
}

export interface AthenaComposerUsageRingsProps extends ThreadDetailsUsageInput {
  readonly modelLabel?: string | null | undefined;
  readonly onCompactContext?: (() => void) | undefined;
  readonly compactDisabled?: boolean | undefined;
}

/** Inline circular gauges rendered in the micro footer under the composer pill. */
export function AthenaComposerUsageRings({
  providerInstanceId,
  model,
  modelLabel,
  providers,
  sources,
  contextWindow,
  onCompactContext,
  compactDisabled = false,
}: AthenaComposerUsageRingsProps) {
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  // Subscribe to settings changes cleanly so usage formatting stays consistent.
  usePrimarySettings((settings) => settings.timestampFormat);

  const [contextOpen, setContextOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);

  const limits = resolveThreadDetailsLimits(providerInstanceId, model, providers, sources, now);
  const activeProvider = providers.find((entry) => entry.instanceId === providerInstanceId) ?? null;
  const primaryLimitPercent = (() => {
    if (!limits) return null;
    if (limits.kind === "pool") {
      const first = limits.windows[0];
      return first ? { label: first.label, percent: Math.round(first.remainingPercent) } : null;
    }
    const first = limits.limits.windows[0];
    return first ? { label: first.label, percent: Math.round(remainingPercent(first)) } : null;
  })();

  const maxTokens =
    contextWindow?.maxTokens != null && contextWindow.maxTokens > 0
      ? contextWindow.maxTokens
      : null;
  const contextUsedPercent =
    contextWindow && maxTokens !== null && contextWindow.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, contextWindow.usedPercentage)))
      : null;
  const contextTone: UsageTone =
    contextUsedPercent === null
      ? null
      : contextUsedPercent >= 90
        ? "error"
        : contextUsedPercent >= 80
          ? "warning"
          : null;
  const autoCompactThreshold = contextWindow?.autoCompactThreshold ?? null;
  const contextTick =
    maxTokens !== null &&
    autoCompactThreshold !== null &&
    autoCompactThreshold > 0 &&
    autoCompactThreshold < maxTokens
      ? (autoCompactThreshold / maxTokens) * 100
      : null;

  if (contextUsedPercent === null && primaryLimitPercent === null) {
    return null;
  }

  const triggerClass =
    "inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.06] data-popup-open:text-foreground dark:hover:bg-white/[0.07] dark:data-popup-open:bg-white/[0.1]";

  const usageHeaderLabel = modelLabel || activeProvider?.displayName || gt("Usage limits");

  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      {contextUsedPercent !== null && contextWindow ? (
        <Popover open={contextOpen} onOpenChange={setContextOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className={triggerClass}
                      aria-label={gt("Context: {used}% used", { used: contextUsedPercent })}
                    />
                  }
                />
              }
            >
              <MiniGaugeRing percent={contextUsedPercent} tone={contextTone ?? "default"} />
              <span>{contextUsedPercent}%</span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              {maxTokens !== null
                ? gt("Context window: {used}% ({tokens} / {max})", {
                    used: contextUsedPercent,
                    tokens: formatContextWindowTokens(contextWindow.usedTokens),
                    max: formatContextWindowTokens(maxTokens),
                  })
                : gt("Context: {used}% used", { used: contextUsedPercent })}
            </TooltipPopup>
          </Tooltip>
          <PopoverPopup side="top" align="end" sideOffset={8} width="sm" padding="compact">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 px-2 pt-0.5">
                <span className="text-xs font-semibold text-foreground">
                  {gt("Context window")}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    contextTone === "error"
                      ? "text-error-foreground"
                      : contextTone === "warning"
                        ? "text-warning-foreground"
                        : "text-foreground/85",
                  )}
                >
                  {contextUsedPercent}%
                </span>
              </div>
              <div className="flex flex-col gap-1.5 px-2">
                <div className="relative h-1.5 w-full rounded-full bg-muted-foreground/20 dark:bg-white/[0.08]">
                  {contextUsedPercent > 0 ? (
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        contextTone === "error"
                          ? "bg-error"
                          : contextTone === "warning"
                            ? "bg-warning"
                            : "bg-foreground/80",
                      )}
                      style={{ width: `max(${contextUsedPercent}%, 6px)` }}
                    />
                  ) : null}
                  {contextTick !== null ? (
                    <span
                      aria-hidden
                      className="absolute -top-0.5 h-2.5 w-px -translate-x-1/2 bg-foreground/75"
                      style={{ left: `clamp(1px, ${contextTick}%, calc(100% - 1px))` }}
                    />
                  ) : null}
                </div>
                {maxTokens !== null ? (
                  <p className="text-2xs text-muted-foreground tabular-nums">
                    {gt("{used} of {max} tokens", {
                      used: contextWindow.usedTokens.toLocaleString(locale),
                      max: maxTokens.toLocaleString(locale),
                    })}
                  </p>
                ) : null}
                {autoCompactThreshold !== null && autoCompactThreshold > 0 ? (
                  <p className="text-2xs text-muted-foreground/80">
                    {formatContextWindowCompactionMessage(autoCompactThreshold, m)}
                  </p>
                ) : null}
              </div>
              {onCompactContext ? (
                <div className="border-t border-border/50 pt-1.5 dark:border-white/[0.08]">
                  <button
                    type="button"
                    disabled={compactDisabled}
                    onClick={() => {
                      setContextOpen(false);
                      onCompactContext();
                    }}
                    className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-xl px-2 text-xs text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/[0.07]"
                  >
                    <Minimize2Icon className="size-3.5" />
                    <span>{gt("Compact")}</span>
                  </button>
                </div>
              ) : null}
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}

      {primaryLimitPercent !== null && limits ? (
        <Popover open={usageOpen} onOpenChange={setUsageOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      className={triggerClass}
                      aria-label={gt("{label}: {left}% left", {
                        label: primaryLimitPercent.label,
                        left: primaryLimitPercent.percent,
                      })}
                    />
                  }
                />
              }
            >
              <MiniGaugeRing
                percent={primaryLimitPercent.percent}
                tone={limitTone(primaryLimitPercent.percent) ?? "default"}
              />
              <span>{primaryLimitPercent.percent}%</span>
            </TooltipTrigger>
            <TooltipPopup side="top">
              <div className="flex flex-col gap-0.5">
                {modelLabel ? (
                  <span className="font-medium text-foreground">{modelLabel}</span>
                ) : null}
                <span className={modelLabel ? "text-muted-foreground" : "text-foreground"}>
                  {gt("{label}: {left}% left", {
                    label: primaryLimitPercent.label,
                    left: primaryLimitPercent.percent,
                  })}
                </span>
              </div>
            </TooltipPopup>
          </Tooltip>
          <PopoverPopup side="top" align="end" sideOffset={8} width="sm" padding="compact">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 px-2 pt-0.5">
                <span className="min-w-0 truncate text-xs font-semibold text-foreground">
                  {usageHeaderLabel}
                </span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {gt("Usage limits")}
                </span>
              </div>
              <AthenaUsageLimitsList limits={limits} now={now} />
              <div className="border-t border-border/50 pt-1.5 dark:border-white/[0.08]">
                <Link
                  to="/usage"
                  onClick={() => setUsageOpen(false)}
                  className="flex h-7 w-full items-center justify-between rounded-xl px-2 text-xs text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.07]"
                >
                  <span>{gt("Open usage")}</span>
                  <ArrowUpRightIcon className="size-3.5" />
                </Link>
              </div>
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}
