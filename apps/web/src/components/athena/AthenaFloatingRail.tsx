import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FolderCodeIcon,
  PanelLeftIcon,
  PlusIcon,
  SquarePenIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useProjects, useQuietThreadShell } from "~/state/entities";
import { ProjectFavicon } from "../ProjectFavicon";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function subscribeNavigation(onChange: () => void): () => void {
  const nav = typeof window !== "undefined" ? window.navigation : undefined;
  if (!nav) return () => {};
  nav.addEventListener("currententrychange", onChange);
  return () => nav.removeEventListener("currententrychange", onChange);
}

function readCanGoBack(): boolean {
  if (typeof window === "undefined") return false;
  if (window.navigation) return window.navigation.canGoBack;
  return window.history.length > 1;
}

function readCanGoForward(): boolean {
  if (typeof window === "undefined") return false;
  if (window.navigation) return window.navigation.canGoForward;
  return false;
}

/**
 * Minimal floating left chrome shown when the desktop sidebar is collapsed:
 * top-left history arrows, floating 3-slot pill dock, and bottom-left settings avatar.
 */
export function AthenaFloatingRail() {
  const gt = useGT();
  const navigate = useNavigate();
  const { open, setOpen, toggleSidebar } = useSidebar();
  const canGoBack = useSyncExternalStore(subscribeNavigation, readCanGoBack, () => false);
  const canGoForward = useSyncExternalStore(subscribeNavigation, readCanGoForward, () => false);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const projects = useProjects();
  const liveThread = useQuietThreadShell(routeThreadRef);
  const draftProjectRef = useComposerDraftStore((store) => {
    if (!routeThreadRef) return null;
    const draft = store.getDraftThread(
      scopeThreadRef(routeThreadRef.environmentId, routeThreadRef.threadId),
    );
    return draft ? scopeProjectRef(draft.environmentId, draft.projectId) : null;
  });

  const activeProjectRef = activeThread
    ? scopeProjectRef(activeThread.environmentId, activeThread.projectId)
    : activeDraftThread
      ? scopeProjectRef(activeDraftThread.environmentId, activeDraftThread.projectId)
      : liveThread
        ? scopeProjectRef(liveThread.environmentId, liveThread.projectId)
        : (draftProjectRef ?? defaultProjectRef);

  const activeProject = activeProjectRef
    ? (projects.find(
        (project) =>
          project.environmentId === activeProjectRef.environmentId &&
          project.id === activeProjectRef.projectId,
      ) ?? null)
    : null;

  const startNewThread = () => {
    const targetRef = activeProjectRef ?? defaultProjectRef;
    if (targetRef) {
      void handleNewThread(targetRef);
      return;
    }
    void navigate({ to: "/" });
  };

  return (
    <>
      <div
        className="pointer-events-none fixed top-[var(--workspace-controls-top)] left-[var(--workspace-controls-left)] z-40 flex h-[var(--workspace-topbar-height)] items-center [-webkit-app-region:no-drag]"
        data-athena-history-controls
      >
        <div className="pointer-events-auto inline-flex items-center gap-0.5 rounded-full border border-border/60 bg-black/[0.03] p-0.5 dark:border-white/[0.07] dark:bg-white/[0.04]">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Go back")}
                  disabled={!canGoBack}
                  onClick={() => window.history.back()}
                  className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                />
              }
            >
              <ArrowLeftIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{gt("Go back")}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Go forward")}
                  disabled={!canGoForward}
                  onClick={() => window.history.forward()}
                  className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                />
              }
            >
              <ArrowRightIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{gt("Go forward")}</TooltipPopup>
          </Tooltip>
        </div>
      </div>

      <nav
        aria-label={gt("Quick navigation")}
        data-athena-floating-dock
        className="athena-floating-card pointer-events-auto fixed top-[calc(var(--workspace-topbar-height)+4px)] left-3 z-40 flex flex-col items-center gap-1 rounded-2xl p-1.5 [-webkit-app-region:no-drag]"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-athena-sidebar-trigger=""
                aria-label={gt("Toggle main sidebar")}
                onClick={toggleSidebar}
                className={cn(
                  "inline-flex size-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  open && "bg-black/[0.07] text-foreground dark:bg-white/[0.09]",
                )}
              />
            }
          >
            <PanelLeftIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="right">{gt("Toggle sidebar")}</TooltipPopup>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={
                  activeProject
                    ? gt("Projects ({project})", { project: activeProject.title })
                    : gt("Projects")
                }
                onClick={() => setOpen(true)}
                className="inline-flex size-8 cursor-pointer items-center justify-center rounded-xl bg-black/[0.04] transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-white/[0.06]"
              />
            }
          >
            {activeProject ? (
              <ProjectFavicon project={activeProject} className="size-5 rounded-md" />
            ) : (
              <FolderCodeIcon className="size-4 text-muted-foreground" />
            )}
          </TooltipTrigger>
          <TooltipPopup side="right">
            {activeProject ? activeProject.title : gt("Switch project")}
          </TooltipPopup>
        </Tooltip>

        {open ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("Add project")}
                  onClick={() => openCommandPalette({ open: "add-project" })}
                  className="inline-flex size-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <PlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="right">{gt("Add project")}</TooltipPopup>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={gt("New thread")}
                  onClick={startNewThread}
                  className="inline-flex size-8 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            >
              <SquarePenIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="right">{gt("New thread")}</TooltipPopup>
          </Tooltip>
        )}
      </nav>

      <div className="pointer-events-auto fixed bottom-3.5 left-3 z-40 [-webkit-app-region:no-drag]">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={gt("Settings")}
                onClick={() => void navigate({ to: "/settings" })}
                className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full border border-border/80 bg-card text-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:border-white/15 dark:bg-message"
              />
            }
          >
            <span
              aria-hidden="true"
              className="size-5 rounded-full bg-radial from-primary/80 via-muted-foreground/50 to-background ring-1 ring-white/20"
            />
          </TooltipTrigger>
          <TooltipPopup side="right">{gt("Settings")}</TooltipPopup>
        </Tooltip>
      </div>
    </>
  );
}
