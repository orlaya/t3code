/**
 * File-related tool grouping and assembly:
 *   - File change (Edit / Write) — file_change itemType
 *   - File read (Read) — dynamic_tool_call, toolName "Read"
 *   - File search (Grep / Glob) — dynamic_tool_call, toolName "Grep" | "Glob"
 *
 * All three group by `providerItemId` (Claude `tool_use_id`) plumbed through
 * by the orchestration projector. Activities without a providerItemId are
 * dropped. For dynamic_tool_call tools, tool.started lacks toolName so its
 * activity is held in a pending bucket and only attached to a typed grouper
 * once a later tool.updated reveals the toolName for the same providerItemId.
 */

import type {
  OrchestrationThreadActivity,
  AssembledEdit,
  AssembledWrite,
  AssembledFileRead,
  AssembledFileSearch,
  CanonicalInlineDiff,
} from "@t3tools/contracts";

import { extractClaudeInlineDiffs } from "../extraction";
import {
  deriveAssembledState,
  extractSearchPath,
  extractResultContent,
  groupByProviderItemId,
  groupDynamicToolCallActivities,
  summarizeInvocation,
  type ProviderItemInvocation,
} from "./shared";

// =========================================================================
// Helpers
// =========================================================================

/**
 * Clean up a Claude tool error into a human-readable message.
 *
 * Claude's error strings are formatted for the AI — they include the full
 * input string and remediation instructions. We strip those down to just
 * the first meaningful sentence.
 *
 * Known patterns:
 * - "String to replace not found in file.\nString: <dump>"
 * - "Found 2 matches of the string to replace, but replace_all is false. To replace... String: <dump>"
 * - "File has not been read yet. Read it first before writing to it."
 */
function humaniseEditError(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  // Strip <tool_use_error> wrapper tags
  let msg = raw
    .replace(/^<tool_use_error>\s*/s, "")
    .replace(/\s*<\/tool_use_error>$/s, "")
    .trim();

  // Chop everything after "String:" — that's the raw input dump
  const stringIdx = msg.indexOf("\nString:");
  if (stringIdx === -1) {
    // Also check for inline " String:" (no newline) after a sentence
    const inlineIdx = msg.search(/\.\s+String:/);
    if (inlineIdx !== -1) {
      msg = msg.slice(0, inlineIdx + 1).trim();
    }
  } else {
    msg = msg.slice(0, stringIdx).trim();
  }

  // Drop AI-directed remediation sentences:
  // "To replace all occurrences, set replace_all to true. To replace only one..."
  // "Read it first before writing to it."
  msg = msg
    .replace(/\s*To replace all occurrences[^.]*\./g, "")
    .replace(/\s*To replace only one[^.]*\./g, "")
    .replace(/\s*Read it first before writing to it\./g, "")
    .trim();

  return msg.length > 0 ? msg : undefined;
}

// =========================================================================
// File change (Edit / Write)
// =========================================================================

type FileChangeInvocation = ProviderItemInvocation;

export function finalizeFileChange(
  inv: FileChangeInvocation,
): AssembledEdit | AssembledWrite | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind, bestPayload } = summary;

  // tool.started only — no data yet, emit a "starting" placeholder.
  // If tool.completed arrived with status "failed" (interrupted mid-stream),
  // mark as interrupted instead of leaving it stuck as starting.
  //
  // The tool.started summary tells us "Write started" vs "Edit started" —
  // use it so the spinner shows the correct heading from the start.
  if (!bestCanonical || !bestCanonical.input?.file_path) {
    const wasInterrupted = bestKind === "tool.completed";
    const isWrite = inv.activities.some(
      (a) => a.kind === "tool.started" && a.summary.startsWith("Write"),
    );
    if (isWrite) {
      return {
        kind: "write",
        id: firstId,
        createdAt: firstCreatedAt,
        turnId: inv.turnId,
        state: wasInterrupted ? "interrupted" : "starting",
        heading: "Write",
        filePath: "",
      };
    }
    return {
      kind: "edit",
      id: firstId,
      createdAt: firstCreatedAt,
      turnId: inv.turnId,
      state: wasInterrupted ? "interrupted" : "starting",
      heading: "Edit",
      filePath: "",
      inlineDiffs: [],
    };
  }

  const state = deriveAssembledState(bestCanonical, bestKind);
  const filePath = bestCanonical.input.file_path;
  const toolName = bestCanonical.toolName;

  // Failed edits/writes: extract error message, skip inline diffs
  const isFailed = state === "failed";
  const errorMessage = isFailed ? humaniseEditError(bestCanonical.result?.error) : undefined;

  // Extract inline diffs from the best payload (skip for failed — the edit didn't happen)
  const inlineDiffs: CanonicalInlineDiff[] =
    !isFailed && bestPayload ? extractClaudeInlineDiffs(bestPayload) : [];

  if (toolName === "Write") {
    const assembled: AssembledWrite = {
      kind: "write",
      id: firstId,
      createdAt: firstCreatedAt,
      turnId: inv.turnId,
      state: state as AssembledWrite["state"],
      heading: "Write",
      filePath,
    };
    if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;
    if (typeof bestCanonical.input.content === "string") {
      assembled.content = bestCanonical.input.content;
    }
    if (errorMessage) assembled.errorMessage = errorMessage;
    return assembled;
  }

  // Default: Edit
  const assembled: AssembledEdit = {
    kind: "edit",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
    state: state as AssembledEdit["state"],
    heading: "Edit",
    filePath,
    inlineDiffs,
  };
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;
  if (errorMessage) assembled.errorMessage = errorMessage;
  return assembled;
}

export function groupFileChangeActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): FileChangeInvocation[] {
  return groupByProviderItemId(activities, "file_change");
}

// =========================================================================
// File read (Read tool)
// =========================================================================

/**
 * dynamic_tool_call tool.started events have no toolName — but they DO carry
 * providerItemId. We discover the toolName from a later tool.updated /
 * tool.completed for the same providerItemId, then attach the tool.started
 * activity to the right typed grouper.
 */

type FileReadInvocation = ProviderItemInvocation;

export function finalizeFileRead(inv: FileReadInvocation): AssembledFileRead | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind } = summary;

  // No usable data — shouldn't happen since we only finalize when toolName is known
  if (!bestCanonical || !bestCanonical.input?.file_path) return null;

  const state = deriveAssembledState(bestCanonical, bestKind);

  // Claude: offset = starting line number, limit = number of lines to read.
  // Both map directly to display line numbers (offset 40 → line 40 in output).
  const rawOffset =
    typeof bestCanonical.input.offset === "number" ? bestCanonical.input.offset : undefined;
  const rawLimit =
    typeof bestCanonical.input.limit === "number" ? bestCanonical.input.limit : undefined;
  const lineStart = rawOffset ?? undefined;
  const lineEnd = rawOffset != null && rawLimit != null ? rawOffset + rawLimit : undefined;

  const assembled: AssembledFileRead = {
    kind: "file-read",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
    state: state as AssembledFileRead["state"],
    heading: "Read",
    filePath: bestCanonical.input.file_path,
    ...(lineStart != null && { lineStart }),
    ...(lineEnd != null && { lineEnd }),
  };

  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;

  const resultContent = extractResultContent(bestCanonical.result);
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

export function groupFileReadActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): FileReadInvocation[] {
  return groupDynamicToolCallActivities(activities, (toolName) => toolName === "Read");
}

// =========================================================================
// File search (Grep / Glob)
// =========================================================================

const FILE_SEARCH_TOOL_NAMES = new Set(["Grep", "Glob"]);

type FileSearchInvocation = ProviderItemInvocation;

export function finalizeFileSearch(inv: FileSearchInvocation): AssembledFileSearch | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind } = summary;
  if (!bestCanonical) return null;

  const state = deriveAssembledState(bestCanonical, bestKind);

  const toolName = bestCanonical.toolName;
  const heading = toolName === "Glob" ? "Glob" : toolName === "Grep" ? "Grep" : "Search";

  const assembled: AssembledFileSearch = {
    kind: "file-search",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
    state: state as AssembledFileSearch["state"],
    heading,
    toolName,
  };

  if (bestCanonical.input?.pattern) {
    assembled.pattern = bestCanonical.input.pattern as string;
  }
  if (bestCanonical.input?.file_path) {
    assembled.filePath = bestCanonical.input.file_path;
  } else {
    // Grep/Glob use `path` not `file_path` — check raw payload
    const searchPath = extractSearchPath(inv.activities.at(-1)?.payload);
    if (searchPath) assembled.filePath = searchPath;
  }
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;

  const resultContent = extractResultContent(bestCanonical.result);
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

export function groupFileSearchActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): FileSearchInvocation[] {
  return groupDynamicToolCallActivities(activities, (toolName) =>
    FILE_SEARCH_TOOL_NAMES.has(toolName),
  );
}
