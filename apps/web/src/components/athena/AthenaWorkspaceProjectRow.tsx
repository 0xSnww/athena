import type { EditorId, EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { formatFilePathForClipboard } from "@t3tools/client-runtime/media-actions";
import * as Schema from "effect/Schema";
import { msg, T, useGT } from "gt-react";
import { FilesIcon, SquareTerminalIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { contextMenuSourceOf } from "~/contextMenuSource";
import {
  ClipboardApiUnavailableError,
  ClipboardWriteError,
  writeTextToClipboard,
} from "~/hooks/useCopyToClipboard";
import { m as resolveMessage } from "~/i18n/messages";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { OpenInPicker } from "../chat/OpenInPicker";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { ProjectFavicon } from "../ProjectFavicon";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const isClipboardApiUnavailableError = Schema.is(ClipboardApiUnavailableError);
const isClipboardWriteError = Schema.is(ClipboardWriteError);

interface AthenaWorkspaceProjectRowProps {
  readonly environmentId: EnvironmentId;
  readonly project: EnvironmentProject;
  readonly workspacePath: string | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly showOpenInPicker: boolean;
  readonly openInShortcutEnabled: boolean;
  readonly terminalOpen?: boolean | undefined;
  readonly filesPanelOpen?: boolean | undefined;
  readonly onOpenFiles?: (() => void) | undefined;
  readonly onToggleTerminal?: (() => void) | undefined;
}

function showProjectPathContextMenu(event: ReactMouseEvent, workspacePath: string) {
  const api = readLocalApi();
  if (!api) return;
  event.preventDefault();
  event.stopPropagation();
  void api.contextMenu
    .show(
      [{ id: "copy-path", label: resolveMessage(msg("Copy full path")), icon: "copy" }],
      { x: event.clientX, y: event.clientY },
      contextMenuSourceOf(event),
    )
    .then((action) => {
      if (action !== "copy-path") return;
      const clipboardPath = formatFilePathForClipboard(workspacePath);
      void writeTextToClipboard(clipboardPath, {
        target: "workspace path",
        unavailableMessage: msg("Clipboard API is unavailable while copying workspace path."),
        failureMessage: msg("Failed to copy workspace path to the clipboard."),
      }).then(undefined, (error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: resolveMessage(msg("Failed to copy path")),
            description: isClipboardApiUnavailableError(error)
              ? resolveMessage(msg("Clipboard API is unavailable while copying workspace path."))
              : isClipboardWriteError(error)
                ? resolveMessage(msg("Failed to copy workspace path to the clipboard."))
                : (thrownErrorMessage(error, resolveMessage) ??
                  resolveMessage(msg("An error occurred."))),
          }),
        );
      });
    });
}

/**
 * Compact project identity row for Card 1: project icon, title, and inline quick
 * triggers for Files, Terminal, and Open in Editor.
 */
export function AthenaWorkspaceProjectRow(props: AthenaWorkspaceProjectRowProps) {
  const gt = useGT();
  const terminalShortcut = shortcutLabelForCommand(props.keybindings, "terminal.toggle");
  const displayPath = props.workspacePath ?? props.project.workspaceRoot;

  return (
    <div
      className={cn(
        "flex h-8 w-full min-w-0 items-center rounded-xl",
        THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
      )}
      data-athena-workspace-project-row=""
      onContextMenu={(event) => {
        if (displayPath) showProjectPathContextMenu(event, displayPath);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          delay={300}
          render={<div className="flex min-w-0 flex-1 items-center gap-2.5" />}
        >
          <ProjectFavicon project={props.project} className="size-4 shrink-0 rounded-sm" />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs font-medium text-foreground/90",
              THREAD_DETAILS_PANEL_LABEL_CLASS,
            )}
          >
            {props.project.title}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="left">
          <span className="font-mono text-2xs">{displayPath}</span>
        </TooltipPopup>
      </Tooltip>

      <div className="flex shrink-0 items-center gap-0.5">
        {props.onOpenFiles ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="icon-xs"
                  variant="ghost"
                  part="icon"
                  tone={props.filesPanelOpen ? "primary" : "muted"}
                  aria-label={gt("Open project files")}
                  aria-pressed={props.filesPanelOpen || undefined}
                  onClick={props.onOpenFiles}
                />
              }
            >
              <FilesIcon className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipPopup side="top">
              <T>Files</T>
            </TooltipPopup>
          </Tooltip>
        ) : null}

        {props.onToggleTerminal ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ThreadDetailsControl
                  size="icon-xs"
                  variant="ghost"
                  part="icon"
                  tone={props.terminalOpen ? "primary" : "muted"}
                  aria-label={props.terminalOpen ? gt("Hide terminal") : gt("Open terminal")}
                  aria-pressed={props.terminalOpen || undefined}
                  onClick={props.onToggleTerminal}
                />
              }
            >
              <SquareTerminalIcon className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {terminalShortcut
                ? gt("Toggle terminal ({shortcut})", { shortcut: terminalShortcut })
                : gt("Toggle terminal")}
            </TooltipPopup>
          </Tooltip>
        ) : null}

        {props.showOpenInPicker ? (
          <OpenInPicker
            keybindings={props.keybindings}
            environmentId={props.environmentId}
            availableEditors={props.availableEditors}
            openInCwd={props.workspacePath}
            enableShortcut={props.openInShortcutEnabled}
            displayMode="compact-icon"
          />
        ) : null}
      </div>
    </div>
  );
}
