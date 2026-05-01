/**
 * Shared payload helpers used across assembly groupers.
 */

import type { CanonicalToolData, OrchestrationThreadActivity } from "@t3tools/contracts";

import { extractClaudeToolData } from "../extraction";
import { isRecord } from "../../helpers";

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

/**
 * Extract the stable provider-side item id from a tool activity payload.
 *
 * For Claude this is the `tool_use_id` (e.g. "toolu_01EjRaHvRa…") plumbed
 * through by the orchestration projector. It is present on every
 * tool.started / tool.updated / tool.completed activity for a given tool
 * invocation and is the canonical join key for assembly grouping.
 *
 * Returns undefined for non-Claude / pre-providerItemId activities — those
 * activities are skipped during grouping rather than falling back to
 * heuristic matching (which has been removed).
 */
export function extractProviderItemId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return typeof payload.providerItemId === "string" ? payload.providerItemId : undefined;
}

export function extractCommandString(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.command === "string" ? input.command : undefined;
}

export function extractItemType(payload: unknown): string {
  if (!isRecord(payload)) return "unknown";
  return typeof payload.itemType === "string" ? payload.itemType : "unknown";
}

export function extractToolName(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  return typeof data.toolName === "string" ? data.toolName : undefined;
}

export function extractFilePath(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.file_path === "string" ? input.file_path : undefined;
}

export function extractPattern(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.pattern === "string" ? input.pattern : undefined;
}

export function extractSearchPath(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.path === "string" ? input.path : undefined;
}

export function extractQuery(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.query === "string" ? input.query : undefined;
}

export function extractUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.url === "string" ? input.url : undefined;
}

export function extractDescription(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.description === "string" ? input.description : undefined;
}

// ---------------------------------------------------------------------------
// Generic groupers
// ---------------------------------------------------------------------------

/** Single-providerItemId invocation — base shape used by every grouper. */
export interface ProviderItemInvocation {
  providerItemId: string;
  turnId: string | null;
  activities: OrchestrationThreadActivity[];
  hasCompleted: boolean;
}

const TOOL_LIFECYCLE_KINDS = new Set(["tool.started", "tool.updated", "tool.completed"]);

/**
 * Group activities by `providerItemId` for an identifiable tool itemType
 * (e.g. "command_execution", "file_change", "web_search",
 * "collab_agent_tool_call"). All three lifecycle events carry providerItemId
 * for identifiable types, so we can include tool.started.
 */
export function groupByProviderItemId(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  itemType: string,
): ProviderItemInvocation[] {
  const byProviderItemId = new Map<string, ProviderItemInvocation>();
  const allInvocations: ProviderItemInvocation[] = [];

  for (const activity of activities) {
    if (!TOOL_LIFECYCLE_KINDS.has(activity.kind)) continue;
    if (extractItemType(activity.payload) !== itemType) continue;

    const providerItemId = extractProviderItemId(activity.payload);
    if (!providerItemId) continue;

    let inv = byProviderItemId.get(providerItemId);
    if (!inv) {
      inv = {
        providerItemId,
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

/**
 * Group activities for `dynamic_tool_call` tools (Read, Grep, Glob, WebFetch,
 * other) by `providerItemId`.
 *
 * tool.started is skipped because dynamic_tool_call started events have no
 * `toolName` — the toolName only appears on tool.updated / tool.completed,
 * which is also when we can apply the `toolNamePredicate`. This means
 * dynamic_tool_call tools start displaying at the "in-progress" state.
 */
export function groupDynamicToolCallActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  toolNamePredicate: (toolName: string) => boolean,
): ProviderItemInvocation[] {
  const byProviderItemId = new Map<string, ProviderItemInvocation>();
  const allInvocations: ProviderItemInvocation[] = [];

  for (const activity of activities) {
    if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") continue;
    if (extractItemType(activity.payload) !== "dynamic_tool_call") continue;

    const toolName = extractToolName(activity.payload);
    if (!toolName || !toolNamePredicate(toolName)) continue;

    const providerItemId = extractProviderItemId(activity.payload);
    if (!providerItemId) continue;

    let inv = byProviderItemId.get(providerItemId);
    if (!inv) {
      inv = {
        providerItemId,
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

// ---------------------------------------------------------------------------
// Finalize helpers — shared by all per-tool finalize functions
// ---------------------------------------------------------------------------

export type AssembledLifecycleState = "starting" | "in-progress" | "completed" | "failed";

export interface InvocationSummary {
  /** id from the first activity — used as the assembled tool's stable id. */
  firstId: string;
  /** createdAt from the first activity. */
  firstCreatedAt: string;
  /**
   * The most informative canonical tool data found across the invocation's
   * activities (preferring tool.completed > tool.updated > tool.started).
   * Null if no activity yielded canonical data (e.g. only tool.started seen).
   */
  bestCanonical: CanonicalToolData | null;
  /** The kind of the activity whose canonical data became `bestCanonical`. */
  bestKind: string | null;
  /**
   * The raw payload of the activity that produced `bestCanonical`. Useful for
   * extractors that read provider-specific fields not exposed via CanonicalToolData
   * (e.g. inline diffs in file_change activities).
   */
  bestPayload: unknown;
}

/**
 * Walk an invocation's activities and pull out:
 *   - the first activity's id + createdAt (used as the assembled tool's id)
 *   - the most informative canonical tool data (preferring completed > updated > started)
 *
 * Returns null if the invocation has no activities (shouldn't happen because
 * groupers only register an invocation once they have something to push).
 */
export function summarizeInvocation(inv: ProviderItemInvocation): InvocationSummary | null {
  const first = inv.activities[0];
  if (!first) return null;

  let bestCanonical: CanonicalToolData | null = null;
  let bestKind: string | null = null;
  let bestPayload: unknown = null;

  for (const activity of inv.activities) {
    const canonical = extractClaudeToolData(activity.payload);
    if (!canonical) continue;
    if (
      !bestCanonical ||
      activity.kind === "tool.completed" ||
      (activity.kind === "tool.updated" && bestKind === "tool.started")
    ) {
      bestCanonical = canonical;
      bestKind = activity.kind;
      bestPayload = activity.payload;
    }
  }

  return {
    firstId: first.id,
    firstCreatedAt: first.createdAt,
    bestCanonical,
    bestKind,
    bestPayload,
  };
}

/**
 * Map (bestCanonical, bestKind) onto the assembled tool's lifecycle state.
 *
 * - tool.completed with isError or status="failed" → "failed"
 * - tool.completed otherwise → "completed"
 * - tool.updated → "in-progress"
 * - tool.started (or no canonical) → "starting"
 */
export function deriveAssembledState(
  bestCanonical: CanonicalToolData | null,
  bestKind: string | null,
): AssembledLifecycleState {
  if (bestKind === "tool.completed") {
    if (bestCanonical?.result?.isError || bestCanonical?.status === "failed") return "failed";
    return "completed";
  }
  if (bestKind === "tool.updated") return "in-progress";
  return "starting";
}

// ---------------------------------------------------------------------------
// Hook prefix parsing
// ---------------------------------------------------------------------------

const HOOK_PREFIX_RE = /^::hook::([^:]+)::(ok|error)::\s*/;

/**
 * Check if result content starts with a `::hook::{name}::{status}::` prefix.
 * Returns the parsed hook metadata, or null if no prefix found.
 */
export function parseHookPrefix(content: string): { name: string; status: "ok" | "error" } | null {
  const match = HOOK_PREFIX_RE.exec(content);
  if (!match) return null;
  return { name: match[1]!, status: match[2]! as "ok" | "error" };
}

// ---------------------------------------------------------------------------
// Result content extraction
// ---------------------------------------------------------------------------

export function extractResultContent(
  result: { content?: string | ReadonlyArray<{ type: string; text?: string }> } | undefined,
): string | undefined {
  if (!result) return undefined;
  const content = result.content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  // Sub-agent results come as content block arrays: [{ type: "text", text: "..." }]
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        texts.push(block.text);
      }
    }
    const joined = texts.join("\n").trim();
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}
