/**
 * Generic tool-call / MCP tool grouping and assembly.
 *
 * Catches everything not already handled by the specific grouping functions:
 *   - mcp_tool_call → AssembledMcpTool (own itemType, all lifecycle events
 *     carry providerItemId)
 *   - remaining dynamic_tool_call → AssembledToolCall (tool.started lacks
 *     toolName so it's skipped; updated/completed group by providerItemId)
 */

import type {
  OrchestrationThreadActivity,
  AssembledMcpTool,
  AssembledToolCall,
} from "@t3tools/contracts";

import {
  deriveAssembledState,
  extractItemType,
  extractToolName,
  extractProviderItemId,
  extractResultContent,
  summarizeInvocation,
  type ProviderItemInvocation,
} from "./shared";

/** The set of dynamic_tool_call toolNames already handled by specific groupers. */
const CLAIMED_DYNAMIC_TOOL_NAMES = new Set(["Read", "Grep", "Glob", "WebFetch"]);

interface GenericToolInvocation extends ProviderItemInvocation {
  itemType: string;
}

export function finalizeGenericTool(
  inv: GenericToolInvocation,
): AssembledMcpTool | AssembledToolCall | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind } = summary;

  // Sweep activities once for any toolName — covers dynamic_tool_call where
  // toolName might appear on tool.updated only (not the tool.started we just
  // looked at as `first`).
  let bestToolName: string | undefined;
  for (const activity of inv.activities) {
    const tn = extractToolName(activity.payload);
    if (tn) bestToolName = tn;
  }
  const toolName = bestCanonical?.toolName ?? bestToolName ?? "Tool";

  // tool.started only — no data yet, emit a "starting" placeholder.
  // If tool.completed arrived with status "failed" (interrupted mid-stream),
  // mark as interrupted instead of leaving it stuck as starting.
  if (!bestCanonical) {
    const wasInterrupted = bestKind === "tool.completed";
    const isMcp = inv.itemType === "mcp_tool_call";
    if (isMcp) {
      return {
        kind: "mcp-tool",
        id: firstId,
        createdAt: firstCreatedAt,
        turnId: inv.turnId,
        state: wasInterrupted ? "interrupted" : "starting",
        heading: toolName,
        toolName,
      };
    }
    return {
      kind: "tool-call",
      id: firstId,
      createdAt: firstCreatedAt,
      turnId: inv.turnId,
      state: wasInterrupted ? "interrupted" : "starting",
      heading: toolName,
      toolName,
    };
  }

  const state = deriveAssembledState(bestCanonical, bestKind);
  const heading = toolName !== "unknown" ? toolName : "Tool call";
  const detail = bestCanonical.detail;
  const resultContent = extractResultContent(bestCanonical.result);

  const isMcp = inv.itemType === "mcp_tool_call";

  if (isMcp) {
    const assembled: AssembledMcpTool = {
      kind: "mcp-tool",
      id: firstId,
      createdAt: firstCreatedAt,
      turnId: inv.turnId,
      state: state as AssembledMcpTool["state"],
      heading,
      toolName,
    };
    if (detail) assembled.detail = detail;
    if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;
    if (resultContent) assembled.resultContent = resultContent;
    return assembled;
  }

  const assembled: AssembledToolCall = {
    kind: "tool-call",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
    state: state as AssembledToolCall["state"],
    heading,
    toolName,
  };
  if (detail) assembled.detail = detail;
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;
  if (resultContent) assembled.resultContent = resultContent;
  return assembled;
}

export function groupGenericToolActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): GenericToolInvocation[] {
  const byProviderItemId = new Map<string, GenericToolInvocation>();
  const allInvocations: GenericToolInvocation[] = [];

  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "mcp_tool_call" && itemType !== "dynamic_tool_call") continue;

    // dynamic_tool_call: skip toolNames claimed by other groupers, and skip
    // tool.started (no toolName means we can't tell whether it belongs to a
    // claimed grouper — if the same providerItemId later turns out to be a
    // Read/Grep/Glob/WebFetch we mustn't have already absorbed it here).
    if (itemType === "dynamic_tool_call") {
      if (activity.kind === "tool.started") continue;
      const toolName = extractToolName(activity.payload);
      if (toolName && CLAIMED_DYNAMIC_TOOL_NAMES.has(toolName)) continue;
    }

    const providerItemId = extractProviderItemId(activity.payload);
    if (!providerItemId) continue;

    let inv = byProviderItemId.get(providerItemId);
    if (!inv) {
      inv = {
        providerItemId,
        itemType,
        turnId: activity.turnId,
        activities: [],
        hasCompleted: false,
      };
      byProviderItemId.set(providerItemId, inv);
      allInvocations.push(inv);
    }

    inv.activities.push(activity);
    if (activity.kind === "tool.completed") inv.hasCompleted = true;
  }

  return allInvocations;
}
