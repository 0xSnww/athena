import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type DiscoveredLocalServer,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isLoopbackHost } from "@t3tools/shared/preview";
import { msg, T, useGT, Var } from "gt-react";
import { m } from "~/i18n/messages";
import {
  CableIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  SquareIcon,
} from "lucide-react";
import { type MouseEvent, useRef, useState } from "react";

import {
  resolveExternalServerUrl,
  tunnelsEnvironmentLoopback,
} from "../../browser/browserTargetResolver";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { readLocalApi } from "../../localApi";
import { cn, isMacPlatform } from "../../lib/utils";
import { useThreadDiscoveredPorts } from "../../portDiscoveryState";
import { useEnvironment } from "../../state/environments";
import {
  canForwardPorts,
  findPortForward,
  forwardedUrl,
  forwardPort,
  stopPortForward,
  useForwardLocality,
  usePortForwards,
} from "../../state/portForwards";
import { previewEnvironment } from "../../state/preview";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { AthenaPortIcon, resolvePortPresentation } from "../athena/AthenaPortIcon";
import { openDiscoveredPort } from "../preview/openDiscoveredPort";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

const SERVER_PAGE_COUNT = 4;

const serverKey = (server: DiscoveredLocalServer) => `${server.pid}:${server.port}`;

interface ThreadServersPanelProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

/** Local servers the thread's terminals and agent started. Hidden while none run. */
export function ThreadServersPanel(props: ThreadServersPanelProps) {
  return <ThreadServersList key={`${props.environmentId}:${props.threadId}`} {...props} />;
}

function ThreadServersList(props: ThreadServersPanelProps) {
  const gt = useGT();
  const servers = useThreadDiscoveredPorts(props);
  const canOpen = useEnvironmentScope(props.environmentId, AuthPreviewOperateScope);
  const canStop = useAtomValue(
    previewEnvironment.stopLocalServer.permissionAtom(props.environmentId),
  );
  const environment = useEnvironment(props.environmentId);
  const supportsStop = environment?.serverConfig?.environment.capabilities.localServerStop === true;
  const forwards = usePortForwards();
  const forwardable =
    useEnvironmentScope(props.environmentId, AuthTerminalOperateScope) &&
    environment?.connection.phase === "connected" &&
    canForwardPorts(environment);
  const locality = useForwardLocality(forwardable ? props.environmentId : null);
  const canForward = locality === "remote";
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const stopServer = useAtomCommand(previewEnvironment.stopLocalServer, {
    label: "thread server stop",
  });
  const [stoppingKey, setStoppingKey] = useState<string | null>(null);
  const [forwardingPort, setForwardingPort] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SERVER_PAGE_COUNT);
  const copiedTimerRef = useRef<number | null>(null);

  if (servers.length === 0) return null;
  const externalClickLabel = isMacPlatform(navigator.platform) ? "⌘-click" : "Ctrl-click";
  const threadRef = scopeThreadRef(props.environmentId, props.threadId);
  const hiddenCount = Math.max(0, servers.length - visibleCount);

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: thrownErrorMessage(error, m) ?? String(error),
      }),
    );
  };

  const open = async (server: DiscoveredLocalServer, event: MouseEvent<HTMLElement>) => {
    if (event.button > 1) return;
    // Like links: modified and middle clicks go to the system browser.
    if (event.metaKey || event.ctrlKey || event.button === 1) {
      event.preventDefault();
      // This machine's browser reaches another environment's loopback only through a forward.
      // Starting a forward runs the probe; only a confirmed local environment opens directly.
      const forwarding = forwardable && locality !== "local";
      const url = forwarding
        ? await forwardPort(props.environmentId, server.port).then(
            (forward) => forwardedUrl(forward, server.url),
            (error: unknown) => {
              reportFailure(gt("Could not forward port {port}", { port: server.port }), error);
              return null;
            },
          )
        : resolveExternalServerUrl(props.environmentId, server.url);
      if (url === null) return;
      // Without a forward, a remote environment's localhost would open this machine's instead.
      if (
        !forwarding &&
        locality !== "local" &&
        tunnelsEnvironmentLoopback(environment?.entry.target) &&
        isLoopbackHost(new URL(url).hostname)
      ) {
        reportFailure(
          gt("Unable to open in browser"),
          new Error(
            gt(
              "localhost:{port} runs on another machine, and port forwarding isn't available for it right now.",
              { port: server.port },
            ),
          ),
        );
        return;
      }
      await readLocalApi()
        ?.shell.openExternal(url)
        .catch((error: unknown) => reportFailure(gt("Unable to open in browser"), error));
      return;
    }
    const result = await openDiscoveredPort({ threadRef, port: server, openPreview });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(gt("Unable to open preview"), squashAtomCommandFailure(result));
    }
  };

  const stop = async (server: DiscoveredLocalServer) => {
    if (server.pid === null || stoppingKey !== null) return;
    setStoppingKey(serverKey(server));
    const result = await stopServer({
      environmentId: props.environmentId,
      input: { pid: server.pid, port: server.port },
    });
    setStoppingKey(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(gt("Could not stop server"), squashAtomCommandFailure(result));
    }
  };

  const toggleForward = async (server: DiscoveredLocalServer, forwarded: boolean) => {
    if (forwardingPort !== null) return;
    setForwardingPort(server.port);
    await (
      forwarded
        ? stopPortForward(props.environmentId, server.port)
        : forwardPort(props.environmentId, server.port)
    ).catch((error: unknown) =>
      reportFailure(gt("Could not forward port {port}", { port: server.port }), error),
    );
    setForwardingPort(null);
  };

  const copyServerUrl = async (server: DiscoveredLocalServer, urlToCopy: string) => {
    const key = serverKey(server);
    await writeTextToClipboard(urlToCopy, {
      target: "server url",
      unavailableMessage: msg("Clipboard API is unavailable while copying server URL."),
      failureMessage: msg("Failed to copy server URL to the clipboard."),
    }).then(
      () => {
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
        setCopiedKey(key);
        copiedTimerRef.current = window.setTimeout(() => {
          setCopiedKey((current) => (current === key ? null : current));
        }, 1600);
      },
      (error: unknown) => reportFailure(gt("Could not copy URL"), error),
    );
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-servers-heading"
      title={gt("Ports", { $context: "thread details section: running dev server ports" })}
    >
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {servers.slice(0, visibleCount).map((server, index) => {
          const key = serverKey(server);
          const stoppable = canStop && supportsStop && server.pid !== null;
          const forward = findPortForward(forwards, props.environmentId, server.port);
          const presentation = resolvePortPresentation(server.processName);
          const displayName =
            presentation.brand ??
            (server.terminal === null ? gt("Agent server") : gt("Local server"));
          const copyTargetUrl = forward
            ? forwardedUrl(forward, server.url)
            : resolveExternalServerUrl(props.environmentId, server.url);
          const actionCount = 1 + Number(stoppable) + Number(canForward);
          const hidePortOnHover = !forward && actionCount > 0;
          return (
            <li
              key={key}
              data-thread-details-server-overflow={index >= SERVER_PAGE_COUNT || undefined}
              className="group relative flex items-center rounded-lg"
            >
              <Tooltip>
                <TooltipTrigger
                  delay={200}
                  render={
                    <ThreadDetailsControl
                      size="sm"
                      variant="ghost"
                      part="row"
                      disabled={!canOpen}
                      onClick={(event) => void open(server, event)}
                      onAuxClick={(event) => void open(server, event)}
                    />
                  }
                >
                  <AthenaPortIcon
                    processName={server.processName}
                    className={THREAD_DETAILS_PANEL_ICON_CLASS}
                  />
                  <span
                    className={cn(
                      "flex min-w-0 flex-1 items-center justify-between gap-2",
                      forward && "pe-7",
                    )}
                  >
                    <span className="truncate text-xs font-medium leading-4 text-foreground/85">
                      {displayName}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-2xs tabular-nums leading-4 text-muted-foreground/75 transition-opacity",
                        hidePortOnHover &&
                          "group-hover:opacity-0 group-focus-within:opacity-0 pointer-coarse:opacity-0 [@media(hover:none)]:opacity-0",
                      )}
                    >
                      {forward
                        ? gt(":{port} → :{localPort}", {
                            port: server.port,
                            localPort: forward.localPort,
                          })
                        : `:${server.port}`}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipPopup side="left">
                  <T>
                    Open in the browser panel. <Var>{externalClickLabel}</Var> for your browser.
                  </T>
                </TooltipPopup>
              </Tooltip>
              <div
                className={cn(
                  "absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-opacity",
                  // A forward stays visible: it holds a port on this machine.
                  !forward &&
                    "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                )}
              >
                <span
                  className={cn(
                    forward &&
                      "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                  )}
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ThreadDetailsControl
                          size="icon-xs"
                          variant="ghost"
                          part="icon"
                          aria-label={gt("Copy URL for port {port}", { port: server.port })}
                          onClick={() => void copyServerUrl(server, copyTargetUrl)}
                        />
                      }
                    >
                      {copiedKey === key ? (
                        <CheckIcon aria-hidden className="size-3.5 text-success" />
                      ) : (
                        <CopyIcon aria-hidden className="size-3.5" />
                      )}
                    </TooltipTrigger>
                    <TooltipPopup side="left">
                      {copiedKey === key ? <T>Copied URL</T> : <T>Copy URL</T>}
                    </TooltipPopup>
                  </Tooltip>
                </span>
                {canForward ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ThreadDetailsControl
                          size="icon-xs"
                          variant="ghost"
                          part="icon"
                          aria-pressed={forward !== undefined}
                          aria-label={
                            forward
                              ? gt("Stop forwarding localhost:{port}", { port: server.port })
                              : gt("Forward localhost:{port} to this machine", {
                                  port: server.port,
                                })
                          }
                          disabled={forwardingPort !== null}
                          onClick={() => void toggleForward(server, forward !== undefined)}
                        />
                      }
                    >
                      {forwardingPort === server.port ? (
                        <Spinner aria-hidden size="xs" />
                      ) : (
                        <CableIcon
                          aria-hidden
                          className={cn("size-3.5", forward && "text-primary")}
                        />
                      )}
                    </TooltipTrigger>
                    <TooltipPopup side="left">
                      {forward ? (
                        <T>
                          Forwarded to localhost:<Var>{forward.localPort}</Var> on this machine.
                          Click to stop.
                        </T>
                      ) : (
                        <T>Forward to this machine, for any app here</T>
                      )}
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
                {stoppable ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <ThreadDetailsControl
                          size="icon-xs"
                          variant="ghost"
                          part="icon"
                          tone="destructive"
                          aria-label={gt("Stop localhost:{port}", { port: server.port })}
                          disabled={stoppingKey !== null}
                          onClick={() => void stop(server)}
                        />
                      }
                    >
                      {stoppingKey === key ? (
                        <Spinner aria-hidden size="xs" />
                      ) : (
                        <SquareIcon aria-hidden className="size-3 fill-current" />
                      )}
                    </TooltipTrigger>
                    <TooltipPopup side="left">
                      <T>Stop server</T>
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {servers.length > SERVER_PAGE_COUNT ? (
        <ThreadDetailsControl
          variant="ghost"
          size="sm"
          onClick={() =>
            setVisibleCount(hiddenCount > 0 ? visibleCount + SERVER_PAGE_COUNT : SERVER_PAGE_COUNT)
          }
          part="row"
          tone="muted"
          className="mt-0.5 w-full active:scale-100"
        >
          {hiddenCount > 0 ? (
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <ChevronUpIcon aria-hidden className="size-3.5 shrink-0" />
          )}
          {hiddenCount > 0 ? (
            <T>
              Show <Var>{Math.min(hiddenCount, SERVER_PAGE_COUNT)}</Var> more
            </T>
          ) : (
            <T>Show less</T>
          )}
        </ThreadDetailsControl>
      ) : null}
    </ThreadDetailsSection>
  );
}
