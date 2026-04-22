/**
 * Shared context definitions and helpers for messages-timeline components.
 *
 * Extracted so sub-components in their own files can import the contexts
 * without circular dependencies back to the main MessagesTimeline module.
 */

import { createContext, useMemo, useRef } from "react";
import type { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { ExpandedImagePreview } from "../ExpandedImagePreview";
import type { WorkLogEntry } from "../../../session-logic/index";

import {
  computeStableMessagesTimelineRows,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
} from "../MessagesTimeline.logic";

// ---------------------------------------------------------------------------
// Derived type aliases — avoids re-deriving in each component file
// ---------------------------------------------------------------------------

export type TimelineWorkEntry = WorkLogEntry;
export type TimelineRow = MessagesTimelineRow;

// ---------------------------------------------------------------------------
// Context — shared state consumed by every row component via useContext.
// ---------------------------------------------------------------------------

export interface TimelineRowSharedState {
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

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);

/** All work log entries for the current timeline — used by the sub-agent
 *  detail dialog to filter task.progress entries by taskId. Separate context
 *  so changes don't invalidate every timeline row. */
export const WorkLogEntriesCtx = createContext<ReadonlyArray<WorkLogEntry>>([]);

/** Separate context for search query — avoids invalidating the main shared
 *  state on every keystroke. Only components that check for hidden matches
 *  (collapsible sections) subscribe to this. */
export const SearchQueryCtx = createContext<string>("");

// ---------------------------------------------------------------------------
// Search match helpers
// ---------------------------------------------------------------------------

/**
 * Check if any text matches for `query` exist outside the visible bounds of
 * a clipped container (overflow: hidden/auto with a max-height).
 *
 * Returns true when at least one match is fully outside the container's
 * visible rect — i.e. it's in the hidden/overflowed portion.
 */
export function hasMatchOutsideVisibleBounds(
  container: HTMLElement | null,
  query: string,
): boolean {
  if (!container || !query) return false;
  const lowerQuery = query.toLowerCase();
  const containerRect = container.getBoundingClientRect();

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent;
    if (!text) continue;
    const lowerText = text.toLowerCase();
    let startPos = 0;
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, startPos);
      if (idx === -1) break;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + lowerQuery.length);
      const rangeRect = range.getBoundingClientRect();
      // Match is hidden if its bottom is above container top or its top is below container bottom.
      if (rangeRect.bottom <= containerRect.top || rangeRect.top >= containerRect.bottom) {
        return true;
      }
      startPos = idx + lowerQuery.length;
    }
  }
  return false;
}

/** Small coloured dot indicating hidden search matches inside a collapsed section. */
export { SearchMatchDot } from "./SearchMatchDot";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat);
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

import { formatTimestamp } from "../../../timestampFormat";

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// so LegendList (and React) can skip re-rendering unchanged items.
// ---------------------------------------------------------------------------

/** Returns a structurally-shared copy of `rows`: for each row whose content
 *  hasn't changed since last call, the previous object reference is reused. */
export function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
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
