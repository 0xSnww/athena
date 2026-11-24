import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { SideThreadOpenIntent } from "@t3tools/client-runtime/side-thread";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import {
  deriveWorkflowGroups,
  projectedSubagentsToRuntime,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { deriveProviderSubagentStatus } from "@t3tools/client-runtime/state/thread-execution";
import {
  deriveThreadRelationshipGraph,
  immediateThreadRelationships,
  isParentThreadRelationship,
  orderWebThreadLineageRows,
  resolveMergeBackTargetThreadId,
  threadRelationshipRowStatus,
  type ThreadRelationshipEdge,
  type ThreadRelationshipWalkRow,
} from "@t3tools/client-runtime/state/thread-relationships";
import {
  canDetachThreadProviderSession,
  resolveLatestMergeBackRun,
} from "@t3tools/client-runtime/state/thread-workflows";
import {
  isOrchestrationV2WorkActive,
  isProviderNativeSubagentThread,
  NodeId,
  type EnvironmentId,
  type OrchestrationV2DelegatedFrom,
  type OrchestrationV2RemoteTaskChild,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ProviderDriverKind,
  type ScopedThreadRef,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  BotIcon,
  CornerLeftUpIcon,
  CpuIcon,
  EllipsisIcon,
  GitForkIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  PlusIcon,
  SquareIcon,
  UnplugIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import type { MessageResolver } from "~/i18n/messages";
import { useSideThreadTrigger } from "~/hooks/useSideThreadTrigger";
import { useArchivedThreadSnapshots } from "~/lib/archivedThreadsState";
import { openSideThread, resolveThreadOpenRoute } from "~/lib/sideChatPane";
import { cn } from "~/lib/utils";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "~/providerInstances";
import {
  useAnyEnvironmentHiding,
  useHiddenThreadKeys,
  useProjects,
  useQuietThreadProjection,
  useQuietThreadShell,
  useThreadRelationshipShells,
} from "~/state/entities";
import { useEnvironment, useEnvironmentProviders } from "~/state/environments";
import { useLinkedThreadOpener } from "~/state/linkedThreadView";
import { orchestrationEnvironment, threadTitlesRead } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { AgentElapsed } from "../chat/AgentElapsed";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { SubagentTooltipContent } from "../chat/SubagentTooltipContent";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadLineageWorkflowRow } from "../chat/ThreadLineageWorkflowRow";
import { threadRelationshipStatusLabel } from "../chat/ThreadRelationshipIcon";
import {
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "../chat/threadDetailsPanelStyles";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AthenaAgentBadge } from "./AthenaAgentBadge";

export interface AthenaActiveProviderPresentation {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
}

interface AthenaRightTeamCardProps {
  readonly environmentId: EnvironmentId;
  readonly projectName: string | null;
  readonly threadId: ThreadId;
  readonly isServerThread: boolean;
  readonly activeThreadTitle: string;
  readonly activeModelLabel?: string | null | undefined;
  readonly activeEffortLabel?: string | null | undefined;
  readonly activeProvider?: AthenaActiveProviderPresentation | null | undefined;
  readonly showRelationships: boolean;
  readonly showLineage: boolean;
  readonly showSideChats: boolean;
  readonly onNewThreadInProject?: (() => void) | undefined;
  readonly onOpenSideChat?: (() => void) | undefined;
}

const TEAM_INITIAL_COUNT = 4;
const TEAM_PAGE_COUNT = 8;

const AGENT_GLYPH_TONES = [
  "text-emerald-400",
  "text-lime-400",
  "text-amber-400",
  "text-orange-400",
  "text-sky-400",
  "text-violet-400",
] as const;

type RemoteSubagent = OrchestrationV2Subagent & {
  readonly remoteChild: OrchestrationV2RemoteTaskChild;
};

type TeamEntry =
  | {
      readonly kind: "local";
      readonly key: string;
      readonly row: ThreadRelationshipWalkRow;
      readonly active: boolean;
      readonly isSideChat: boolean;
    }
  | {
      readonly kind: "remote";
      readonly key: string;
      readonly remote: RemoteSubagent;
      readonly active: boolean;
    };

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function agentGlyphToneForKey(key: string): string {
  return AGENT_GLYPH_TONES[hashString(key) % AGENT_GLYPH_TONES.length]!;
}

/** Splits titles like "Tyr: Table Tennis Break Room" into lead name + task summary. */
export function splitAgentTeamLabel(title: string): {
  readonly lead: string;
  readonly detail: string | null;
} {
  const trimmed = title.trim();
  const match = /^([^:—–·/]{2,20})\s*(?::|—|–|·)\s+(.+)$/.exec(trimmed);
  if (!match) return { lead: trimmed, detail: null };
  return { lead: match[1]!.trim(), detail: match[2]!.trim() };
}

function isFinishedAgentStatus(status: string | null | undefined) {
  return ["completed", "failed", "error", "cancelled", "interrupted", "idle"].includes(
    status ?? "",
  );
}

function relationshipHint(
  edge: ThreadRelationshipEdge,
  currentThreadId: ThreadId,
  sideChat: boolean,
  resolve: MessageResolver,
) {
  if (sideChat) return resolve(msg("Open side chat"));
  if (edge.kind === "transfer") return resolve(msg("Open context transfer in this chat"));
  if (edge.kind === "subagent") {
    return edge.sourceThreadId === currentThreadId
      ? resolve(msg("Open subagent"))
      : resolve(msg("Open parent agent in this chat"));
  }
  return edge.sourceThreadId === currentThreadId
    ? resolve(msg("Open fork in this chat"))
    : resolve(msg("Open parent thread in this chat"));
}

function relationshipThreadTitle(input: {
  readonly title: string;
  readonly isSubagent: boolean;
}): string {
  if (!input.isSubagent) return input.title;
  return formatSubagentDisplayTitle(input.title);
}

function currentSubagent<Agent extends RuntimeSubagent>(
  agent: Agent | undefined,
  childThread: OrchestrationV2ThreadShell | null | undefined,
): Agent | undefined {
  if (!agent || !childThread || isOrchestrationV2WorkActive(agent.status)) return agent;
  const liveStatus =
    childThread.activityRunStatus ?? (childThread.status === "queued" ? "queued" : null);
  const newerRun =
    childThread.latestRunRequestedAt &&
    DateTime.toEpochMillis(childThread.latestRunRequestedAt) >
      Date.parse(agent.completedAt ?? agent.startedAt ?? agent.updatedAt);
  if (!liveStatus && !newerRun) return agent;
  const status = liveStatus ?? childThread.status;
  const startedAt = liveStatus ? childThread.activityRunStartedAt : childThread.latestRunStartedAt;
  const completedAt = liveStatus ? null : childThread.latestRunCompletedAt;
  return {
    ...agent,
    status:
      status === "preparing" || status === "starting" || status === "queued"
        ? "pending"
        : status === "rolled_back"
          ? "interrupted"
          : status,
    startedAt: startedAt ? DateTime.formatIso(startedAt) : null,
    completedAt: completedAt ? DateTime.formatIso(completedAt) : null,
    progress: null,
    result: null,
    error: null,
  };
}

function AthenaMiniAgentGlyph(props: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-3.5 shrink-0", props.className)}
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <rect height="2" rx="0.5" width="2" x="4" y="2.5" />
      <rect height="2" rx="0.5" width="2" x="10" y="2.5" />
      <rect height="7" rx="1.75" width="10" x="3" y="4.5" />
      <rect fill="var(--color-background)" height="2" rx="0.5" width="1.6" x="5.4" y="7" />
      <rect fill="var(--color-background)" height="2" rx="0.5" width="1.6" x="9" y="7" />
      <rect height="2" rx="0.5" width="2.2" x="4.4" y="11.5" />
      <rect height="2" rx="0.5" width="2.2" x="9.4" y="11.5" />
    </svg>
  );
}

/** Vertical 2x3 braille-style activity matrix matching the right-side team indicator. */
function AthenaStatusMatrixGlyph(props: {
  readonly status: string | null | undefined;
  readonly className?: string;
}) {
  const status = props.status ?? "idle";
  const isActive =
    status === "running" ||
    status === "in_progress" ||
    status === "starting" ||
    status === "preparing";
  const isWaiting =
    status === "pending" || status === "queued" || status === "waiting" || status === "blocked";
  const isFailed = status === "failed" || status === "error";
  const isCompleted = status === "completed";

  const toneClass = isFailed
    ? "text-destructive"
    : isWaiting
      ? "text-warning"
      : isActive
        ? "text-info"
        : isCompleted
          ? "text-muted-foreground/55"
          : "text-muted-foreground/35";

  return (
    <svg
      aria-hidden="true"
      className={cn("size-3 shrink-0", toneClass, props.className)}
      fill="currentColor"
      viewBox="0 0 8 12"
    >
      <circle cx="2" cy="2" r="1" opacity={isActive ? 1 : 0.75} />
      <circle cx="6" cy="2" r="1" opacity={isActive ? 0.45 : 0.75} />
      <circle cx="2" cy="6" r="1" opacity={isActive ? 0.65 : 0.75} />
      <circle cx="6" cy="6" r="1" opacity={isActive ? 1 : 0.75} />
      <circle cx="2" cy="10" r="1" opacity={isActive ? 1 : 0.75} />
      <circle cx="6" cy="10" r="1" opacity={isActive ? 0.55 : 0.75} />
    </svg>
  );
}

function AgentProviderMark(props: {
  readonly driver?: ProviderDriverKind | undefined;
  readonly provider?: ServerProvider | undefined;
  readonly providerEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly fallbackKind: "subagent" | "sideChat" | "fork" | "parent";
}) {
  const entry = props.driver
    ? props.providerEntries.find((candidate) => candidate.instanceId === props.provider?.instanceId)
    : undefined;
  const showInstanceBadge =
    entry !== undefined && shouldShowInstanceBadge(entry, props.providerEntries);

  if (props.driver) {
    return (
      <ProviderInstanceIcon
        driverKind={props.driver}
        displayName={entry?.displayName ?? props.provider?.displayName ?? props.driver}
        accentColor={entry?.accentColor}
        acpRegistryAgentId={entry?.acpRegistryAgentId}
        acpRegistryIconUrl={entry?.acpRegistryIconUrl ?? props.provider?.iconUrl}
        showBadge={showInstanceBadge}
        size="compact"
        iconClassName="size-3.5 text-muted-foreground/85"
        className="z-auto"
      />
    );
  }
  const Fallback =
    props.fallbackKind === "parent"
      ? CornerLeftUpIcon
      : props.fallbackKind === "sideChat"
        ? MessagesSquareIcon
        : props.fallbackKind === "fork"
          ? GitForkIcon
          : BotIcon;
  return <Fallback aria-hidden className="size-3.5 shrink-0 text-muted-foreground/80" />;
}

function LineageTooltipContent(props: { readonly title: string; readonly hint: string }) {
  return (
    <>
      <span className="block font-medium">{props.title}</span>
      <span className="block text-muted-foreground">{props.hint}</span>
    </>
  );
}

function RemoteTeamRow(props: {
  readonly agent: RemoteSubagent;
  readonly parentRef: ScopedThreadRef;
  readonly provider: ServerProvider | undefined;
  readonly providerEntries: ReadonlyArray<ProviderInstanceEntry>;
}) {
  const gt = useGT();
  const { remoteChild } = props.agent;
  const title = relationshipThreadTitle({
    title: props.agent.title ?? gt("Subagent"),
    isSubagent: true,
  });
  const { lead, detail } = splitAgentTeamLabel(title);
  const opener = useLinkedThreadOpener(props.parentRef, remoteChild, title);
  const trigger = useSideThreadTrigger();

  return (
    <li className="group relative flex h-8 items-center rounded-lg">
      <Tooltip>
        <TooltipTrigger
          delay={200}
          render={
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="row"
              {...(opener ? trigger(opener.open, { panel: opener.mode === "linked" }) : {})}
            />
          }
        >
          <AgentProviderMark
            driver={props.provider?.driver}
            provider={props.provider}
            providerEntries={props.providerEntries}
            fallbackKind="subagent"
          />
          <AthenaMiniAgentGlyph className={agentGlyphToneForKey(props.agent.id)} />
          <span className="min-w-0 flex-1 truncate text-left text-xs leading-tight">
            <span className="font-medium text-foreground/90">{lead}</span>
            {detail ? (
              <span className="ml-1.5 font-normal text-muted-foreground/75">{detail}</span>
            ) : (
              <span className="ml-1.5 font-normal text-muted-foreground/60">
                · {remoteChild.label}
              </span>
            )}
          </span>
          <AthenaStatusMatrixGlyph status={props.agent.status} />
        </TooltipTrigger>
        <TooltipPopup side="left">
          <LineageTooltipContent
            title={title}
            hint={
              opener?.mode === "linked"
                ? gt("Read the thread on {label}", { label: remoteChild.label })
                : gt("Open on {label}", { label: remoteChild.label })
            }
          />
        </TooltipPopup>
      </Tooltip>
    </li>
  );
}

function DelegatedFromTeamRow(props: {
  readonly delegatedFrom: OrchestrationV2DelegatedFrom;
  readonly fallbackLabel: string | undefined;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const router = useRouter();
  const { delegatedFrom } = props;
  const environment = useEnvironment(delegatedFrom.environmentId);
  const parentRef = scopeThreadRef(delegatedFrom.environmentId, delegatedFrom.threadId);
  const parent = useQuietThreadShell(parentRef);
  const readParent = useAtomCommand(threadTitlesRead);
  const [opening, setOpening] = useState(false);
  const label = environment?.label ?? props.fallbackLabel;
  const title = parent?.title ?? delegatedFrom.title;

  const openParent = async () => {
    if (opening) return;
    setOpening(true);
    const location = router.latestLocation;
    const result = await readParent({
      environmentId: delegatedFrom.environmentId,
      input: { threadIds: [delegatedFrom.threadId] },
    });
    setOpening(false);
    if (router.latestLocation !== location) return;
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: gt("Could not open the parent thread") });
      return;
    }
    if (result.value[delegatedFrom.threadId] === undefined) {
      toastManager.add({ type: "info", title: gt("The parent thread was deleted") });
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(parentRef),
    });
  };

  return (
    <li className="group relative flex h-8 items-center rounded-lg">
      <Tooltip>
        <TooltipTrigger
          delay={200}
          render={
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="row"
              aria-disabled={environment === null || undefined}
              onClick={() => {
                if (environment === null) return;
                void openParent();
              }}
            />
          }
        >
          <CornerLeftUpIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground/80" />
          <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground/85">
            {title}
          </span>
          {label ? (
            <span className="max-w-1/2 shrink-0 truncate text-2xs text-muted-foreground">
              <T>
                on <Var>{label}</Var>
              </T>
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="left">
          <LineageTooltipContent
            title={title}
            hint={
              environment === null
                ? label
                  ? gt("Delegated from {label}. Connect to it to open the parent thread.", {
                      label,
                    })
                  : gt(
                      "Delegated from a linked environment. Connect to it to open the parent thread.",
                    )
                : gt("Open parent agent on {label}", { label: environment.label })
            }
          />
        </TooltipPopup>
      </Tooltip>
    </li>
  );
}

/**
 * Right-side floating Card 2: always displays the main thread & active model header
 * on top, and expands the "Agent team" roster below when subagents, side chats, or
 * lineage relationships spawn.
 */
export function AthenaRightTeamCard(props: AthenaRightTeamCardProps) {
  const gt = useGT();
  const m = useMessages();
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const projection =
    useQuietThreadProjection(props.isServerThread ? ref : null)?.projection ?? null;
  const providersByEnvironment = useEnvironmentProviders();
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const relationshipShells = useThreadRelationshipShells(ref);
  const hiddenKeys = useHiddenThreadKeys();
  const hidingAnywhere = useAnyEnvironmentHiding();
  const allProjects = useProjects();
  const archived = useArchivedThreadSnapshots(props.isServerThread ? [props.environmentId] : []);
  const archivedShells = archived.snapshots.find(
    (entry) => entry.environmentId === props.environmentId,
  )?.snapshot.threads;

  const currentThread =
    projection?.thread ??
    relationshipShells.find((thread) => thread.id === props.threadId) ??
    archivedShells?.find((thread) => thread.id === props.threadId);
  const parentThreadId =
    currentThread?.forkedFrom?.type === "run"
      ? currentThread.forkedFrom.threadId
      : currentThread?.lineage.parentThreadId;
  const parentShell = parentThreadId
    ? (relationshipShells.find((thread) => thread.id === parentThreadId) ??
      archivedShells?.find((thread) => thread.id === parentThreadId))
    : undefined;
  const parentRef =
    parentShell && isProviderNativeSubagentThread(parentShell)
      ? scopeThreadRef(props.environmentId, parentShell.id)
      : null;
  const parentProjection = useQuietThreadProjection(parentRef)?.projection;

  const navigate = useNavigate();
  const trigger = useSideThreadTrigger();
  const mergeBack = useAtomCommand(threadEnvironment.mergeBack);
  const stopSession = useAtomCommand(threadEnvironment.stopSession);
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn);
  const stopWorkflowCommand = useAtomCommand(orchestrationEnvironment.stopWorkflow);
  const canOperateWorkflow = useAtomValue(
    orchestrationEnvironment.stopWorkflow.permissionAtom(props.environmentId),
  );

  const [busyAction, setBusyAction] = useState<"merge" | "detach" | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "active">("all");
  const [visibleCount, setVisibleCount] = useState(TEAM_INITIAL_COUNT);
  const mergeErrorToastId = useRef<string | null>(null);
  const detachErrorToastId = useRef<string | null>(null);

  const providers = providersByEnvironment.get(props.environmentId);
  const derivedProviderEntries = deriveProviderInstanceEntries(providers ?? []);
  const providerEntries = settings
    ? applyProviderInstanceSettings(
        derivedProviderEntries,
        settings,
        currentThread?.projectId ?? null,
      )
    : derivedProviderEntries;
  const projects = allProjects.filter((project) => project.environmentId === props.environmentId);
  const parentNativeStatus = parentProjection
    ? deriveProviderSubagentStatus(parentProjection)?.status
    : undefined;

  const projected = projection?.subagents ?? [];
  const runtimeSubagents = projectedSubagentsToRuntime(projected);
  const byId = new Map(runtimeSubagents.map((agent) => [agent.id, agent]));
  const subagentsByThreadId = new Map(
    projected
      .filter((subagent) => subagent.childThreadId !== null)
      .map((subagent) => [
        subagent.childThreadId,
        {
          ...byId.get(subagent.id)!,
          id: subagent.id,
          threadId: subagent.threadId,
          runId: subagent.runId,
          nativeTaskRef: subagent.nativeTaskRef,
          nativeStatus: subagent.status,
          driver: subagent.driver,
          providerInstanceId: subagent.providerInstanceId,
          origin: subagent.origin,
          modelSelection: subagent.modelSelection,
        },
      ]),
  );
  const workflowGroupsById = new Map(
    deriveWorkflowGroups(runtimeSubagents, m).map((group) => [group.workflow.id, group]),
  );

  const shells: ReadonlyArray<OrchestrationV2ThreadShell> = [
    ...relationshipShells,
    ...(archivedShells ?? []),
  ];
  const graph = deriveThreadRelationshipGraph({ threads: shells, projection });
  const isHiddenRelation = (threadId: ThreadId) =>
    hiddenKeys.has(threadKey({ environmentId: props.environmentId, threadId }));
  const isHiddenUnloadedRelation = (row: { threadId: ThreadId; edge: ThreadRelationshipEdge }) =>
    hidingAnywhere &&
    graph.nodes.get(row.threadId)?.missing === true &&
    (row.edge.kind !== "subagent" || isParentThreadRelationship(row.edge, props.threadId));

  const currentProject = projects.find((project) => project.id === currentThread?.projectId);
  const latestMergeBackRun = projection === null ? null : resolveLatestMergeBackRun(projection);
  const mergeTargetThreadId = resolveMergeBackTargetThreadId(projection);
  const relationshipRows = props.isServerThread
    ? orderWebThreadLineageRows({
        graph,
        rows: immediateThreadRelationships(graph, props.threadId),
        currentThreadId: props.threadId,
        mergeTargetThreadId,
      })
        .filter((row) => !isHiddenRelation(row.threadId) && !isHiddenUnloadedRelation(row))
        .map((row) => {
          const agent =
            row.edge.kind === "subagent" && !isParentThreadRelationship(row.edge, props.threadId)
              ? subagentsByThreadId.get(row.threadId)
              : undefined;
          const workflowGroup = agent === undefined ? undefined : workflowGroupsById.get(agent.id);
          return workflowGroup === undefined
            ? row
            : { ...row, edge: { ...row.edge, status: workflowGroup.workflow.status } };
        })
    : [];

  const unlistedThreadIds = relationshipRows
    .filter(
      ({ threadId, edge }) =>
        !relationshipShells.some((thread) => thread.id === threadId) &&
        (edge.kind !== "subagent" || !subagentsByThreadId.get(threadId)?.title),
    )
    .map(({ threadId }) => threadId);
  const threadTitles = useEnvironmentQuery(
    unlistedThreadIds.length === 0
      ? null
      : orchestrationEnvironment.threadTitles({
          environmentId: props.environmentId,
          input: { threadIds: unlistedThreadIds },
        }),
  );
  const resolvedThreadTitles = threadTitles.data ?? {};
  const visibleRelationships = relationshipRows.filter(
    ({ threadId, edge }) =>
      edge.kind === "subagent" ||
      !unlistedThreadIds.includes(threadId) ||
      !threadTitles.isSuccess ||
      threadTitles.isPending ||
      Object.hasOwn(resolvedThreadTitles, threadId),
  );

  const canDetach = projection ? canDetachThreadProviderSession(projection) : false;
  const canMerge = mergeTargetThreadId !== null && latestMergeBackRun !== null;
  const delegatedFrom = props.isServerThread ? currentThread?.delegatedFrom : undefined;

  const parentRows: ThreadRelationshipWalkRow[] = [];
  const activeTeamEntries: TeamEntry[] = [];
  const finishedTeamEntries: TeamEntry[] = [];

  for (const row of visibleRelationships) {
    const isParent = isParentThreadRelationship(row.edge, props.threadId);
    const isSideChat =
      !isParent && graph.nodes.get(row.threadId)?.thread?.lineage.sideChat === true;
    if (isSideChat && !props.showSideChats) continue;
    if (!isSideChat && !props.showLineage) continue;
    if (isParent) {
      parentRows.push(row);
      continue;
    }
    const active = !isFinishedAgentStatus(row.edge.status);
    const entry: TeamEntry = {
      kind: "local",
      key: `local:${row.threadId}`,
      row,
      active,
      isSideChat,
    };
    if (active) activeTeamEntries.push(entry);
    else finishedTeamEntries.push(entry);
  }

  if (props.showLineage && props.isServerThread) {
    for (const agent of projected) {
      if (agent.remoteChild === undefined) continue;
      const remote = agent as RemoteSubagent;
      const active = !isFinishedAgentStatus(remote.status);
      const entry: TeamEntry = {
        kind: "remote",
        key: `remote:${remote.id}`,
        remote,
        active,
      };
      if (active) activeTeamEntries.push(entry);
      else finishedTeamEntries.push(entry);
    }
  }

  const allTeamEntries = [...activeTeamEntries, ...finishedTeamEntries];
  const filteredEntries = filterMode === "active" ? activeTeamEntries : allTeamEntries;
  const visibleEntries = filteredEntries.slice(0, visibleCount);
  const hiddenCount = Math.max(0, filteredEntries.length - visibleEntries.length);

  const hasTeamContent =
    props.isServerThread &&
    props.showRelationships &&
    (allTeamEntries.length > 0 || parentRows.length > 0 || delegatedFrom !== undefined);

  const openThread = (threadId: ThreadId) => {
    const routeRef = resolveThreadOpenRoute(
      scopeThreadRef(props.environmentId, threadId),
      graph.nodes.get(threadId)?.thread ?? null,
    );
    if (routeRef.threadId === ref.threadId) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(routeRef),
    });
  };

  const openSideThreadRow = (threadId: ThreadId, intent: SideThreadOpenIntent) => {
    openSideThread({
      threadRef: scopeThreadRef(props.environmentId, threadId),
      panelRef: ref,
      intent,
      navigate: (threadRef) =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        }),
    });
  };

  const merge = async () => {
    if (!latestMergeBackRun || mergeTargetThreadId === null || busyAction !== null) return;
    if (mergeErrorToastId.current !== null) {
      toastManager.close(mergeErrorToastId.current);
      mergeErrorToastId.current = null;
    }
    setBusyAction("merge");
    const result = await mergeBack({
      environmentId: props.environmentId,
      input: {
        sourceThreadId: props.threadId,
        targetThreadId: mergeTargetThreadId,
        runId: latestMergeBackRun.id,
      },
    });
    setBusyAction(null);
    if (result._tag === "Failure") {
      mergeErrorToastId.current = toastManager.add({
        type: "error",
        title: gt("Could not merge back"),
      });
      return;
    }
    openThread(mergeTargetThreadId);
  };

  const detach = async () => {
    if (!canDetach || busyAction !== null) return;
    if (detachErrorToastId.current !== null) {
      toastManager.close(detachErrorToastId.current);
      detachErrorToastId.current = null;
    }
    setBusyAction("detach");
    const result = await stopSession({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    });
    setBusyAction(null);
    if (result._tag === "Failure") {
      detachErrorToastId.current = toastManager.add({
        type: "error",
        title: gt("Could not disconnect agent session"),
      });
    }
  };

  const stopSubagent = async (
    childThreadId: ThreadId,
    agent: Pick<OrchestrationV2Subagent, "id" | "threadId">,
  ) => {
    if (stoppingId !== null) return;
    setStoppingId(childThreadId);
    const result = await interruptTurn({
      environmentId: props.environmentId,
      input: { threadId: agent.threadId, subagentId: agent.id },
    });
    setStoppingId(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: gt("Could not stop subagent") });
    }
  };

  const stopWorkflow = async (subagentId: string) => {
    if (stoppingId !== null) return;
    setStoppingId(subagentId);
    const result = await stopWorkflowCommand({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, subagentId: NodeId.make(subagentId) },
    });
    setStoppingId(null);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: gt("Could not stop workflow") });
    }
  };

  const parentTitle =
    mergeTargetThreadId === null
      ? null
      : isHiddenRelation(mergeTargetThreadId)
        ? null
        : (graph.nodes.get(mergeTargetThreadId)?.thread?.title ?? null);

  const renderLocalRow = ({ threadId, edge }: ThreadRelationshipWalkRow) => {
    const node = graph.nodes.get(threadId);
    const isSubagent = edge.kind === "subagent";
    const isMergeTarget = threadId === mergeTargetThreadId;
    const isParent = isParentThreadRelationship(edge, props.threadId);
    const isSideChat = node?.thread?.lineage.sideChat === true && !isParent;
    const rowStatus =
      (isParent && threadId === parentRef?.threadId
        ? (node?.thread?.activityRunStatus ?? parentNativeStatus)
        : undefined) ?? threadRelationshipRowStatus(graph, { threadId, edge });

    const projectedAgent = isSubagent && !isParent ? subagentsByThreadId.get(threadId) : undefined;
    const workflowGroup =
      projectedAgent === undefined ? undefined : workflowGroupsById.get(projectedAgent.id);
    const agent = workflowGroup ? projectedAgent : currentSubagent(projectedAgent, node?.thread);
    const canStop =
      agent &&
      (agent.origin === "app_owned" ||
        (agent.origin === "provider_native" &&
          agent.driver === "claudeAgent" &&
          agent.runId != null &&
          agent.nativeTaskRef?.strength === "strong" &&
          agent.nativeTaskRef.nativeId !== null &&
          ["pending", "running", "waiting"].includes(agent.nativeStatus))) &&
      agent.startedAt &&
      ["pending", "running", "waiting"].includes(agent.status);

    const threadTitle = relationshipThreadTitle({
      title:
        workflowGroup?.workflow.workflowName ??
        (Object.hasOwn(resolvedThreadTitles, threadId)
          ? resolvedThreadTitles[threadId]
          : undefined) ??
        node?.thread?.title ??
        agent?.title ??
        threadId,
      isSubagent,
    });
    const { lead, detail } = splitAgentTeamLabel(threadTitle);
    const provider = providers?.find(
      (entry) =>
        entry.instanceId === (agent?.providerInstanceId ?? node?.thread?.providerInstanceId),
    );
    const providerDriver = agent?.driver ?? provider?.driver;
    const canStopWorkflow =
      canOperateWorkflow &&
      workflowGroup?.workflow.status === "running" &&
      agent?.origin === "provider_native" &&
      providerDriver === "claudeAgent";
    const project = projects.find((candidate) => candidate.id === node?.thread?.projectId);
    const hint = relationshipHint(edge, props.threadId, isSideChat, m);
    const openProps =
      isSideChat || (isSubagent && !isParent)
        ? trigger((intent) => openSideThreadRow(threadId, intent))
        : { onClick: () => openThread(threadId) };
    const RelationshipPopup = agent ? ThreadHoverCardPopup : TooltipPopup;
    const relationshipTooltip = agent ? (
      <SubagentTooltipContent
        title={threadTitle}
        model={agent.model}
        providerInstanceId={agent.providerInstanceId}
        origin={agent.origin}
        modelSelection={agent.modelSelection}
        provider={provider}
        providers={providers}
        driver={providerDriver}
        elapsed={<AgentElapsed agent={agent} />}
        status={agent.status}
        result={agent.result}
        progress={agent.progress}
        parentThread={currentThread ?? undefined}
        childThread={node?.thread ?? undefined}
        parentProject={currentProject}
        childProject={project}
      />
    ) : (
      <LineageTooltipContent title={threadTitle} hint={hint} />
    );

    const trailingVisibilityClass = (workflowGroup ? canStopWorkflow : canStop)
      ? "transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 pointer-coarse:opacity-0 [@media(hover:none)]:opacity-0"
      : "";

    const rowContent = (
      <>
        <AgentProviderMark
          driver={isSubagent && !isParent ? providerDriver : undefined}
          provider={provider}
          providerEntries={providerEntries}
          fallbackKind={
            isParent ? "parent" : isSideChat ? "sideChat" : isSubagent ? "subagent" : "fork"
          }
        />
        {!isParent ? <AthenaMiniAgentGlyph className={agentGlyphToneForKey(threadId)} /> : null}
        <span className="min-w-0 flex-1 truncate text-left text-xs leading-tight">
          <span className="font-medium text-foreground/90">{lead}</span>
          {detail ? (
            <span className="ml-1.5 font-normal text-muted-foreground/75">{detail}</span>
          ) : null}
        </span>
        {!isMergeTarget ? (
          <AthenaStatusMatrixGlyph status={rowStatus} className={trailingVisibilityClass} />
        ) : null}
      </>
    );

    const rowTrigger = (
      <Tooltip>
        <TooltipTrigger
          delay={200}
          render={
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part={workflowGroup ? "primary" : "row"}
              {...openProps}
            />
          }
        >
          {rowContent}
        </TooltipTrigger>
        <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
      </Tooltip>
    );

    if (workflowGroup && agent) {
      return (
        <ThreadLineageWorkflowRow
          key={threadId}
          group={workflowGroup}
          providerInstanceId={agent.providerInstanceId}
          provider={provider}
          providers={providers}
          providerEntries={providerEntries}
          driver={providerDriver}
          onOpenThread={(memberThreadId, intent) =>
            openSideThreadRow(memberThreadId as ThreadId, intent)
          }
          onStop={canStopWorkflow ? () => void stopWorkflow(agent.id) : undefined}
          stopping={stoppingId === agent.id}
          stopDisabled={stoppingId !== null}
          header={rowTrigger}
        />
      );
    }

    return (
      <li key={threadId} className="group relative flex h-8 items-center rounded-lg">
        {isMergeTarget ? (
          <div className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
            <Tooltip>
              <TooltipTrigger
                delay={200}
                render={
                  <ThreadDetailsControl
                    size="sm"
                    variant="ghost"
                    part="primary"
                    aria-label={`${threadTitle} ${threadRelationshipStatusLabel(rowStatus, m)}`}
                    onClick={() => openThread(threadId)}
                  />
                }
              >
                {rowContent}
              </TooltipTrigger>
              <RelationshipPopup side="left">{relationshipTooltip}</RelationshipPopup>
            </Tooltip>
            <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="sm"
                    variant="ghost"
                    part="secondary"
                    aria-label={
                      parentTitle
                        ? gt("Merge back to {parentTitle}", { parentTitle })
                        : gt("Merge back to source conversation")
                    }
                    aria-disabled={!canMerge || busyAction !== null || undefined}
                    onClick={() => void merge()}
                  >
                    {busyAction === "merge" ? (
                      <Spinner size="xs" />
                    ) : (
                      <PullRequestGlyph.merged className="size-3" />
                    )}
                  </ThreadDetailsControl>
                }
              />
              <TooltipPopup side="left">
                {latestMergeBackRun === null
                  ? gt("Complete a run in this fork before merging it back")
                  : parentTitle
                    ? gt("Merge this conversation back into {parentTitle}", { parentTitle })
                    : gt("Merge this conversation back into its source")}
              </TooltipPopup>
            </Tooltip>
          </div>
        ) : (
          rowTrigger
        )}
        {canStop && agent ? (
          <div className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="icon-xs"
                    variant="ghost"
                    part="icon"
                    tone="destructive"
                    aria-label={gt("Stop subagent {threadTitle}", { threadTitle })}
                    disabled={stoppingId !== null}
                    onClick={() => void stopSubagent(threadId, agent)}
                  />
                }
              >
                {stoppingId === threadId ? (
                  <Spinner aria-hidden size="xs" />
                ) : (
                  <SquareIcon aria-hidden className="size-3 fill-current" />
                )}
              </TooltipTrigger>
              <TooltipPopup side="left">
                <T>Stop subagent</T>
              </TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
      </li>
    );
  };

  const quickAction = props.onOpenSideChat ?? props.onNewThreadInProject;
  const quickActionLabel = props.onOpenSideChat ? gt("Open side chat") : gt("New thread");
  const activeModelSummary =
    props.activeModelLabel && props.activeEffortLabel
      ? `${props.activeModelLabel} · ${props.activeEffortLabel}`
      : props.activeModelLabel;

  return (
    <section
      aria-label={gt("Active agent and team")}
      className="athena-floating-card overflow-hidden rounded-2xl p-2"
      data-athena-right-team-card=""
    >
      <div className="flex items-center gap-2.5 rounded-xl border border-border/75 bg-black/[0.03] px-2.5 py-2 dark:border-white/[0.07] dark:bg-white/[0.035]">
        <AthenaAgentBadge size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1 text-xs leading-tight">
            <span className="truncate font-semibold text-foreground">
              {props.activeThreadTitle}
            </span>
            {props.projectName ? (
              <span className="shrink-0 truncate text-xs text-muted-foreground/65">
                · {props.projectName}
              </span>
            ) : null}
          </div>
          {props.activeModelLabel ? (
            <Tooltip>
              <TooltipTrigger
                delay={300}
                render={
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs leading-tight text-muted-foreground/80" />
                }
              >
                {props.activeProvider ? (
                  <ProviderInstanceIcon
                    driverKind={props.activeProvider.driverKind}
                    displayName={props.activeProvider.displayName}
                    accentColor={props.activeProvider.accentColor}
                    acpRegistryAgentId={props.activeProvider.acpRegistryAgentId}
                    acpRegistryIconUrl={props.activeProvider.acpRegistryIconUrl}
                    size="compact"
                    iconClassName="size-3 shrink-0 opacity-85"
                    className="z-auto"
                  />
                ) : (
                  <CpuIcon className="size-3 shrink-0 opacity-75" />
                )}
                <span className="truncate">{props.activeModelLabel}</span>
              </TooltipTrigger>
              <TooltipPopup side="left">{activeModelSummary}</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
        {quickAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={quickActionLabel}
                  onClick={quickAction}
                  className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border/80 bg-black/[0.03] text-muted-foreground transition-colors hover:bg-black/[0.07] hover:text-foreground dark:border-white/[0.09] dark:bg-white/[0.04] dark:hover:bg-white/[0.09]"
                >
                  <MessageSquarePlusIcon className="size-3.5" />
                </button>
              }
            />
            <TooltipPopup side="left">{quickActionLabel}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>

      {hasTeamContent ? (
        <div className="mt-2 px-0.5" data-thread-relationships-panel="">
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground/85">
              <span>
                <T>Agent team</T>
              </span>
              <span className="tabular-nums text-muted-foreground/55">
                {allTeamEntries.length || parentRows.length + (delegatedFrom ? 1 : 0)}
              </span>
              {activeTeamEntries.length > 0 ? (
                <span className="truncate text-2xs font-normal text-info/90 tabular-nums">
                  ·{" "}
                  <T>
                    <Var>{activeTeamEntries.length}</Var> running
                  </T>
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {quickAction ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={quickActionLabel}
                        onClick={quickAction}
                        className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <PlusIcon className="size-3" />
                      </button>
                    }
                  />
                  <TooltipPopup side="top">{quickActionLabel}</TooltipPopup>
                </Tooltip>
              ) : null}

              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={gt("Agent team options")}
                      className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground/75 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <EllipsisIcon className="size-3" />
                    </button>
                  }
                />
                <MenuPopup align="end" className="min-w-44">
                  {activeTeamEntries.length > 0 && finishedTeamEntries.length > 0 ? (
                    <>
                      <MenuItem
                        onClick={() => setFilterMode((mode) => (mode === "all" ? "active" : "all"))}
                      >
                        {filterMode === "active" ? (
                          <T>Show all agents</T>
                        ) : (
                          <T>Show running only</T>
                        )}
                      </MenuItem>
                      <MenuSeparator />
                    </>
                  ) : null}
                  {filteredEntries.length > TEAM_INITIAL_COUNT ? (
                    <MenuItem
                      onClick={() =>
                        setVisibleCount((count) =>
                          count > TEAM_INITIAL_COUNT ? TEAM_INITIAL_COUNT : filteredEntries.length,
                        )
                      }
                    >
                      {visibleCount > TEAM_INITIAL_COUNT ? <T>Show fewer</T> : <T>Show all</T>}
                    </MenuItem>
                  ) : null}
                  {props.onNewThreadInProject ? (
                    <MenuItem onClick={props.onNewThreadInProject}>
                      <PlusIcon className="size-3.5" />
                      <T>New thread in project</T>
                    </MenuItem>
                  ) : null}
                  {canDetach ? (
                    <>
                      <MenuSeparator />
                      <MenuItem disabled={busyAction !== null} onClick={() => void detach()}>
                        <UnplugIcon className="size-3.5" />
                        <T>Disconnect agent session</T>
                      </MenuItem>
                    </>
                  ) : null}
                </MenuPopup>
              </Menu>
            </div>
          </div>

          <ul
            aria-label={gt("Agent team")}
            data-athena-team-list=""
            className="m-0 flex max-h-[14rem] list-none flex-col gap-0.5 overflow-y-auto p-0 has-data-workflow-expanded:max-h-[min(28rem,55dvh)]"
          >
            {delegatedFrom ? (
              <DelegatedFromTeamRow
                key={`${scopedThreadKey(ref)}:delegated-from`}
                delegatedFrom={delegatedFrom}
                fallbackLabel={currentThread?.linkOrigin?.label}
              />
            ) : null}
            {parentRows.map(renderLocalRow)}
            {visibleEntries.map((entry) =>
              entry.kind === "remote" ? (
                <RemoteTeamRow
                  key={entry.key}
                  agent={entry.remote}
                  parentRef={ref}
                  provider={providersByEnvironment
                    .get(entry.remote.remoteChild.environmentId)
                    ?.find((candidate) => candidate.instanceId === entry.remote.providerInstanceId)}
                  providerEntries={providerEntries}
                />
              ) : (
                renderLocalRow(entry.row)
              ),
            )}
          </ul>

          {hiddenCount > 0 ? (
            <ThreadDetailsControl
              variant="ghost"
              size="sm"
              part="row"
              tone="muted"
              className="mt-0.5 w-full"
              onClick={() => setVisibleCount((count) => count + TEAM_PAGE_COUNT)}
            >
              <T>
                Show <Var>{Math.min(hiddenCount, TEAM_PAGE_COUNT)}</Var> more
              </T>
            </ThreadDetailsControl>
          ) : visibleCount > TEAM_INITIAL_COUNT && filteredEntries.length > TEAM_INITIAL_COUNT ? (
            <ThreadDetailsControl
              variant="ghost"
              size="sm"
              part="row"
              tone="muted"
              className="mt-0.5 w-full"
              onClick={() => setVisibleCount(TEAM_INITIAL_COUNT)}
            >
              <T>Show less</T>
            </ThreadDetailsControl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
