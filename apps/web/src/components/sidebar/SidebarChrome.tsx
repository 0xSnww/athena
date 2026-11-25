import { ArrowLeftIcon, ArrowUpRightIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { T, useGT } from "gt-react";
import { memo, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { formatModelSlugName } from "@t3tools/shared/model";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { useShownThreadRouteTarget } from "../../hooks/useShownThreadRouteTarget";
import { cn } from "../../lib/utils";
import { useQuietThreadShell, useServerConfigs } from "../../state/entities";
import {
  useEnvironmentProviders,
  useIssuesSupported,
  usePrimaryEnvironmentId,
  usePullRequestsSupported,
} from "../../state/environments";
import { AthenaUsageLimitsList } from "../athena/AthenaComposerUsageRings";
import { resolveThreadDetailsLimits } from "../chat/ThreadDetailsUsage.logic";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { readIssueListPreferences } from "../issue/issueListPreferences";
import { IssueGlyph } from "../issue/issuePresentation";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const gt = useGT();
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <div
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-2 pr-3",
        isElectron && "drag-region",
      )}
    >
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 ml-[calc(var(--workspace-controls-left)+1px-env(safe-area-inset-left))] flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant="ghost"
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      {pillLabel ? (
        <div className="relative z-10 hidden h-7 items-center pl-2 md:flex">
          <Badge data-environment-identification="pill" size="sm" variant="secondary">
            {pillLabel}
          </Badge>
        </div>
      ) : null}
    </div>
  );
});

export function SidebarBrandWidthProbe({
  onWidthChange,
}: {
  isElectron?: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-0"
      ref={observeWidth}
    />
  );
}

function SidebarUsageMenuItem({ onOpenUsagePage }: { readonly onOpenUsagePage: () => void }) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const { shownTarget } = useShownThreadRouteTarget();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const serverConfigs = useServerConfigs();

  const activeThreadRef = shownTarget?.kind === "server" ? shownTarget.threadRef : null;
  const activeThreadShell = useQuietThreadShell(activeThreadRef);
  const draftSession = useComposerDraftStore((store) =>
    shownTarget?.kind === "draft" ? store.getDraftSession(shownTarget.draftId) : null,
  );
  const draftModelSelection = useComposerDraftStore((store) => {
    const target =
      shownTarget?.kind === "server"
        ? shownTarget.threadRef
        : shownTarget?.kind === "draft"
          ? shownTarget.draftId
          : null;
    if (!target) return null;
    const draft = store.getComposerDraft(target);
    return draft?.activeProvider
      ? (draft.modelSelectionByProvider[draft.activeProvider] ?? null)
      : null;
  });

  const activeEnvironmentId =
    activeThreadRef?.environmentId ?? draftSession?.environmentId ?? primaryEnvironmentId;
  const activeProviders = activeEnvironmentId
    ? (providersByEnvironment.get(activeEnvironmentId) ?? [])
    : [];
  const activeServerConfig = activeEnvironmentId
    ? (serverConfigs.get(activeEnvironmentId) ?? null)
    : null;
  const activeSources = activeServerConfig?.usageLimitSources ?? [];

  const activeSelection = draftModelSelection ?? activeThreadShell?.modelSelection ?? null;
  const activeProvider =
    (activeSelection
      ? activeProviders.find((entry) => entry.instanceId === activeSelection.instanceId)
      : null) ??
    activeProviders.find((entry) => entry.usageLimits != null) ??
    null;
  const activeModelSlug = activeSelection?.model ?? null;
  const activeModelCatalogEntry =
    activeProvider && activeModelSlug
      ? activeProvider.models.find((candidate) => candidate.slug === activeModelSlug)
      : null;
  const activeModelLabel =
    activeModelCatalogEntry?.name ??
    (activeModelSlug ? formatModelSlugName(activeModelSlug) : null) ??
    activeProvider?.displayName ??
    null;

  const activeLimits = activeProvider
    ? resolveThreadDetailsLimits(
        activeProvider.instanceId,
        activeModelSlug,
        activeProviders,
        activeSources,
        now,
      )
    : null;

  const otherProviderLimits = activeProviders
    .filter((entry) => entry.instanceId !== activeProvider?.instanceId)
    .flatMap((entry) => {
      const limits = resolveThreadDetailsLimits(
        entry.instanceId,
        null,
        activeProviders,
        activeSources,
        now,
      );
      if (!limits) return [];
      if (limits.kind === "instance" && limits.limits.windows.length === 0) return [];
      if (limits.kind === "pool" && limits.windows.length === 0) return [];
      return [{ provider: entry, limits }];
    });

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton aria-label={gt("Usage")} size="icon">
                    <ChartNoAxesColumnIcon />
                  </SidebarMenuButton>
                }
              />
            }
          />
          <TooltipPopup side="top">{gt("Usage")}</TooltipPopup>
        </Tooltip>
        <PopoverPopup side="top" align="start" sideOffset={8} width="sm" padding="compact">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-2 pt-0.5">
              <span className="text-xs font-semibold text-foreground">{gt("Usage")}</span>
              {activeModelLabel ? (
                <span className="max-w-36 truncate rounded-full bg-black/[0.05] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/[0.07]">
                  {activeModelLabel}
                </span>
              ) : null}
            </div>
            {activeLimits ? (
              <AthenaUsageLimitsList limits={activeLimits} now={now} />
            ) : otherProviderLimits.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {gt("Usage limits are unavailable for this provider")}
              </p>
            ) : null}
            {otherProviderLimits.map(({ provider, limits }) => (
              <div
                key={provider.instanceId}
                className="flex flex-col gap-1 border-t border-border/45 pt-1.5 dark:border-white/[0.07]"
              >
                <span className="px-2 text-2xs font-medium text-muted-foreground">
                  {provider.displayName}
                </span>
                <AthenaUsageLimitsList limits={limits} now={now} />
              </div>
            ))}
            <div className="border-t border-border/50 pt-1.5 dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenUsagePage();
                }}
                className="flex h-7 w-full cursor-pointer items-center justify-between rounded-xl px-2 text-xs text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.07]"
              >
                <span>{gt("Open usage")}</span>
                <ArrowUpRightIcon className="size-3.5" />
              </button>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}

function SidebarUtilityItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton aria-label={label} onClick={onClick} size="icon">
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const { isMobile, setOpenMobile } = useSidebar();
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleIssuesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/issues", search: readIssueListPreferences() });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };

  const handleUsageClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  };

  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  return (
    <SidebarMenu className="flex-row items-center">
      {isOnUtilityPage ? (
        <SidebarMenuItem className="min-w-0 flex-1">
          <SidebarMenuButton onClick={handleBackClick}>
            <ArrowLeftIcon />
            <span>
              <T>Back</T>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label={gt("Settings")}
            onClick={handleSettingsClick}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label={gt("Pull requests")}
              onClick={handlePullRequestsClick}
            />
          ) : null}
          {issuesSupported ? (
            <SidebarUtilityItem
              icon={<IssueGlyph.issue />}
              label={gt("Issues", { $context: "sidebar link to the list of issues" })}
              onClick={handleIssuesClick}
            />
          ) : null}
          <SidebarUsageMenuItem onOpenUsagePage={handleUsageClick} />
        </>
      )}
      <SidebarThreadUndoNotice />
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <div className="border-t border-border/45 dark:border-white/[0.07]">
      <SidebarFooter>
        <SidebarProviderUpdatePill />
        <SidebarUpdateArchitectureWarning />
        <SidebarUtilityMenu />
      </SidebarFooter>
    </div>
  );
});
