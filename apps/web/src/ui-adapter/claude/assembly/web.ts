/**
 * Web-related tool grouping and assembly:
 *   - Web search — own itemType ("web_search")
 *   - Web fetch — dynamic_tool_call, toolName "WebFetch"
 *
 * Both group by providerItemId (Claude tool_use_id) plumbed by the projector.
 */

import type {
  OrchestrationThreadActivity,
  AssembledWebSearch,
  AssembledWebFetch,
} from "@t3tools/contracts";

import {
  deriveAssembledState,
  extractResultContent,
  groupByProviderItemId,
  groupDynamicToolCallActivities,
  summarizeInvocation,
  type ProviderItemInvocation,
} from "./shared";

// =========================================================================
// Web search
// =========================================================================

type WebSearchInvocation = ProviderItemInvocation;

export function finalizeWebSearch(inv: WebSearchInvocation): AssembledWebSearch | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind } = summary;

  // tool.started only — no data yet, emit a "starting" placeholder.
  // If tool.completed arrived with status "failed" (interrupted mid-stream),
  // mark as interrupted instead of leaving it stuck as starting.
  if (!bestCanonical) {
    const wasInterrupted = bestKind === "tool.completed";
    return {
      kind: "web-search",
      id: firstId,
      createdAt: firstCreatedAt,
      turnId: inv.turnId,
      state: wasInterrupted ? "interrupted" : "starting",
      heading: "Search",
    };
  }

  const state = deriveAssembledState(bestCanonical, bestKind);

  const assembled: AssembledWebSearch = {
    kind: "web-search",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
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
  return groupByProviderItemId(activities, "web_search");
}

// =========================================================================
// Web fetch
// =========================================================================

type WebFetchInvocation = ProviderItemInvocation;

export function finalizeWebFetch(inv: WebFetchInvocation): AssembledWebFetch | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind } = summary;
  if (!bestCanonical) return null;

  const state = deriveAssembledState(bestCanonical, bestKind);

  const assembled: AssembledWebFetch = {
    kind: "web-fetch",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
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
  return groupDynamicToolCallActivities(activities, (toolName) => toolName === "WebFetch");
}
