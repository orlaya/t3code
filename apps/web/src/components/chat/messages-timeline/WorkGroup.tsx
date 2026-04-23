import { memo, use, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { InlineEditDiff } from "../InlineEditDiff";
import { MAX_VISIBLE_WORK_LOG_ENTRIES, type MessagesTimelineRow } from "../MessagesTimeline.logic";
import { TimelineRowCtx } from "./shared";
import { CompactionEntry } from "./CompactionEntry";
import { SimpleWorkEntryRow } from "./SimpleWorkEntryRow";
import { PinnedSubAgentEntry, SubAgentDetailDialog } from "./SubAgentEntry";

/** Owns its own expand/collapse state so toggling re-renders only this row.
 *  State resets on unmount which is fine — work groups start collapsed. */
export const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
}) {
  const { workspaceRoot, resolvedTheme } = use(TimelineRowCtx);
  const [isExpanded, setIsExpanded] = useState(false);

  // Standalone file_change entry (Edit/Write) — renders the work entry label
  // with an inline diff below it, never grouped with other tools.
  if (groupedEntries.length === 1 && groupedEntries[0]?.itemType === "file_change") {
    const entry = groupedEntries[0];
    return (
      <div className="rounded-lg border border-border/45 bg-card/25 overflow-hidden">
        <div className="px-0.5">
          <SimpleWorkEntryRow workEntry={entry} workspaceRoot={workspaceRoot} />
        </div>
        {entry.editDiffs?.map((diff) => (
          <InlineEditDiff
            key={diff.id}
            editEntry={diff}
            workspaceRoot={workspaceRoot}
            resolvedTheme={resolvedTheme}
            variant="flush"
            hideHeader
          />
        ))}
      </div>
    );
  }

  // Split out sub-agent entries — they always pin at the top regardless of status.
  const pinnedSubAgents = groupedEntries.filter((e) => e.itemType === "collab_agent_tool_call");
  const regularEntries = groupedEntries.filter((e) => e.itemType !== "collab_agent_tool_call");

  // Lifted dialog state — one dialog navigates across all pinned sub-agents in the group.
  const [selectedSubAgentIdx, setSelectedSubAgentIdx] = useState<number | null>(null);

  const isCompactionOnly =
    regularEntries.length === 1 &&
    pinnedSubAgents.length === 0 &&
    (regularEntries[0]?.isCompacting || regularEntries[0]?.isCompacted);

  const hasOverflow = regularEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleEntries =
    hasOverflow && !isExpanded
      ? regularEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : regularEntries;
  const onlyToolEntries =
    regularEntries.every((entry) => entry.tone === "tool") && pinnedSubAgents.length === 0;
  const isSingleEntry = regularEntries.length <= 1 && pinnedSubAgents.length === 0;
  const showHeader =
    !isSingleEntry && (hasOverflow || !onlyToolEntries || pinnedSubAgents.length > 0);
  const groupLabel = onlyToolEntries ? "Tool calls" : "Work log";

  return (
    <div
      className={cn(
        isCompactionOnly
          ? "rounded-md"
          : cn(
              "rounded-lg border border-border/45 bg-card/25",
              showHeader || pinnedSubAgents.length > 0 ? "px-2 py-1.5" : "px-0.5 py-0.5",
            ),
      )}
    >
      {showHeader &&
        (hasOverflow ? (
          <div
            className="group/wl mb-1.5 flex cursor-pointer items-center justify-between gap-2 px-0.5"
            onClick={() => setIsExpanded((v) => !v)}
          >
            <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
              {groupLabel} ({regularEntries.length + pinnedSubAgents.length})
            </p>
            <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/wl:text-foreground">
              {isExpanded ? (
                <ChevronUpIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
            </span>
          </div>
        ) : regularEntries.length > 0 || pinnedSubAgents.length > 0 ? (
          <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
            <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
              {groupLabel} ({regularEntries.length + pinnedSubAgents.length})
            </p>
          </div>
        ) : null)}
      {pinnedSubAgents.length > 0 && (
        <div className={cn("space-y-0.5", visibleEntries.length > 0 && "mb-1")}>
          {pinnedSubAgents.map((entry, idx) => (
            <PinnedSubAgentEntry
              key={`pinned-subagent:${entry.id}`}
              workEntry={entry}
              workspaceRoot={workspaceRoot}
              onOpen={() => setSelectedSubAgentIdx(idx)}
            />
          ))}
          {selectedSubAgentIdx != null && pinnedSubAgents[selectedSubAgentIdx]?.subAgentBrief && (
            <SubAgentDetailDialog
              open
              onOpenChange={(v) => {
                if (!v) setSelectedSubAgentIdx(null);
              }}
              workEntry={pinnedSubAgents[selectedSubAgentIdx]!}
              allEntries={groupedEntries}
              workspaceRoot={workspaceRoot}
              siblingSubAgents={pinnedSubAgents}
              siblingIndex={selectedSubAgentIdx}
              onNavigate={setSelectedSubAgentIdx}
            />
          )}
        </div>
      )}
      {visibleEntries.length > 0 && (
        <div className="space-y-0 [&>*]:py-0.25">
          {visibleEntries.map((workEntry) =>
            workEntry.isCompacting || workEntry.isCompacted ? (
              <CompactionEntry key={`work-row:${workEntry.id}`} workEntry={workEntry} />
            ) : (
              <SimpleWorkEntryRow
                key={`work-row:${workEntry.id}`}
                workEntry={workEntry}
                workspaceRoot={workspaceRoot}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
});
