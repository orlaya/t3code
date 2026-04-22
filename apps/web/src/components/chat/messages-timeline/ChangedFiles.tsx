// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Extracted row sections — own their state / store subscriptions so changes
// re-render only the affected row, not the entire list.
// ---------------------------------------------------------------------------

import { TurnId } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { ChangedFilesTree } from "~/components/chat/ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "~/components/chat/DiffStatLabel";
import { buildTurnDiffTree, summarizeTurnDiffStats } from "~/lib/turnDiffTree";
import { cn } from "~/lib/utils";
import { TurnDiffSummary } from "~/types";
import { useUiStateStore } from "~/uiStateStore";

/** Subscribes directly to the UI state store for expand/collapse state,
 *  so toggling re-renders only this component — not the entire list. */
export const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
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
        onClick={
          hasDirectories
            ? () => setExpanded(routeThreadKey, turnSummary.turnId, !allDirectoriesExpanded)
            : undefined
        }
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
            onClick={(e) => {
              e.stopPropagation();
              onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path);
            }}
          >
            View diff
          </button>
          {hasDirectories && (
            <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/expand:text-foreground">
              {allDirectoriesExpanded ? (
                <ChevronUpIcon className="size-3.5" />
              ) : (
                <ChevronDownIcon className="size-3.5" />
              )}
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
