import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import { type MessagesTimelineRow } from "../components/chat/MessagesTimeline.logic";

export interface TimelineSearchMatch {
  /** Index into the rows array. */
  rowIndex: number;
  /** The row id — used for DOM-based highlighting. */
  rowId: string;
  /** Which occurrence of the query within this row (0-based). */
  occurrenceInRow: number;
}

export interface TimelineSearchState {
  query: string;
  matches: TimelineSearchMatch[];
  currentIndex: number;
}

const EMPTY_STATE: TimelineSearchState = {
  query: "",
  matches: [],
  currentIndex: -1,
};

/**
 * Extracts searchable plain text from a timeline row.
 * Returns null for row kinds that have no user-visible text content.
 */
function rowSearchableText(row: MessagesTimelineRow): string | null {
  switch (row.kind) {
    case "message":
      return row.message.text ?? null;
    case "thinking":
      return row.message.text ?? null;
    case "proposed-plan":
      return row.proposedPlan.planMarkdown ?? null;
    default:
      return null;
  }
}

/**
 * Search through timeline rows, returning one match per occurrence of `query`
 * within each row's text. A single row with 3 occurrences produces 3 matches.
 */
function findMatches(rows: MessagesTimelineRow[], query: string): TimelineSearchMatch[] {
  if (query.length === 0) return [];
  const lowerQuery = query.toLowerCase();
  const matches: TimelineSearchMatch[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const text = rowSearchableText(row);
    if (!text) continue;
    const lowerText = text.toLowerCase();
    let startPos = 0;
    let occurrence = 0;
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, startPos);
      if (idx === -1) break;
      matches.push({ rowIndex: i, rowId: row.id, occurrenceInRow: occurrence });
      occurrence++;
      startPos = idx + lowerQuery.length;
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// CSS Custom Highlight API helpers
// ---------------------------------------------------------------------------

const HIGHLIGHT_NAME = "search-match";
const HIGHLIGHT_ACTIVE_NAME = "search-match-active";

/**
 * Walk all text nodes under `root` and collect Ranges that match `query`
 * (case-insensitive). Returns an array of { range, rowId, occurrenceInRow }
 * so we can pinpoint exactly which occurrence is the active one.
 */
function findTextRanges(
  root: Element,
  query: string,
): { range: Range; rowId: string | null; occurrenceInRow: number }[] {
  if (query.length === 0) return [];
  const lowerQuery = query.toLowerCase();
  const results: { range: Range; rowId: string | null; occurrenceInRow: number }[] = [];

  // Track per-row occurrence counts so each range knows its index within its row.
  const rowOccurrenceCounts = new Map<string | null, number>();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
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
      range.setEnd(node, idx + query.length);
      // Walk up to find the row id from data-timeline-row-id
      const rowEl = node.parentElement?.closest("[data-timeline-row-id]");
      const rowId = rowEl?.getAttribute("data-timeline-row-id") ?? null;
      const occurrenceInRow = rowOccurrenceCounts.get(rowId) ?? 0;
      rowOccurrenceCounts.set(rowId, occurrenceInRow + 1);
      results.push({ range, rowId, occurrenceInRow });
      startPos = idx + query.length;
    }
  }

  return results;
}

/**
 * Apply CSS Custom Highlights for all matches in the given container.
 * Only the single occurrence identified by `activeRowId` + `activeOccurrenceInRow`
 * gets the "active" highlight — everything else gets the normal highlight.
 */
function applyHighlights(
  container: Element | null,
  query: string,
  activeRowId: string | null,
  activeOccurrenceInRow: number,
) {
  // Clear existing highlights first.
  CSS.highlights?.delete(HIGHLIGHT_NAME);
  CSS.highlights?.delete(HIGHLIGHT_ACTIVE_NAME);

  if (!container || !query || !CSS.highlights) return;

  const textRanges = findTextRanges(container, query);
  if (textRanges.length === 0) return;

  const matchRanges: Range[] = [];
  const activeRanges: Range[] = [];

  for (const { range, rowId, occurrenceInRow } of textRanges) {
    if (rowId === activeRowId && occurrenceInRow === activeOccurrenceInRow) {
      activeRanges.push(range);
    } else {
      matchRanges.push(range);
    }
  }

  if (matchRanges.length > 0) {
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...matchRanges));
  }
  if (activeRanges.length > 0) {
    CSS.highlights.set(HIGHLIGHT_ACTIVE_NAME, new Highlight(...activeRanges));
  }
}

function clearHighlights() {
  CSS.highlights?.delete(HIGHLIGHT_NAME);
  CSS.highlights?.delete(HIGHLIGHT_ACTIVE_NAME);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTimelineSearch(
  rows: MessagesTimelineRow[],
  listRef: React.RefObject<LegendListRef | null>,
  /** The scrollable container element that holds the LegendList rows. */
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [state, setState] = useState<TimelineSearchState>(EMPTY_STATE);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const scrollToMatch = useCallback(
    (matches: TimelineSearchMatch[], index: number) => {
      const match = matches[index];
      if (!match) return;
      void listRef.current?.scrollToIndex({
        index: match.rowIndex,
        animated: true,
        viewPosition: 0.35,
      });
    },
    [listRef],
  );

  const search = useCallback(
    (query: string) => {
      if (query.length === 0) {
        setState(EMPTY_STATE);
        return;
      }
      const matches = findMatches(rowsRef.current, query);
      const currentIndex = matches.length > 0 ? 0 : -1;
      setState({ query, matches, currentIndex });
      if (currentIndex >= 0) {
        scrollToMatch(matches, currentIndex);
      }
    },
    [scrollToMatch],
  );

  const next = useCallback(() => {
    setState((prev) => {
      if (prev.matches.length === 0) return prev;
      const nextIndex = (prev.currentIndex + 1) % prev.matches.length;
      scrollToMatch(prev.matches, nextIndex);
      return { ...prev, currentIndex: nextIndex };
    });
  }, [scrollToMatch]);

  const prev = useCallback(() => {
    setState((prev) => {
      if (prev.matches.length === 0) return prev;
      const prevIndex = (prev.currentIndex - 1 + prev.matches.length) % prev.matches.length;
      scrollToMatch(prev.matches, prevIndex);
      return { ...prev, currentIndex: prevIndex };
    });
  }, [scrollToMatch]);

  const clear = useCallback(() => {
    clearHighlights();
    setState(EMPTY_STATE);
  }, []);

  // Apply DOM highlights whenever the search state changes or after scroll
  // settles (which may virtualise new rows into the DOM).
  useEffect(() => {
    if (!state.query) {
      clearHighlights();
      return;
    }

    const activeMatch = state.matches[state.currentIndex];
    const activeRowId = activeMatch?.rowId ?? null;
    const activeOccurrence = activeMatch?.occurrenceInRow ?? -1;

    // Small delay so the virtualizer has time to render the scrolled-to row.
    const timer = setTimeout(() => {
      applyHighlights(containerRef.current, state.query, activeRowId, activeOccurrence);
    }, 80);

    return () => clearTimeout(timer);
  }, [state.query, state.currentIndex, state.matches, containerRef]);

  // Also re-apply highlights on scroll (rows entering/leaving the DOM).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !state.query) return;

    const activeMatch = state.matches[state.currentIndex];
    const activeRowId = activeMatch?.rowId ?? null;
    const activeOccurrence = activeMatch?.occurrenceInRow ?? -1;

    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        applyHighlights(container, state.query, activeRowId, activeOccurrence);
        rafId = null;
      });
    };

    // The LegendList's scroll container is the container itself.
    container.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      container.removeEventListener("scroll", onScroll, { capture: true });
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [state.query, state.currentIndex, state.matches, containerRef]);

  // Clean up highlights on unmount.
  useEffect(() => clearHighlights, []);

  return useMemo(
    () => ({
      state,
      search,
      next,
      prev,
      clear,
    }),
    [state, search, next, prev, clear],
  );
}
