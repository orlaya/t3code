import { memo, use, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { AssembledSubAgent, AssembledToolInvocation } from "@t3tools/contracts";
import type { WorkLogEntry } from "../../../session-logic/index";
import { MAX_VISIBLE_WORK_LOG_ENTRIES } from "../MessagesTimeline.logic";
import { TimelineRowCtx } from "./shared";
import { AssembledCommandRow } from "./AssembledCommandRow";
import { AssembledFileReadRow } from "./AssembledFileReadRow";
import { AssembledFileSearchRow } from "./AssembledFileSearchRow";
import { AssembledWebSearchRow } from "./AssembledWebSearchRow";
import { AssembledWebFetchRow } from "./AssembledWebFetchRow";
import {
  AssembledPinnedSubAgentEntry,
  AssembledSubAgentDetailDialog,
} from "./AssembledSubAgentRow";
import { AssembledToolCallRow } from "./AssembledToolCallRow";
import { SimpleWorkEntryRow } from "./SimpleWorkEntryRow";

function AssembledToolRow({
  tool,
  workspaceRoot,
  suppressAlertBg,
}: {
  tool: AssembledToolInvocation;
  workspaceRoot: string | undefined;
  suppressAlertBg?: boolean;
}) {
  switch (tool.kind) {
    case "command":
      return (
        <AssembledCommandRow
          tool={tool}
          workspaceRoot={workspaceRoot}
          {...(suppressAlertBg && { suppressAlertBg })}
        />
      );
    case "file-read":
      return <AssembledFileReadRow tool={tool} workspaceRoot={workspaceRoot} />;
    case "file-search":
      return <AssembledFileSearchRow tool={tool} workspaceRoot={workspaceRoot} />;
    case "web-search":
      return <AssembledWebSearchRow tool={tool} />;
    case "web-fetch":
      return <AssembledWebFetchRow tool={tool} />;
    case "tool-call":
    case "mcp-tool":
      return <AssembledToolCallRow tool={tool} />;
    default:
      return null;
  }
}

/** Unified work group — renders assembled tools and old-path work entries in
 *  one card. Same visual chrome as old WorkGroupSection: header with label +
 *  count, collapse at >4 entries, chevron toggle.
 *  Sub-agents are pinned to the top. */
export const AssembledWorkGroup = memo(function AssembledWorkGroup({
  tools,
  workEntries = [],
}: {
  tools: ReadonlyArray<AssembledToolInvocation>;
  workEntries?: ReadonlyArray<WorkLogEntry>;
}) {
  const { workspaceRoot } = use(TimelineRowCtx);
  const [isExpanded, setIsExpanded] = useState(false);

  // Split out sub-agents — they always pin at the top regardless of status.
  const pinnedSubAgents = tools.filter((t): t is AssembledSubAgent => t.kind === "sub-agent");
  const regularTools = tools.filter((t) => t.kind !== "sub-agent");

  // Lifted dialog state — one dialog navigates across all pinned sub-agents.
  const [selectedSubAgentIdx, setSelectedSubAgentIdx] = useState<number | null>(null);

  const totalRegular = regularTools.length + workEntries.length;
  const totalAll = totalRegular + pinnedSubAgents.length;
  const hasOverflow = totalRegular > MAX_VISIBLE_WORK_LOG_ENTRIES;

  // Build a unified list of regular items (tools + work entries) sorted by
  // createdAt so they interleave in the correct chronological order.
  const regularItems: Array<
    { type: "tool"; tool: AssembledToolInvocation } | { type: "work"; entry: WorkLogEntry }
  > = [
    ...regularTools.map((tool) => ({ type: "tool" as const, tool })),
    ...workEntries.map((entry) => ({ type: "work" as const, entry })),
  ].toSorted((a, b) => {
    const aTime = a.type === "tool" ? a.tool.createdAt : a.entry.createdAt;
    const bTime = b.type === "tool" ? b.tool.createdAt : b.entry.createdAt;
    return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
  });

  const visibleItems =
    hasOverflow && !isExpanded ? regularItems.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES) : regularItems;
  const isSingleEntry = totalRegular <= 1 && pinnedSubAgents.length === 0;
  const showHeader = !isSingleEntry && (hasOverflow || pinnedSubAgents.length > 0);
  const groupLabel = "Work log";

  // Single errored/interrupted tool → tint the card itself instead of nesting a bg inside it.
  const singleTool = isSingleEntry ? regularTools[0] : undefined;
  const singleAlert = !!(
    singleTool &&
    (singleTool.state === "failed" || singleTool.state === "interrupted")
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-border/45",
        singleAlert ? "bg-destructive/5" : "bg-card/25",
        showHeader || pinnedSubAgents.length > 0 ? "px-2 py-1.5" : "px-0.5 py-0.5",
      )}
    >
      {showHeader && (
        <div
          className={cn(
            "mb-1.5 flex items-center justify-between gap-2 px-0.5",
            hasOverflow && "group/wl cursor-pointer",
          )}
          onClick={hasOverflow ? () => setIsExpanded((v) => !v) : undefined}
        >
          <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
            {groupLabel} ({totalAll})
          </p>
          {hasOverflow && (
            <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/wl:text-foreground">
              {isExpanded ? (
                <ChevronUpIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
            </span>
          )}
        </div>
      )}
      {pinnedSubAgents.length > 0 && (
        <div className={cn("space-y-0.5", visibleItems.length > 0 && "mb-1")}>
          {pinnedSubAgents.map((sa, idx) => (
            <AssembledPinnedSubAgentEntry
              key={`pinned-subagent:${sa.id}`}
              tool={sa}
              onOpen={() => setSelectedSubAgentIdx(idx)}
            />
          ))}
          {selectedSubAgentIdx != null && pinnedSubAgents[selectedSubAgentIdx] && (
            <AssembledSubAgentDetailDialog
              open
              onOpenChange={(v) => {
                if (!v) setSelectedSubAgentIdx(null);
              }}
              tool={pinnedSubAgents[selectedSubAgentIdx]!}
              siblingSubAgents={pinnedSubAgents}
              siblingIndex={selectedSubAgentIdx}
              onNavigate={setSelectedSubAgentIdx}
            />
          )}
        </div>
      )}
      {visibleItems.length > 0 && (
        <div className="space-y-0 [&>*]:py-0.25">
          {visibleItems.map((item) =>
            item.type === "tool" ? (
              <AssembledToolRow
                key={item.tool.id}
                tool={item.tool}
                workspaceRoot={workspaceRoot}
                suppressAlertBg={singleAlert}
              />
            ) : (
              <SimpleWorkEntryRow
                key={item.entry.id}
                workEntry={item.entry}
                workspaceRoot={workspaceRoot}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
});
