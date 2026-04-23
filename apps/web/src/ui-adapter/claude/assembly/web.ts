/**
 * Web-related tool grouping and assembly:
 *   - Web search — own itemType ("web_search"), WITH startedQueue
 *   - Web fetch — dynamic_tool_call, NO startedQueue
 */

import type {
  OrchestrationThreadActivity,
  AssembledWebSearch,
  AssembledWebFetch,
} from "@t3tools/contracts";

import { extractClaudeToolData } from "../extraction";
import {
  extractItemType,
  extractToolName,
  extractQuery,
  extractUrl,
  extractResultContent,
} from "./shared";

// =========================================================================
// Web search
// =========================================================================

/**
 * WebSearch has its own itemType ("web_search") so tool.started is identifiable
 * — we CAN use a startedQueue here, unlike Read/Grep/Glob/WebFetch.
 */
interface WebSearchInvocation {
  /** Grouping key — query string from input. */
  query: string | undefined;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

export function finalizeWebSearch(inv: WebSearchInvocation): AssembledWebSearch | null {
  let bestCanonical = null;
  let bestKind: string | null = null;
  let firstId: string | null = null;
  let firstCreatedAt: string | null = null;

  for (const activity of inv.activities) {
    if (!firstId) {
      firstId = activity.id;
      firstCreatedAt = activity.createdAt;
    }
    const canonical = extractClaudeToolData(activity.payload);
    if (!canonical) continue;

    if (
      !bestCanonical ||
      activity.kind === "tool.completed" ||
      (activity.kind === "tool.updated" && bestKind === "tool.started")
    ) {
      bestCanonical = canonical;
      bestKind = activity.kind;
    }
  }

  if (!firstId || !firstCreatedAt) return null;

  // tool.started only — no data yet, emit a "starting" placeholder
  if (!bestCanonical) {
    return {
      kind: "web-search",
      id: firstId,
      createdAt: firstCreatedAt,
      state: "starting",
      heading: "Search",
    };
  }

  const state =
    bestKind === "tool.completed"
      ? bestCanonical.result?.isError
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

  const assembled: AssembledWebSearch = {
    kind: "web-search",
    id: firstId,
    createdAt: firstCreatedAt,
    state: state as AssembledWebSearch["state"],
    heading: "Search",
  };

  if (bestCanonical.input?.query) {
    assembled.query = bestCanonical.input.query as string;
  }
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;

  const resultContent = extractResultContent(bestCanonical.result);
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

export function groupWebSearchActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WebSearchInvocation[] {
  const startedQueue: WebSearchInvocation[] = [];
  const byQuery = new Map<string, WebSearchInvocation[]>();
  const allInvocations: WebSearchInvocation[] = [];

  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "web_search") continue;

    if (activity.kind === "tool.started") {
      const inv: WebSearchInvocation = {
        query: undefined,
        activities: [activity],
        hasStarted: true,
        hasCompleted: false,
      };
      startedQueue.push(inv);
      allInvocations.push(inv);
      continue;
    }

    // tool.updated or tool.completed — has query
    const query = extractQuery(activity.payload);

    if (activity.kind === "tool.updated") {
      const pendingStarted = startedQueue.shift();
      if (pendingStarted && pendingStarted.query === undefined) {
        pendingStarted.query = query;
        pendingStarted.activities.push(activity);
        if (query) {
          let bucket = byQuery.get(query);
          if (!bucket) {
            bucket = [];
            byQuery.set(query, bucket);
          }
          bucket.push(pendingStarted);
        }
      } else {
        if (pendingStarted) startedQueue.unshift(pendingStarted);

        let matched = false;
        if (query) {
          const bucket = byQuery.get(query);
          const existing = bucket?.find((inv) => !inv.hasCompleted) ?? bucket?.at(-1);
          if (existing) {
            existing.activities.push(activity);
            matched = true;
          }
        }
        if (!matched) {
          const inv: WebSearchInvocation = {
            query,
            activities: [activity],
            hasStarted: false,
            hasCompleted: false,
          };
          allInvocations.push(inv);
          if (query) {
            let bucket = byQuery.get(query);
            if (!bucket) {
              bucket = [];
              byQuery.set(query, bucket);
            }
            bucket.push(inv);
          }
        }
      }
      continue;
    }

    // tool.completed
    if (activity.kind === "tool.completed") {
      let matched = false;
      if (query) {
        const bucket = byQuery.get(query);
        const existing = bucket?.find((inv) => !inv.hasCompleted);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        const inv: WebSearchInvocation = {
          query,
          activities: [activity],
          hasStarted: false,
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (query) {
          let bucket = byQuery.get(query);
          if (!bucket) {
            bucket = [];
            byQuery.set(query, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}

// =========================================================================
// Web fetch
// =========================================================================

/**
 * WebFetch is a dynamic_tool_call — tool.started is unidentifiable.
 * Skip started, assemble from updated/completed only (same as Read/Grep/Glob).
 */
interface WebFetchInvocation {
  /** Grouping key — URL from input. */
  url: string | undefined;
  activities: OrchestrationThreadActivity[];
  hasCompleted: boolean;
}

export function finalizeWebFetch(inv: WebFetchInvocation): AssembledWebFetch | null {
  let bestCanonical = null;
  let bestKind: string | null = null;
  let firstId: string | null = null;
  let firstCreatedAt: string | null = null;

  for (const activity of inv.activities) {
    if (!firstId) {
      firstId = activity.id;
      firstCreatedAt = activity.createdAt;
    }
    const canonical = extractClaudeToolData(activity.payload);
    if (!canonical) continue;

    if (
      !bestCanonical ||
      activity.kind === "tool.completed" ||
      (activity.kind === "tool.updated" && bestKind === "tool.started")
    ) {
      bestCanonical = canonical;
      bestKind = activity.kind;
    }
  }

  if (!firstId || !firstCreatedAt) return null;
  if (!bestCanonical) return null;

  const state =
    bestKind === "tool.completed"
      ? bestCanonical.result?.isError
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

  const assembled: AssembledWebFetch = {
    kind: "web-fetch",
    id: firstId,
    createdAt: firstCreatedAt,
    state: state as AssembledWebFetch["state"],
    heading: "Fetch",
  };

  if (bestCanonical.input?.url) {
    assembled.url = bestCanonical.input.url as string;
  }
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;

  const resultContent = extractResultContent(bestCanonical.result);
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

export function groupWebFetchActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): WebFetchInvocation[] {
  const byUrl = new Map<string, WebFetchInvocation[]>();
  const allInvocations: WebFetchInvocation[] = [];

  for (const activity of activities) {
    if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "dynamic_tool_call") continue;

    const toolName = extractToolName(activity.payload);
    if (toolName !== "WebFetch") continue;

    const url = extractUrl(activity.payload);

    if (activity.kind === "tool.updated") {
      let matched = false;
      if (url) {
        const bucket = byUrl.get(url);
        const existing = bucket?.find((inv) => !inv.hasCompleted) ?? bucket?.at(-1);
        if (existing) {
          existing.activities.push(activity);
          matched = true;
        }
      }
      if (!matched) {
        const inv: WebFetchInvocation = {
          url,
          activities: [activity],
          hasCompleted: false,
        };
        allInvocations.push(inv);
        if (url) {
          let bucket = byUrl.get(url);
          if (!bucket) {
            bucket = [];
            byUrl.set(url, bucket);
          }
          bucket.push(inv);
        }
      }
      continue;
    }

    // tool.completed
    if (activity.kind === "tool.completed") {
      let matched = false;
      if (url) {
        const bucket = byUrl.get(url);
        const existing = bucket?.find((inv) => !inv.hasCompleted);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        const inv: WebFetchInvocation = {
          url,
          activities: [activity],
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (url) {
          let bucket = byUrl.get(url);
          if (!bucket) {
            bucket = [];
            byUrl.set(url, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}
