import { type EnvironmentId, type MessageId, type TurnId } from "@t3tools/contracts";
import {
  createContext,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { type TurnDiffSummary } from "../../types";
import { buildTurnDiffTree, summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  CircleSmallIcon,

  EyeIcon,
  GlobeIcon,
  LoaderIcon,
  LogsIcon,
  type LucideIcon,
  SearchIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { InlineEditDiff } from "./InlineEditDiff";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  computeStableMessagesTimelineRows,
  MAX_VISIBLE_WORK_LOG_ENTRIES,
  deriveMessagesTimelineRows,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";

import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "../../editorPreferences";
import { splitPathAndPosition } from "../../terminal-links";

// ---------------------------------------------------------------------------
// Context — shared state consumed by every row component via useContext.
// Propagates through LegendList's memo boundaries for shared callbacks and
// non-row-scoped state. `nowIso` is intentionally excluded — self-ticking
// components (WorkingTimer, LiveElapsed) handle it.
// ---------------------------------------------------------------------------

interface TimelineRowSharedState {
  activeTurnInProgress: boolean;
  activeTurnId: TurnId | null | undefined;
  isWorking: boolean;
  isRevertingCheckpoint: boolean;
  completionSummary: string | null;
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertUserMessage: (messageId: MessageId) => void;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onCopyTurnJson: (turnId: TurnId) => void;
  agentEditedFilesByTurnId: Map<TurnId, Set<string>>;
}

const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);

// ---------------------------------------------------------------------------
// Props (public API)
// ---------------------------------------------------------------------------

interface MessagesTimelineProps {
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnId?: TurnId | null;
  activeTurnStartedAt: string | null;
  listRef: React.RefObject<LegendListRef | null>;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  completionDividerBeforeEntryId: string | null;
  completionSummary: string | null;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  agentEditedFilesByTurnId: Map<TurnId, Set<string>>;
  routeThreadKey: string;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onCopyTurnJson: (turnId: TurnId) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  onIsAtEndChange: (isAtEnd: boolean) => void;
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  activeTurnId,
  activeTurnStartedAt,
  listRef,
  timelineEntries,
  completionDividerBeforeEntryId,
  completionSummary,
  turnDiffSummaryByAssistantMessageId,
  agentEditedFilesByTurnId,
  routeThreadKey,
  onOpenTurnDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  onCopyTurnJson,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  onIsAtEndChange,
}: MessagesTimelineProps) {
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      completionDividerBeforeEntryId,
      isWorking,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const rows = useStableRows(rawRows);

  const handleScroll = useCallback(() => {
    const state = listRef.current?.getState?.();
    if (state) {
      onIsAtEndChange(state.isAtEnd);
    }
  }, [listRef, onIsAtEndChange]);

  const previousRowCountRef = useRef(rows.length);
  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;

    if (previousRowCount > 0 || rows.length === 0) {
      return;
    }

    onIsAtEndChange(true);
    const frameId = window.requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd?.({ animated: false });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [listRef, onIsAtEndChange, rows.length]);

  // Memoised context value — only changes on state transitions, NOT on
  // every streaming chunk. Callbacks from ChatView are useCallback-stable.
  const sharedState = useMemo<TimelineRowSharedState>(
    () => ({
      activeTurnInProgress,
      activeTurnId: activeTurnId ?? null,
      isWorking,
      isRevertingCheckpoint,
      completionSummary,
      timestampFormat,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      activeThreadEnvironmentId,
      onRevertUserMessage,
      onImageExpand,
      onOpenTurnDiff,
      onCopyTurnJson,
      agentEditedFilesByTurnId,
    }),
    [
      activeTurnInProgress,
      activeTurnId,
      isWorking,
      isRevertingCheckpoint,
      completionSummary,
      timestampFormat,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      activeThreadEnvironmentId,
      onRevertUserMessage,
      onImageExpand,
      onOpenTurnDiff,
      onCopyTurnJson,
      agentEditedFilesByTurnId,
    ],
  );

  // Per-row size hints so the virtualizer doesn't assume 90px for everything.
  // Edit diffs render at ~350px (collapsed max-height + header + padding),
  // work log groups are typically ~60-80px, thinking sections ~120px.
  // Better estimates = less layout thrash when rows enter the viewport.
  const getEstimatedItemSize = useCallback((item: MessagesTimelineRow) => {
    switch (item.kind) {
      case "edit":
        return 400;
      case "work":
        return 70;
      case "thinking":
        return 120;
      case "proposed-plan":
        return 200;
      case "message":
        return 90;
      default:
        return 90;
    }
  }, []);

  // Stable renderItem — no closure deps. Row components read shared state
  // from TimelineRowCtx, which propagates through LegendList's memo.
  const renderItem = useCallback(
    ({ item }: { item: MessagesTimelineRow }) => (
      <div className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden" data-timeline-root="true">
        <TimelineRowContent row={item} />
      </div>
    ),
    [],
  );

  if (rows.length === 0 && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <TimelineRowCtx.Provider value={sharedState}>
      <LegendList<MessagesTimelineRow>
        ref={listRef}
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        getEstimatedItemSize={getEstimatedItemSize}
        estimatedItemSize={90}
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainScrollAtEndThreshold={0.1}
        maintainVisibleContentPosition
        onScroll={handleScroll}
        className="h-full overflow-x-hidden overscroll-y-contain px-3 sm:px-5"
        ListHeaderComponent={<div className="h-3 sm:h-4" />}
        ListFooterComponent={<div className="h-3 sm:h-4" />}
      />
    </TimelineRowCtx.Provider>
  );
});

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

// ---------------------------------------------------------------------------
// TimelineRowContent — the actual row component
// ---------------------------------------------------------------------------

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];
type TimelineRow = MessagesTimelineRow;

function TimelineRowContent({ row }: { row: TimelineRow }) {
  const ctx = use(TimelineRowCtx);

  return (
    <div
      className={cn(
        "pb-4",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" && <WorkGroupSection groupedEntries={row.groupedEntries} />}

      {row.kind === "thinking" && <ThinkingSection message={row.message} />}

      {row.kind === "edit" && (
        <InlineEditDiff
          editEntry={row.editEntry}
          workspaceRoot={ctx.workspaceRoot}
          resolvedTheme={ctx.resolvedTheme}
        />
      )}

      {row.kind === "message" &&
        row.message.role === "user" &&
        (() => {
          const userImages = row.message.attachments ?? [];
          const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
          const terminalContexts = displayedUserMessage.contexts;
          const canRevertAgentWork = typeof row.revertTurnCount === "number";
          return (
            <div className="group flex flex-col items-end">
              <div className="relative max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
                {userImages.length > 0 && (
                  <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
                    {userImages.map(
                      (image: NonNullable<TimelineMessage["attachments"]>[number]) => (
                        <div
                          key={image.id}
                          className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
                        >
                          {image.previewUrl ? (
                            <button
                              type="button"
                              className="h-full w-full cursor-zoom-in"
                              aria-label={`Preview ${image.name}`}
                              onClick={() => {
                                const preview = buildExpandedImagePreview(userImages, image.id);
                                if (!preview) return;
                                ctx.onImageExpand(preview);
                              }}
                            >
                              <img
                                src={image.previewUrl}
                                alt={image.name}
                                className="block h-auto max-h-[220px] w-full object-cover"
                              />
                            </button>
                          ) : (
                            <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/80">
                              {image.name}
                            </div>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                )}
                {(displayedUserMessage.visibleText.trim().length > 0 ||
                  terminalContexts.length > 0) && (
                  <UserMessageBody
                    text={displayedUserMessage.visibleText}
                    terminalContexts={terminalContexts}
                  />
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2 px-1">
                <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                  {displayedUserMessage.copyText && (
                    <MessageCopyButton
                      text={displayedUserMessage.copyText}
                      size="icon-xs"
                      variant="ghost"
                      className="text-muted-foreground/80 hover:text-foreground"
                    />
                  )}
                  {canRevertAgentWork && (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="text-muted-foreground/80 hover:text-foreground"
                      disabled={ctx.isRevertingCheckpoint || ctx.isWorking}
                      onClick={() => ctx.onRevertUserMessage(row.message.id)}
                      title="Revert to this message"
                    >
                      <Undo2Icon className="size-3" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground/80">
                  {formatTimestamp(row.message.createdAt, ctx.timestampFormat)}
                </p>
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        (() => {
          const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
          const assistantTurnStillInProgress =
            ctx.activeTurnInProgress &&
            ctx.activeTurnId !== null &&
            ctx.activeTurnId !== undefined &&
            row.message.turnId === ctx.activeTurnId;
          const assistantCopyState = resolveAssistantMessageCopyState({
            text: row.message.text ?? null,
            showCopyButton: row.showAssistantCopyButton,
            streaming: row.message.streaming || assistantTurnStillInProgress,
          });
          return (
            <>
              {row.showCompletionDivider && (
                <div className="my-3 flex items-center gap-3 animate-in fade-in duration-300">
                  <span className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                    {ctx.completionSummary ? `Response • ${ctx.completionSummary}` : "Response"}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className="min-w-0 px-1 py-0.5">
                <ChatMarkdown
                  text={messageText}
                  cwd={ctx.markdownCwd}
                  isStreaming={Boolean(row.message.streaming)}
                />
                <AssistantChangedFilesSection
                  turnSummary={row.assistantTurnDiffSummary}
                  agentEditedFilesByTurnId={ctx.agentEditedFilesByTurnId}
                  routeThreadKey={ctx.routeThreadKey}
                  resolvedTheme={ctx.resolvedTheme}
                  onOpenTurnDiff={ctx.onOpenTurnDiff}
                />
                <div className="mt-1.5 flex items-center gap-2">
                  {/* During streaming the static WorkingIndicator (outside
                      the virtualizer) already shows elapsed time. Hiding the
                      per-message live timer avoids a self-ticking component
                      inside a virtualized row which causes micro-jitter. */}
                  {!row.message.streaming && (
                    <p className="text-[11px] text-muted-foreground/80 animate-in fade-in duration-300">
                      {formatMessageMeta(
                        row.message.createdAt,
                        formatElapsed(row.durationStart, row.message.completedAt),
                        ctx.timestampFormat,
                      )}
                    </p>
                  )}
                  {assistantCopyState.visible ? (
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200  group-hover/assistant:opacity-100">
                      <MessageCopyButton
                        text={assistantCopyState.text ?? ""}
                        size="icon-xs"
                        variant="ghost"
                        className="text-muted-foreground/80 hover:text-foreground"
                      />
                      {row.message.turnId && (
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          className="text-muted-foreground/80 hover:text-foreground"
                          title="Copy turn JSON"
                          onClick={() => ctx.onCopyTurnJson(row.message.turnId!)}
                        >
                          <LogsIcon className="size-3" />
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          );
        })()}

      {row.kind === "proposed-plan" && (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            environmentId={ctx.activeThreadEnvironmentId}
            cwd={ctx.markdownCwd}
            workspaceRoot={ctx.workspaceRoot}
          />
        </div>
      )}

      {/* Working indicator moved to ListFooterComponent — not a virtualized row */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Extracted row sections — own their state / store subscriptions so changes
// re-render only the affected row, not the entire list.
// ---------------------------------------------------------------------------

/** Owns its own expand/collapse state so toggling re-renders only this row.
 *  State resets on unmount which is fine — work groups start collapsed. */
const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
}) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const [isExpanded, setIsExpanded] = useState(false);

  // Split out active sub-agent entries — they pin at the top.
  const pinnedSubAgents = groupedEntries.filter((e) => e.isSubAgentInProgress);
  const regularEntries = groupedEntries.filter((e) => !e.isSubAgentInProgress);

  const hasOverflow = regularEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleEntries =
    hasOverflow && !isExpanded
      ? regularEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : regularEntries;
  const onlyToolEntries = regularEntries.every((entry) => entry.tone === "tool") && pinnedSubAgents.length === 0;
  const showHeader = hasOverflow || !onlyToolEntries || pinnedSubAgents.length > 0;
  const groupLabel = onlyToolEntries ? "Tool calls" : "Work log";

  return (
    <div className={cn("rounded-lg border border-border/45 bg-card/25", showHeader || pinnedSubAgents.length > 0 ? "px-2 py-1.5" : "px-0.5 py-0.5")}>
      {showHeader && (
        hasOverflow ? (

          <div
            className="group/wl mb-1.5 flex cursor-pointer items-center justify-between gap-2 px-0.5"
            onClick={() => setIsExpanded((v) => !v)}
          >
            <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
              {groupLabel} ({regularEntries.length + pinnedSubAgents.length})
            </p>
            <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/wl:text-foreground">
              {isExpanded ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
            </span>
          </div>
        ) : regularEntries.length > 0 || pinnedSubAgents.length > 0 ? (
          <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
            <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
              {groupLabel} ({regularEntries.length + pinnedSubAgents.length})
            </p>
          </div>
        ) : null
      )}
      {pinnedSubAgents.length > 0 && (
        <div className={cn("space-y-0.5", visibleEntries.length > 0 && "mb-1")}>
          {pinnedSubAgents.map((entry) => (
            <PinnedSubAgentEntry
              key={`pinned-subagent:${entry.id}`}
              workEntry={entry}
              workspaceRoot={workspaceRoot}
            />
          ))}
        </div>
      )}
      {visibleEntries.length > 0 && (
        <div className="space-y-0 [&>*]:py-0.25">
          {visibleEntries.map((workEntry) => (
            <SimpleWorkEntryRow
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              workspaceRoot={workspaceRoot}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/** Pinned sub-agent entry — shown at the top of the work log while in progress. */
const PinnedSubAgentEntry = memo(function PinnedSubAgentEntry({
  workEntry,
  workspaceRoot,
}: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
}) {
  const heading = toolWorkEntryHeading(workEntry);
  const preview = workEntryPreview(workEntry, workspaceRoot);
  const displayText = preview && normalizeCompactToolLabel(preview).toLowerCase() !== normalizeCompactToolLabel(heading).toLowerCase()
    ? preview
    : null;

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 py-1.5">
      <LoaderIcon className="size-3 shrink-0 animate-spin [animation-duration:3s] text-primary/70" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] leading-5 text-foreground/90">
          {heading}
          {displayText && (
            <span className="text-muted-foreground/70"> — {displayText}</span>
          )}
        </p>
      </div>
    </div>
  );
});

const THINKING_EXPAND_CHAR_THRESHOLD = 300;

const ThinkingSection = memo(function ThinkingSection({
  message,
}: {
  message: Extract<MessagesTimelineRow, { kind: "thinking" }>["message"];
}) {
  const { markdownCwd } = use(TimelineRowCtx);
  const [isExpanded, setIsExpanded] = useState(false);
  const collapsedScrollRef = useRef<HTMLDivElement | null>(null);
  const isSubAgent = message.agentKind === "sub";


  useEffect(() => {
    if (isExpanded || !collapsedScrollRef.current) return;
    collapsedScrollRef.current.scrollTop = collapsedScrollRef.current.scrollHeight;
  }, [message.text, isExpanded]);

  if (isSubAgent) {
    const preview =
      message.text
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] italic text-muted-foreground/80">
        <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/80">
          Sub-agent thinking
        </span>
        {preview && <span className="min-w-0 flex-1 truncate">{preview}</span>}
      </div>
    );
  }

  const canExpand = message.text.length > THINKING_EXPAND_CHAR_THRESHOLD;

  return (
    <div className="rounded-lg border border-border/45 bg-card/25 px-2 py-1.5">

        <div
          className={cn("mb-1.5 flex items-center justify-between gap-2 px-0.5", canExpand && "group/think cursor-pointer")}
          onClick={canExpand ? () => setIsExpanded((v) => !v) : undefined}
        >
           {/*0.2em over 0.16 to make up for the THINKING skinnery characters so it looks the same as the others */}
          <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/55">
            Thinking
          </p>
          {canExpand && (
            <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/think:text-foreground">
              {isExpanded ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
            </span>
          )}
        </div>
      <div className="relative">
        <div
          ref={collapsedScrollRef}
          className={cn(
            "px-1.5 text-[12.5px] italic leading-snug text-muted-foreground/80",
            canExpand && !isExpanded && "thinking-collapsed-scroll max-h-28 overflow-y-auto",
          )}
        >
          <ChatMarkdown
            text={message.text}
            cwd={markdownCwd}
            isStreaming={Boolean(message.streaming)}
            className="chat-markdown-thinking text-[12.5px] leading-snug text-muted-foreground/80"
          />
        </div>
        {canExpand && !isExpanded && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-card/80 to-transparent" />
        )}
      </div>
    </div>
  );
});

/** Subscribes directly to the UI state store for expand/collapse state,
 *  so toggling re-renders only this component — not the entire list. */
const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
  agentEditedFilesByTurnId,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary | undefined;
  agentEditedFilesByTurnId: Map<TurnId, Set<string>>;
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  if (!turnSummary) return null;

  // Filter to only files the agent actually edited via Edit/Write tool calls,
  // excluding unrelated changes from the user or other sessions.
  // Git diff paths are repo-relative, tool call paths may be absolute — use endsWith matching.
  const agentTouchedFiles = agentEditedFilesByTurnId.get(turnSummary.turnId);
  const checkpointFiles = agentTouchedFiles
    ? turnSummary.files.filter((f) => {
        for (const agentPath of agentTouchedFiles) {
          if (agentPath === f.path || agentPath.endsWith("/" + f.path)) return true;
        }
        return false;
      })
    : [];
  if (checkpointFiles.length === 0) return null;

  return (
    <AssistantChangedFilesSectionInner
      turnSummary={turnSummary}
      checkpointFiles={checkpointFiles}
      routeThreadKey={routeThreadKey}
      resolvedTheme={resolvedTheme}
      onOpenTurnDiff={onOpenTurnDiff}
    />
  );
});

/** Inner component that only mounts when there are actual changed files,
 *  so the store subscription is unconditional (no hooks after early return). */
function AssistantChangedFilesSectionInner({
  turnSummary,
  checkpointFiles,
  routeThreadKey,
  resolvedTheme,
  onOpenTurnDiff,
}: {
  turnSummary: TurnDiffSummary;
  checkpointFiles: TurnDiffSummary["files"];
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
}) {
  const allDirectoriesExpanded = useUiStateStore(
    (store) => store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.turnId] ?? false,
  );
  const setExpanded = useUiStateStore((store) => store.setThreadChangedFilesExpanded);
  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
  const changedFileCountLabel = String(checkpointFiles.length);
  const hasDirectories = useMemo(
    () => buildTurnDiffTree(checkpointFiles).some((n) => n.kind === "directory"),
    [checkpointFiles],
  );

  return (
    <div className="mt-6 mb-2 rounded-lg border border-border/80 bg-card/45 p-2.5 animate-in fade-in duration-300">
      <div
        className={cn(
          "group/expand mb-1.5 flex items-center justify-between gap-2",
          hasDirectories && "cursor-pointer",
        )}
        data-scroll-anchor-ignore
        onClick={hasDirectories ? () => setExpanded(routeThreadKey, turnSummary.turnId, !allDirectoriesExpanded) : undefined}
      >
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Changed files ({changedFileCountLabel})</span>
          {hasNonZeroStat(summaryStat) && (
            <>
              <span className="mx-1">•</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 transition-colors duration-150 hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path); }}
          >
            View diff
          </button>
          {hasDirectories && (
            <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/expand:text-foreground">
              {allDirectoriesExpanded ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
            </span>
          )}
        </div>
      </div>
      <ChangedFilesTree
        key={`changed-files-tree:${turnSummary.turnId}`}
        turnId={turnSummary.turnId}
        files={checkpointFiles}
        allDirectoriesExpanded={allDirectoriesExpanded}
        resolvedTheme={resolvedTheme}
        onOpenTurnDiff={onOpenTurnDiff}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaf components
// ---------------------------------------------------------------------------

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              {props.text.slice(cursor, matchIndex)}
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              {props.text.slice(cursor)}
            </span>,
          );
        }

        return (
          <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(<span key="user-message-terminal-context-inline-text">{props.text}</span>);
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
      {props.text}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// so LegendList (and React) can skip re-rendering unchanged items.
// ---------------------------------------------------------------------------

/** Returns a structurally-shared copy of `rows`: for each row whose content
 *  hasn't changed since last call, the previous object reference is reused. */
function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------



function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat);
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-foreground/60",
    };
  }
   // thinking = sub agents only in claude
  if (tone === "thinking") {
    return {
      icon: SearchIcon,
      className: "text-foreground/60",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/60",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/60",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/90";
  if (tone === "thinking") return "text-muted-foreground/90";
  return "text-muted-foreground/90";
}

/** Return the first absolute file path from a work entry, if one exists. */
function workEntryPrimaryFilePath(
  workEntry: Pick<TimelineWorkEntry, "changedFiles" | "detail">,
  workspaceRoot: string | undefined,
): string | null {
  // Prefer changedFiles (already extracted absolute paths)
  const first = workEntry.changedFiles?.[0];
  if (first) {
    if (first.startsWith("/") || /^[A-Za-z]:[\\/]/.test(first)) return first;
    if (workspaceRoot) return `${workspaceRoot}/${first}`;
  }
  // Fall back to detail — Read/Edit entries store the file path there.
  // Only trust it when it's already an absolute path; detail is arbitrary
  // text (could be a bash command, a description, etc.) so no guessing.
  const detail = workEntry.detail?.trim();
  if (detail?.startsWith("/") || /^[A-Za-z]:[\\/]/.test(detail ?? "")) {
    // Normalise range suffixes produced by tool summaries (e.g. path:0-100 or
    // path:50+) into the standard path:line format that editors understand.
    const rangeMatch = detail!.match(/:(\d+)[-+](\d*)$/);
    if (rangeMatch?.[1]) {
      const path = detail!.slice(0, -(rangeMatch[0].length));
      const startLine = rangeMatch[1];
      return `${path}:${startLine}`;
    }
    const { path, line } = splitPathAndPosition(detail!);
    return line ? `${path}:${line}` : path;
  }
  return null;
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SearchIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SearchIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return SearchIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
}) {
  const { workEntry, workspaceRoot } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const rawPreview = workEntryPreview(workEntry, workspaceRoot);
  const preview =
    rawPreview &&
    normalizeCompactToolLabel(rawPreview).toLowerCase() ===
      normalizeCompactToolLabel(heading).toLowerCase()
      ? null
      : rawPreview;
  const rawCommand = workEntryRawCommand(workEntry);
  const displayText = preview ? `${heading} - ${preview}` : heading;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;
  const primaryFilePath = workEntryPrimaryFilePath(workEntry, workspaceRoot);
  const primaryFileDisplayPath = primaryFilePath
    ? formatWorkspaceRelativePath(workEntry.detail?.trim() ?? primaryFilePath, workspaceRoot)
    : null;
  const isCompactionEntry = workEntry.isCompacting || workEntry.label === "Context compacted";

  const handleOpenInEditor = useCallback(() => {
    if (!primaryFilePath) return;
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, primaryFilePath);
  }, [primaryFilePath]);

  return (
    <div
      className={cn("rounded-lg px-0.25 py-1", primaryFilePath && "group/file cursor-pointer")}
      onClick={primaryFilePath ? handleOpenInEditor : undefined}
    >
      <div className="flex items-center gap-1 transition-[opacity,translate] duration-200">
        <span
          className={cn("flex size-5 shrink-0 items-center justify-center", iconConfig.className)}
        >
          {isCompactionEntry ? (
            workEntry.isCompacting ? (
              <LoaderIcon className="size-3 animate-spin [animation-duration:3s]" />
            ) : (
              <CircleSmallIcon className="size-3" />
            )
          ) : (
            <EntryIcon className="size-3" />
          )}
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          {rawCommand ? (
            <div className="max-w-full">
              <p
                className={cn(
                  "truncate text-xs leading-5",
                  workToneClass(workEntry.tone),
                  preview ? "text-muted-foreground/80" : "",
                )}
                title={displayText}
              >
                <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                  {heading}
                </span>
                {preview && (
                  <Tooltip>
                    <TooltipTrigger
                      closeDelay={0}
                      delay={75}
                      render={
                        <span className="max-w-full cursor-default text-muted-foreground/85">
                          {" "}- <span className="font-mono text-[10px]">{preview}</span>
                        </span>
                      }
                    />
                    <TooltipPopup
                      align="start"
                      className="max-w-[min(56rem,calc(100vw-2rem))] px-0 py-0"
                      side="top"
                    >
                      <div className="max-w-[min(56rem,calc(100vw-2rem))] overflow-x-auto px-1.5 py-1 font-mono text-[11px] leading-4 whitespace-nowrap">
                        {rawCommand}
                      </div>
                    </TooltipPopup>
                  </Tooltip>
                )}
              </p>
            </div>
          ) : primaryFilePath ? (
            <p
              className={cn(
                "truncate text-[11px] leading-5",
                workToneClass(workEntry.tone),
              )}
            >
              <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                {heading}
              </span>
              <span className="text-muted-foreground/85">
                {" "}- <span className="transition-colors duration-150 group-hover/file:text-foreground/70">{primaryFileDisplayPath}</span>
              </span>
            </p>
          ) : (
            <Tooltip>
              <TooltipTrigger
                className="block min-w-0 w-full text-left"
                title={displayText}
                aria-label={displayText}
              >
                <p
                  className={cn(
                    "truncate text-[11px] leading-5",
                    workToneClass(workEntry.tone),
                    preview ? "text-muted-foreground/80" : "",
                  )}
                >
                  <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                    {heading}
                  </span>
                  {preview && (
                    <span className="text-muted-foreground/85">
                      {" "}- {preview}
                    </span>
                  )}
                </p>
              </TooltipTrigger>
              <TooltipPopup className="max-w-[min(720px,calc(100vw-2rem))]">
                <p className="whitespace-pre-wrap wrap-break-word text-xs leading-5">
                  {displayText}
                </p>
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
      </div>
      {hasChangedFiles && !previewIsChangedFiles && (() => {
        const filteredFiles = primaryFilePath
          ? workEntry.changedFiles?.filter((fp) => fp !== primaryFilePath && !primaryFilePath.endsWith("/" + fp))
          : workEntry.changedFiles;
        const totalFiltered = filteredFiles?.length ?? 0;
        if (totalFiltered === 0) return null;
        return (
          <div className="mt-1 flex flex-wrap gap-1 pl-6">
            {filteredFiles?.slice(0, 4).map((filePath) => {
              const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
              return (
                <span
                  key={`${workEntry.id}:${filePath}`}
                  className="rounded-md bg-background/75 px-0.5 py-0.75 font-mono text-[10.5px] text-muted-foreground/85"
                  title={displayPath}
                >
                  {displayPath}
                </span>
              );
            })}
            {totalFiltered > 4 && (
              <span className="px-1 text-[10px] text-muted-foreground/80">
                +{totalFiltered - 4}
              </span>
            )}
          </div>
        );
      })()}
    </div>
  );
});
