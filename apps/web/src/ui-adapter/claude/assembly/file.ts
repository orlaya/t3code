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
} from "./shared";

// =========================================================================
// File change (Edit / Write)
// =========================================================================

interface FileChangeInvocation {
  /** Grouping key — file_path extracted from the updated/completed payload. */
  filePath: string | undefined;
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

  // tool.started only — no data yet, emit a "starting" placeholder
  if (!bestCanonical || !bestCanonical.input?.file_path) {
    return {
      kind: "edit",
      id: firstId,
      createdAt: firstCreatedAt,
      state: "starting",
      heading: "Edit",
      filePath: "",
      inlineDiffs: [],
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

  const filePath = bestCanonical.input.file_path;
  const toolName = bestCanonical.toolName;

  // Extract inline diffs from the best payload
  const inlineDiffs: CanonicalInlineDiff[] = bestPayload
    ? extractClaudeInlineDiffs(bestPayload)
    : [];

  if (toolName === "Write") {
    const assembled: AssembledWrite = {
      kind: "write",
      id: firstId,
      createdAt: firstCreatedAt,
      state: state as AssembledWrite["state"],
      heading: "Write",
      filePath,
    };
    if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;
    if (typeof bestCanonical.input.content === "string") {
      assembled.content = bestCanonical.input.content;
    }
    return assembled;
  }

  // Default: Edit
  const assembled: AssembledEdit = {
    kind: "edit",
    id: firstId,
    createdAt: firstCreatedAt,
    state: state as AssembledEdit["state"],
    heading: "Edit",
    filePath,
    inlineDiffs,
  };
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;
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
      const pendingStarted = startedQueue.shift();
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
        // Put it back and check for existing invocation by file path
        if (pendingStarted) startedQueue.unshift(pendingStarted);

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
      if (!matched) {
        const inv: FileChangeInvocation = {
          filePath: fp,
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
      ? bestCanonical.result?.isError
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

  const assembled: AssembledFileRead = {
    kind: "file-read",
    id: firstId,
    createdAt: firstCreatedAt,
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
      ? bestCanonical.result?.isError
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
