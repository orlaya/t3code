/**
 * File-related tool grouping and assembly:
 *   - File change (Edit / Write) — file_change itemType, FIFO startedQueue
 *   - File read (Read) — dynamic_tool_call, NO startedQueue
 *   - File search (Grep / Glob) — dynamic_tool_call, NO startedQueue
 */

import type {
  OrchestrationThreadActivity,
  AssembledEdit,
  AssembledWrite,
  AssembledFileRead,
  AssembledFileSearch,
  CanonicalInlineDiff,
} from "@t3tools/contracts";

import { extractClaudeToolData, extractClaudeInlineDiffs } from "../extraction";
import {
  extractItemType,
  extractToolName,
  extractFilePath,
  extractPattern,
  extractSearchPath,
  extractResultContent,
  shiftMatchingTurnId,
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

interface FileChangeInvocation {
  /** Grouping key — file_path extracted from the updated/completed payload. */
  filePath: string | undefined;
  turnId: string | null;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

export function finalizeFileChange(
  inv: FileChangeInvocation,
): AssembledEdit | AssembledWrite | null {
  // Find the most informative activity — completed > updated > started
  let bestCanonical = null;
  let bestKind: string | null = null;
  let bestPayload: unknown = null;
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
      bestPayload = activity.payload;
    }
  }

  if (!firstId || !firstCreatedAt) return null;

  // tool.started only — no data yet, emit a "starting" placeholder.
  // If tool.completed arrived with status "failed" (interrupted mid-stream),
  // mark as interrupted instead of leaving it stuck as starting.
  //
  // The tool.started summary tells us "Write started" vs "Edit started" —
  // use it so the spinner shows the correct heading from the start.
  if (!bestCanonical || !bestCanonical.input?.file_path) {
    const wasInterrupted = bestKind === "tool.completed";
    const isWrite = inv.activities.some((a) =>
      a.kind === "tool.started" && a.summary.startsWith("Write"),
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

  const state =
    bestKind === "tool.completed"
      ? bestCanonical.result?.isError || bestCanonical.status === "failed"
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

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
  const startedQueue: FileChangeInvocation[] = [];
  const byFilePath = new Map<string, FileChangeInvocation[]>();
  const allInvocations: FileChangeInvocation[] = [];

  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "file_change") continue;

    if (activity.kind === "tool.started") {
      const inv: FileChangeInvocation = {
        filePath: undefined,
        turnId: activity.turnId,
        activities: [activity],
        hasStarted: true,
        hasCompleted: false,
      };
      startedQueue.push(inv);
      allInvocations.push(inv);
      continue;
    }

    // tool.updated or tool.completed — has file_path
    const fp = extractFilePath(activity.payload);

    if (activity.kind === "tool.updated") {
      const pendingStarted = shiftMatchingTurnId(startedQueue, activity.turnId);
      if (pendingStarted && pendingStarted.filePath === undefined) {
        // Marry to earliest unmatched started
        pendingStarted.filePath = fp;
        pendingStarted.activities.push(activity);
        if (fp) {
          let bucket = byFilePath.get(fp);
          if (!bucket) {
            bucket = [];
            byFilePath.set(fp, bucket);
          }
          bucket.push(pendingStarted);
        }
      } else {
        let matched = false;
        if (fp) {
          const bucket = byFilePath.get(fp);
          const existing = bucket?.find((inv) => !inv.hasCompleted) ?? bucket?.at(-1);
          if (existing) {
            existing.activities.push(activity);
            matched = true;
          }
        }
        if (!matched) {
          const inv: FileChangeInvocation = {
            filePath: fp,
            turnId: activity.turnId,
            activities: [activity],
            hasStarted: false,
            hasCompleted: false,
          };
          allInvocations.push(inv);
          if (fp) {
            let bucket = byFilePath.get(fp);
            if (!bucket) {
              bucket = [];
              byFilePath.set(fp, bucket);
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
      if (fp) {
        const bucket = byFilePath.get(fp);
        const existing = bucket?.find((inv) => !inv.hasCompleted);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      // Fallback: match by turnId against the startedQueue (handles interrupted
      // tools where tool.completed arrives with empty input/no file path).
      if (!matched) {
        const pendingStarted = shiftMatchingTurnId(startedQueue, activity.turnId);
        if (pendingStarted) {
          pendingStarted.activities.push(activity);
          pendingStarted.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        const inv: FileChangeInvocation = {
          filePath: fp,
          turnId: activity.turnId,
          activities: [activity],
          hasStarted: false,
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (fp) {
          let bucket = byFilePath.get(fp);
          if (!bucket) {
            bucket = [];
            byFilePath.set(fp, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}

// =========================================================================
// File read (Read tool)
// =========================================================================

/**
 * dynamic_tool_call tool.started events have no toolName — they're shared by
 * Read, Grep, Glob, WebFetch, etc. We can't claim them for any one tool type
 * without stealing from another. So we skip tool.started entirely and only
 * create invocations from tool.updated/tool.completed where toolName === "Read".
 */

interface FileReadInvocation {
  filePath: string | undefined;
  turnId: string | null;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

export function finalizeFileRead(inv: FileReadInvocation): AssembledFileRead | null {
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

  // No usable data — shouldn't happen since we only group from updated/completed
  if (!bestCanonical || !bestCanonical.input?.file_path) return null;

  const state =
    bestKind === "tool.completed"
      ? bestCanonical.result?.isError || bestCanonical.status === "failed"
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

  const assembled: AssembledFileRead = {
    kind: "file-read",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
    state: state as AssembledFileRead["state"],
    heading: "Read",
    filePath: bestCanonical.input.file_path,
  };

  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;

  const resultContent = extractResultContent(bestCanonical.result);
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

export function groupFileReadActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): FileReadInvocation[] {
  const byFilePath = new Map<string, FileReadInvocation[]>();
  const allInvocations: FileReadInvocation[] = [];

  for (const activity of activities) {
    if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "dynamic_tool_call") continue;

    const toolName = extractToolName(activity.payload);
    if (toolName !== "Read") continue;

    const fp = extractFilePath(activity.payload);

    if (activity.kind === "tool.updated") {
      // Try to absorb into an existing incomplete invocation for the same file
      let matched = false;
      if (fp) {
        const bucket = byFilePath.get(fp);
        const existing = bucket?.find((inv) => !inv.hasCompleted) ?? bucket?.at(-1);
        if (existing) {
          existing.activities.push(activity);
          matched = true;
        }
      }
      if (!matched) {
        const inv: FileReadInvocation = {
          filePath: fp,
          turnId: activity.turnId,
          activities: [activity],
          hasStarted: false,
          hasCompleted: false,
        };
        allInvocations.push(inv);
        if (fp) {
          let bucket = byFilePath.get(fp);
          if (!bucket) {
            bucket = [];
            byFilePath.set(fp, bucket);
          }
          bucket.push(inv);
        }
      }
      continue;
    }

    // tool.completed
    if (activity.kind === "tool.completed") {
      let matched = false;
      if (fp) {
        const bucket = byFilePath.get(fp);
        const existing = bucket?.find((inv) => !inv.hasCompleted);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        const inv: FileReadInvocation = {
          filePath: fp,
          turnId: activity.turnId,
          activities: [activity],
          hasStarted: false,
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (fp) {
          let bucket = byFilePath.get(fp);
          if (!bucket) {
            bucket = [];
            byFilePath.set(fp, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}

// =========================================================================
// File search (Grep / Glob)
// =========================================================================

const FILE_SEARCH_TOOL_NAMES = new Set(["Grep", "Glob"]);

interface FileSearchInvocation {
  toolName: string | undefined;
  /** Grouping key — pattern string from input. */
  pattern: string | undefined;
  turnId: string | null;
  activities: OrchestrationThreadActivity[];
  hasCompleted: boolean;
}

export function finalizeFileSearch(inv: FileSearchInvocation): AssembledFileSearch | null {
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
      ? bestCanonical.result?.isError || bestCanonical.status === "failed"
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

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
  const byPattern = new Map<string, FileSearchInvocation[]>();
  const allInvocations: FileSearchInvocation[] = [];

  for (const activity of activities) {
    if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "dynamic_tool_call") continue;

    const toolName = extractToolName(activity.payload);
    if (!toolName || !FILE_SEARCH_TOOL_NAMES.has(toolName)) continue;

    const pattern = extractPattern(activity.payload);

    if (activity.kind === "tool.updated") {
      let matched = false;
      if (pattern) {
        const bucket = byPattern.get(pattern);
        const existing = bucket?.find((inv) => !inv.hasCompleted) ?? bucket?.at(-1);
        if (existing) {
          existing.activities.push(activity);
          matched = true;
        }
      }
      if (!matched) {
        const inv: FileSearchInvocation = {
          toolName,
          pattern,
          turnId: activity.turnId,
          activities: [activity],
          hasCompleted: false,
        };
        allInvocations.push(inv);
        if (pattern) {
          let bucket = byPattern.get(pattern);
          if (!bucket) {
            bucket = [];
            byPattern.set(pattern, bucket);
          }
          bucket.push(inv);
        }
      }
      continue;
    }

    // tool.completed
    if (activity.kind === "tool.completed") {
      let matched = false;
      if (pattern) {
        const bucket = byPattern.get(pattern);
        const existing = bucket?.find((inv) => !inv.hasCompleted);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        const inv: FileSearchInvocation = {
          toolName,
          pattern,
          turnId: activity.turnId,
          activities: [activity],
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (pattern) {
          let bucket = byPattern.get(pattern);
          if (!bucket) {
            bucket = [];
            byPattern.set(pattern, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}
