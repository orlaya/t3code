import {
  type EnvironmentId,
  type MessageId,
  type ServerProviderSkill,
  type TurnId,
} from "@t3tools/contracts";

import { memo, use, useCallback, useEffect, useMemo, useRef } from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic/index";
import { type TurnDiffSummary } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { LogsIcon, Undo2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  deriveMessagesTimelineRows,
  resolveAssistantMessageCopyState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";

import { AssistantChangedFilesSection } from "./messages-timeline/ChangedFiles";
import { ThinkingSection } from "./messages-timeline/ThinkingSection";
import { StandaloneEditRow } from "./messages-timeline/StandaloneEditRow";
import { WorkGroupSection } from "./messages-timeline/WorkGroup";
import { AssembledEditRow, AssembledWriteRow } from "./messages-timeline/AssembledEditRow";
import { AssembledWorkGroup } from "./messages-timeline/AssembledWorkGroup";
import { deriveDisplayedUserMessageState } from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";
import { SearchOverlay } from "../SearchOverlay";
import { useTimelineSearch } from "../../hooks/useTimelineSearch";

// Context — shared state consumed by every row component via useContext.
// Definitions live in messages-timeline/shared.ts so extracted sub-components
// can import them without circular deps.

import {
  TimelineRowCtx,
  SearchQueryCtx,
  WorkLogEntriesCtx,
  formatMessageMeta,
  type TimelineRowSharedState,
  useStableRows,
} from "./messages-timeline/shared";
import {
  CollapsibleUserMessageContent,
  parseSlashCommandText,
  UserMessageBody,
} from "~/components/chat/messages-timeline/UserMessage";

const EMPTY_TIMELINE_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];

// Props (public API)

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
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  onIsAtEndChange: (isAtEnd: boolean) => void;
  searchOpen: boolean;
  onSearchClose: () => void;
}

// MessagesTimeline — list owner

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
  skills = EMPTY_TIMELINE_SKILLS,
  onIsAtEndChange,
  searchOpen,
  onSearchClose,
}: MessagesTimelineProps) {
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        completionDividerBeforeEntryId,
        isWorking,
        activeTurnInProgress,
        activeTurnId: activeTurnId ?? null,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      completionDividerBeforeEntryId,
      isWorking,
      activeTurnInProgress,
      activeTurnId,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const rows = useStableRows(rawRows);

  // All work log entries from the timeline — provided via context for the
  // sub-agent detail dialog to filter task.progress entries by taskId.
  const allWorkLogEntries = useMemo(
    () => timelineEntries.flatMap((e) => (e.kind === "work" ? [e.entry] : [])),
    [timelineEntries],
  );

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
      skills,
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
      skills,
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
      case "assembled-tool":
      case "assembled-tool-group":
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

  //
  //
  // Search
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const timelineSearch = useTimelineSearch(rows, listRef, searchContainerRef);

  const handleSearchQuery = useCallback(
    (query: string) => {
      timelineSearch.search(query);
    },
    [timelineSearch],
  );

  const handleSearchClose = useCallback(() => {
    timelineSearch.clear();
    onSearchClose();
  }, [timelineSearch, onSearchClose]);

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
      <WorkLogEntriesCtx.Provider value={allWorkLogEntries}>
        <SearchQueryCtx.Provider value={timelineSearch.state.query}>
          <SearchOverlay
            open={searchOpen}
            onClose={handleSearchClose}
            matchCount={timelineSearch.state.matches.length}
            currentMatch={timelineSearch.state.currentIndex}
            onSearch={handleSearchQuery}
            onNext={timelineSearch.next}
            onPrev={timelineSearch.prev}
          />
          <div ref={searchContainerRef} className="h-full">
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
          </div>
        </SearchQueryCtx.Provider>
      </WorkLogEntriesCtx.Provider>
    </TimelineRowCtx.Provider>
  );
});

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

//
//
//
// TimelineRowContent — the actual row component
type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
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

      {row.kind === "assembled-tool" && row.tool.kind === "edit" && (
        <AssembledEditRow
          tool={row.tool}
          workspaceRoot={ctx.workspaceRoot}
          resolvedTheme={ctx.resolvedTheme}
        />
      )}

      {row.kind === "assembled-tool" && row.tool.kind === "write" && (
        <AssembledWriteRow
          tool={row.tool}
          workspaceRoot={ctx.workspaceRoot}
          resolvedTheme={ctx.resolvedTheme}
        />
      )}

      {row.kind === "assembled-tool-group" && (
        <AssembledWorkGroup tools={row.tools} workEntries={row.workEntries} />
      )}

      {row.kind === "edit" && (
        <StandaloneEditRow
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
          const slashCommandMatch = parseSlashCommandText(displayedUserMessage.visibleText);
          return (
            <div className="group flex flex-col items-end">
              <div
                className={cn(
                  "relative max-w-[80%] rounded-2xl rounded-br-sm border px-4 pt-3 pb-1",
                  slashCommandMatch
                    ? "border-primary/20 bg-primary/5"
                    : "border-border bg-secondary",
                )}
              >
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
                <CollapsibleUserMessageContent>
                  {(displayedUserMessage.visibleText.trim().length > 0 ||
                    terminalContexts.length > 0) && (
                    <UserMessageBody
                      text={displayedUserMessage.visibleText}
                      terminalContexts={terminalContexts}
                      slashCommandMatch={slashCommandMatch}
                      skills={ctx.skills}
                    />
                  )}
                </CollapsibleUserMessageContent>
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
                  skills={ctx.skills}
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
                <AssistantChangedFilesSection
                  turnSummary={row.assistantTurnDiffSummary}
                  agentEditedFilesByTurnId={ctx.agentEditedFilesByTurnId}
                  routeThreadKey={ctx.routeThreadKey}
                  resolvedTheme={ctx.resolvedTheme}
                  onOpenTurnDiff={ctx.onOpenTurnDiff}
                />
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
