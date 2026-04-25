/**
 * Generic tool-call / MCP tool grouping and assembly.
 *
 * Catches everything not already handled by the specific grouping functions:
 *   - mcp_tool_call → AssembledMcpTool (has own itemType, so tool.started IS
 *     identifiable — uses a startedQueue)
 *   - remaining dynamic_tool_call → AssembledToolCall (tool.started is
 *     unidentifiable — skip started, assemble from updated/completed only)
 *
 * Grouping key is toolName. Each tool.updated creates a new invocation;
 * tool.completed marries the earliest incomplete invocation with the same
 * toolName (FIFO).
 */

import type {
  OrchestrationThreadActivity,
  AssembledMcpTool,
  AssembledToolCall,
} from "@t3tools/contracts";

import { extractClaudeToolData } from "../extraction";
import { extractItemType, extractToolName, extractResultContent } from "./shared";

/** The set of dynamic_tool_call toolNames already handled by specific groupers. */
const CLAIMED_DYNAMIC_TOOL_NAMES = new Set(["Read", "Grep", "Glob", "WebFetch"]);

interface GenericToolInvocation {
  toolName: string | undefined;
  itemType: string;
  turnId: string | null;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

export function finalizeGenericTool(
  inv: GenericToolInvocation,
): AssembledMcpTool | AssembledToolCall | null {
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

  const toolName = bestCanonical?.toolName ?? inv.toolName ?? "Tool";

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

  const state =
    bestKind === "tool.completed"
      ? bestCanonical.result?.isError || bestCanonical.status === "failed"
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

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
  // MCP tools use a startedQueue (identifiable itemType).
  // Remaining dynamic_tool_call tools skip tool.started.
  const mcpStartedQueue: GenericToolInvocation[] = [];
  const byToolName = new Map<string, GenericToolInvocation[]>();
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

    // MCP tool — tool.started is identifiable
    if (itemType === "mcp_tool_call") {
      if (activity.kind === "tool.started") {
        const inv: GenericToolInvocation = {
          toolName: extractToolName(activity.payload),
          itemType,
          turnId: activity.turnId,
          activities: [activity],
          hasStarted: true,
          hasCompleted: false,
        };
        mcpStartedQueue.push(inv);
        allInvocations.push(inv);
        continue;
      }

      const toolName = extractToolName(activity.payload);

      if (activity.kind === "tool.updated") {
        // Try to marry to earliest unmatched MCP started with same toolName and turn
        const pending = mcpStartedQueue.find(
          (inv) => !inv.hasCompleted && inv.toolName === toolName && inv.turnId === activity.turnId,
        );
        if (pending) {
          pending.activities.push(activity);
          if (toolName) pending.toolName = toolName;
        } else {
          const inv: GenericToolInvocation = {
            toolName,
            itemType,
            turnId: activity.turnId,
            activities: [activity],
            hasStarted: false,
            hasCompleted: false,
          };
          allInvocations.push(inv);
          // Also add to byToolName so completed can find it
          if (toolName) {
            let bucket = byToolName.get(toolName);
            if (!bucket) {
              bucket = [];
              byToolName.set(toolName, bucket);
            }
            bucket.push(inv);
          }
        }
        continue;
      }

      // tool.completed for MCP
      if (activity.kind === "tool.completed") {
        // Try started queue first — same turn only
        const pending = mcpStartedQueue.find(
          (inv) => !inv.hasCompleted && inv.toolName === toolName && inv.turnId === activity.turnId,
        );
        if (pending) {
          pending.activities.push(activity);
          pending.hasCompleted = true;
          if (toolName) pending.toolName = toolName;
        } else {
          // Try byToolName (from orphan updated) — same turn only
          const bucket = toolName ? byToolName.get(toolName) : undefined;
          const existing = bucket?.find(
            (inv) => !inv.hasCompleted && inv.turnId === activity.turnId,
          );
          if (existing) {
            existing.activities.push(activity);
            existing.hasCompleted = true;
          } else {
            const inv: GenericToolInvocation = {
              toolName,
              itemType,
              turnId: activity.turnId,
              activities: [activity],
              hasStarted: false,
              hasCompleted: true,
            };
            allInvocations.push(inv);
          }
        }
        continue;
      }
      continue;
    }

    // Remaining dynamic_tool_call — skip tool.started (unidentifiable)
    if (itemType !== "dynamic_tool_call") continue;

    const toolName = extractToolName(activity.payload);

    // Skip tools already handled by specific groupers
    if (toolName && CLAIMED_DYNAMIC_TOOL_NAMES.has(toolName)) continue;

    if (activity.kind === "tool.started") continue; // unidentifiable

    if (activity.kind === "tool.updated") {
      const inv: GenericToolInvocation = {
        toolName,
        itemType,
        turnId: activity.turnId,
        activities: [activity],
        hasStarted: false,
        hasCompleted: false,
      };
      allInvocations.push(inv);
      if (toolName) {
        let bucket = byToolName.get(toolName);
        if (!bucket) {
          bucket = [];
          byToolName.set(toolName, bucket);
        }
        bucket.push(inv);
      }
      continue;
    }

    // tool.completed
    if (activity.kind === "tool.completed") {
      let matched = false;
      if (toolName) {
        const bucket = byToolName.get(toolName);
        const existing = bucket?.find((inv) => !inv.hasCompleted && inv.turnId === activity.turnId);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        const inv: GenericToolInvocation = {
          toolName,
          itemType,
          turnId: activity.turnId,
          activities: [activity],
          hasStarted: false,
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (toolName) {
          let bucket = byToolName.get(toolName);
          if (!bucket) {
            bucket = [];
            byToolName.set(toolName, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}
