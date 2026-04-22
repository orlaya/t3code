/**
 * Claude provider — tool lifecycle assembly.
 *
 * Groups a stream of raw activities into one AssembledToolInvocation per tool
 * invocation. The work log receives assembled invocations — it never has to
 * figure out which activities belong together or what state an invocation is in.
 *
 * Grouping strategy for commands:
 *   - tool.started has NO data (just itemType) — creates a pending slot
 *   - tool.updated has data.input.command — marries to earliest unmatched
 *     tool.started of the same itemType, keyed by command string
 *   - tool.completed has data.input.command + result.tool_use_id — marries
 *     to the group with the matching command string
 *   - Unmatched tool.started at the end → state "starting" (crash cleanup
 *     marks these cancelled server-side)
 */

import type {
  OrchestrationThreadActivity,
  AssembledToolInvocation,
  AssembledCommand,
  AssembledEdit,
  AssembledWrite,
  AssembledFileRead,
  AssembledFileSearch,
  AssembledWebSearch,
  AssembledWebFetch,
  AssembledSubAgent,
  AssembledMcpTool,
  AssembledToolCall,
  CanonicalInlineDiff,
} from "@t3tools/contracts";

import { extractClaudeToolData, extractClaudeInlineDiffs } from "../claude";
import { isRecord } from "../helpers";
import { buildSubAgentTaskLinks } from "../task-linking";

// ---------------------------------------------------------------------------
// Shell wrapper unwrapping (moved from work-log.ts)
// ---------------------------------------------------------------------------

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) return null;
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) return null;
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) return { executable: trimmed, rest: "" };

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) return value;

  const shell = executableBasename(split.executable);
  if (!shell) return value;

  const spec = SHELL_WRAPPER_SPECS.find((s) =>
    (s.executables as ReadonlyArray<string>).includes(shell),
  );
  if (!spec) return value;

  const match = spec.wrapperFlagPattern.exec(split.rest);
  if (!match) return value;

  const command = split.rest.slice(match.index + match[0].length).trim();
  if (command.length === 0) return value;

  const unwrapped = trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : value;
}

function formatCommandForDisplay(command: string): {
  command: string;
  rawCommand: string | undefined;
} {
  const normalized = unwrapKnownShellCommandWrapper(command);
  return {
    command: normalized,
    rawCommand: normalized !== command ? command : undefined,
  };
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

function extractCommandString(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.command === "string" ? input.command : undefined;
}

function extractItemType(payload: unknown): string {
  if (!isRecord(payload)) return "unknown";
  return typeof payload.itemType === "string" ? payload.itemType : "unknown";
}

function extractToolName(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  return typeof data.toolName === "string" ? data.toolName : undefined;
}

// ---------------------------------------------------------------------------
// Result content extraction
// ---------------------------------------------------------------------------

function extractResultContent(
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

// ---------------------------------------------------------------------------
// Command invocation accumulator
// ---------------------------------------------------------------------------

/**
 * Accumulates activities for a single command invocation and produces
 * an AssembledCommand when asked.
 */
interface CommandInvocation {
  itemType: string;
  /** Command string — the grouping key. Undefined until first updated/completed. */
  commandString: string | undefined;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

function finalizeCommand(inv: CommandInvocation): AssembledCommand | null {
  // Find the most informative activity — completed > updated > started
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

  // tool.started only (no updated/completed ever arrived) — emit a
  // "starting" placeholder so the UI can show a spinner.
  if (!bestCanonical || !bestCanonical.input?.command) {
    return {
      kind: "command",
      id: firstId,
      createdAt: firstCreatedAt,
      state: "starting",
      heading: "Command",
      command: "",
    };
  }

  const formatted = formatCommandForDisplay(bestCanonical.input.command);

  const state =
    bestKind === "tool.completed"
      ? bestCanonical.result?.isError
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

  const assembled: AssembledCommand = {
    kind: "command",
    id: firstId,
    createdAt: firstCreatedAt,
    state: state as AssembledCommand["state"],
    heading: "Command",
    command: formatted.command,
  };

  if (formatted.rawCommand) assembled.rawCommand = formatted.rawCommand;
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;

  const resultContent = extractResultContent(bestCanonical.result);
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

// ---------------------------------------------------------------------------
// Command grouping — by command string, not sequence position
// ---------------------------------------------------------------------------

function groupCommandActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): CommandInvocation[] {
  // Queue of tool.started events awaiting a tool.updated to marry them
  const startedQueue: CommandInvocation[] = [];
  // Invocations keyed by command string (for tool.updated ↔ tool.completed matching)
  const byCommandString = new Map<string, CommandInvocation[]>();
  // All invocations in encounter order (for deterministic output)
  const allInvocations: CommandInvocation[] = [];

  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "command_execution") continue;

    if (activity.kind === "tool.started") {
      // No data — create a pending slot
      const inv: CommandInvocation = {
        itemType,
        commandString: undefined,
        activities: [activity],
        hasStarted: true,
        hasCompleted: false,
      };
      startedQueue.push(inv);
      allInvocations.push(inv);
      continue;
    }

    // tool.updated or tool.completed — has command string
    const cmdStr = extractCommandString(activity.payload);

    if (activity.kind === "tool.updated") {
      // Try to marry to the earliest unmatched tool.started
      const pendingStarted = startedQueue.shift();
      if (pendingStarted && pendingStarted.commandString === undefined) {
        // Marry this updated to the pending started
        pendingStarted.commandString = cmdStr;
        pendingStarted.activities.push(activity);
        // Register by command string for future completed matching
        if (cmdStr) {
          let bucket = byCommandString.get(cmdStr);
          if (!bucket) {
            bucket = [];
            byCommandString.set(cmdStr, bucket);
          }
          bucket.push(pendingStarted);
        }
      } else {
        // No pending started (or it was already married) — put it back and
        // check if this updated belongs to an existing invocation by command string.
        // Prefer an incomplete invocation, but also absorb into a completed one
        // (Claude sends duplicate updated events at the same time as completed).
        if (pendingStarted) startedQueue.unshift(pendingStarted);

        let matched = false;
        if (cmdStr) {
          const bucket = byCommandString.get(cmdStr);
          const existing = bucket?.find((inv) => !inv.hasCompleted) ?? bucket?.at(-1);
          if (existing) {
            existing.activities.push(activity);
            matched = true;
          }
        }
        if (!matched) {
          // Standalone updated — create a new invocation
          const inv: CommandInvocation = {
            itemType,
            commandString: cmdStr,
            activities: [activity],
            hasStarted: false,
            hasCompleted: false,
          };
          allInvocations.push(inv);
          if (cmdStr) {
            let bucket = byCommandString.get(cmdStr);
            if (!bucket) {
              bucket = [];
              byCommandString.set(cmdStr, bucket);
            }
            bucket.push(inv);
          }
        }
      }
      continue;
    }

    // tool.completed — find existing invocation by command string
    if (activity.kind === "tool.completed") {
      let matched = false;
      if (cmdStr) {
        const bucket = byCommandString.get(cmdStr);
        const existing = bucket?.find((inv) => !inv.hasCompleted);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        // Standalone completed — create a new invocation
        const inv: CommandInvocation = {
          itemType,
          commandString: cmdStr,
          activities: [activity],
          hasStarted: false,
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (cmdStr) {
          let bucket = byCommandString.get(cmdStr);
          if (!bucket) {
            bucket = [];
            byCommandString.set(cmdStr, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}

// ---------------------------------------------------------------------------
// File change (Edit / Write) invocation accumulator
// ---------------------------------------------------------------------------

/**
 * Accumulates activities for a single file-change invocation (Edit or Write)
 * and produces an AssembledEdit or AssembledWrite when finalised.
 */
interface FileChangeInvocation {
  /** Grouping key — file_path extracted from the updated/completed payload. */
  filePath: string | undefined;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

function extractFilePath(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.file_path === "string" ? input.file_path : undefined;
}

function finalizeFileChange(inv: FileChangeInvocation): AssembledEdit | AssembledWrite | null {
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

// ---------------------------------------------------------------------------
// File change grouping — by file path, FIFO queue for started↔updated
// ---------------------------------------------------------------------------

function groupFileChangeActivities(
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

// ---------------------------------------------------------------------------
// File read (Read tool) invocation accumulator
// ---------------------------------------------------------------------------

/**
 * Accumulates activities for a single Read tool invocation and produces
 * an AssembledFileRead when finalised.
 */
interface FileReadInvocation {
  /** Grouping key — file_path extracted from the updated/completed payload. */
  filePath: string | undefined;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

function finalizeFileRead(inv: FileReadInvocation): AssembledFileRead | null {
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

// ---------------------------------------------------------------------------
// File read grouping — by file path, NO startedQueue
//
// dynamic_tool_call tool.started events have no toolName — they're shared by
// Read, Grep, Glob, WebFetch, etc. We can't claim them for any one tool type
// without stealing from another. So we skip tool.started entirely and only
// create invocations from tool.updated/tool.completed where toolName === "Read".
// ---------------------------------------------------------------------------

function groupFileReadActivities(
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

// ---------------------------------------------------------------------------
// File search (Grep / Glob) invocation accumulator
// ---------------------------------------------------------------------------

const FILE_SEARCH_TOOL_NAMES = new Set(["Grep", "Glob"]);

interface FileSearchInvocation {
  toolName: string | undefined;
  /** Grouping key — pattern string from input. */
  pattern: string | undefined;
  activities: OrchestrationThreadActivity[];
  hasCompleted: boolean;
}

function extractPattern(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.pattern === "string" ? input.pattern : undefined;
}

function extractSearchPath(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.path === "string" ? input.path : undefined;
}

function finalizeFileSearch(inv: FileSearchInvocation): AssembledFileSearch | null {
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

// ---------------------------------------------------------------------------
// File search grouping — by pattern, NO startedQueue (same reason as file-read)
// ---------------------------------------------------------------------------

function groupFileSearchActivities(
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

// ---------------------------------------------------------------------------
// Web search invocation accumulator
// ---------------------------------------------------------------------------

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

function extractQuery(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.query === "string" ? input.query : undefined;
}

function finalizeWebSearch(inv: WebSearchInvocation): AssembledWebSearch | null {
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

// ---------------------------------------------------------------------------
// Web search grouping — by query string, WITH startedQueue
// (itemType "web_search" is unique so tool.started is identifiable)
// ---------------------------------------------------------------------------

function groupWebSearchActivities(
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

// ---------------------------------------------------------------------------
// Web fetch invocation accumulator
// ---------------------------------------------------------------------------

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

function extractUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.url === "string" ? input.url : undefined;
}

function finalizeWebFetch(inv: WebFetchInvocation): AssembledWebFetch | null {
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

// ---------------------------------------------------------------------------
// Web fetch grouping — by URL, NO startedQueue (generic dynamic_tool_call)
// ---------------------------------------------------------------------------

function groupWebFetchActivities(
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

// ---------------------------------------------------------------------------
// Sub-agent (Agent tool) invocation accumulator
// ---------------------------------------------------------------------------

/**
 * collab_agent_tool_call has its own itemType, so tool.started IS identifiable
 * — we can use a startedQueue (same as command/web-search).
 *
 * Grouping key is `description` from `data.input.description`.
 * taskId is grafted via the task-linking helper.
 */
interface SubAgentInvocation {
  /** Grouping key — description from tool.updated data.input.description. */
  description: string | undefined;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

function extractDescription(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.description === "string" ? input.description : undefined;
}

function finalizeSubAgent(
  inv: SubAgentInvocation,
  descriptionToTaskId: Map<string, string>,
): AssembledSubAgent | null {
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
  if (!bestCanonical || !bestCanonical.input?.prompt) {
    return {
      kind: "sub-agent",
      id: firstId,
      createdAt: firstCreatedAt,
      state: "starting",
      heading: "Sub-agent",
      brief: { prompt: "", description: "" },
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

  const description = bestCanonical.input.description ?? "";
  const agentType = bestCanonical.input.subagent_type;

  // Build the heading: "Sub-agent — Explore: description" matching old display
  const typePrefix = agentType ? `${agentType}: ` : "";
  const heading = description ? `Sub-agent — ${typePrefix}${description}` : "Sub-agent";

  const assembled: AssembledSubAgent = {
    kind: "sub-agent",
    id: firstId,
    createdAt: firstCreatedAt,
    state: state as AssembledSubAgent["state"],
    heading,
    brief: {
      prompt: bestCanonical.input.prompt,
      description,
    },
  };

  if (agentType) assembled.brief.agentType = agentType;
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;

  // Graft taskId from the task-linking helper
  if (description) {
    const taskId = descriptionToTaskId.get(description);
    if (taskId) assembled.taskId = taskId;
  }

  const resultContent = extractResultContent(bestCanonical.result);
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

// ---------------------------------------------------------------------------
// Sub-agent grouping — by description, WITH startedQueue
// (itemType "collab_agent_tool_call" is unique so tool.started is identifiable)
// ---------------------------------------------------------------------------

function groupSubAgentActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): SubAgentInvocation[] {
  const startedQueue: SubAgentInvocation[] = [];
  const byDescription = new Map<string, SubAgentInvocation[]>();
  const allInvocations: SubAgentInvocation[] = [];

  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType !== "collab_agent_tool_call") continue;

    if (activity.kind === "tool.started") {
      const inv: SubAgentInvocation = {
        description: undefined,
        activities: [activity],
        hasStarted: true,
        hasCompleted: false,
      };
      startedQueue.push(inv);
      allInvocations.push(inv);
      continue;
    }

    // tool.updated or tool.completed — has description
    const desc = extractDescription(activity.payload);

    if (activity.kind === "tool.updated") {
      const pendingStarted = startedQueue.shift();
      if (pendingStarted && pendingStarted.description === undefined) {
        pendingStarted.description = desc;
        pendingStarted.activities.push(activity);
        if (desc) {
          let bucket = byDescription.get(desc);
          if (!bucket) {
            bucket = [];
            byDescription.set(desc, bucket);
          }
          bucket.push(pendingStarted);
        }
      } else {
        if (pendingStarted) startedQueue.unshift(pendingStarted);

        let matched = false;
        if (desc) {
          const bucket = byDescription.get(desc);
          const existing = bucket?.find((inv) => !inv.hasCompleted) ?? bucket?.at(-1);
          if (existing) {
            existing.activities.push(activity);
            matched = true;
          }
        }
        if (!matched) {
          const inv: SubAgentInvocation = {
            description: desc,
            activities: [activity],
            hasStarted: false,
            hasCompleted: false,
          };
          allInvocations.push(inv);
          if (desc) {
            let bucket = byDescription.get(desc);
            if (!bucket) {
              bucket = [];
              byDescription.set(desc, bucket);
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
      if (desc) {
        const bucket = byDescription.get(desc);
        const existing = bucket?.find((inv) => !inv.hasCompleted);
        if (existing) {
          existing.activities.push(activity);
          existing.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        const inv: SubAgentInvocation = {
          description: desc,
          activities: [activity],
          hasStarted: false,
          hasCompleted: true,
        };
        allInvocations.push(inv);
        if (desc) {
          let bucket = byDescription.get(desc);
          if (!bucket) {
            bucket = [];
            byDescription.set(desc, bucket);
          }
          bucket.push(inv);
        }
      }
    }
  }

  return allInvocations;
}

// ---------------------------------------------------------------------------
// Generic tool-call / MCP tool invocation accumulator
// ---------------------------------------------------------------------------

/**
 * Catches everything not already handled by the specific grouping functions:
 * - `mcp_tool_call` → AssembledMcpTool (has own itemType, so tool.started IS
 *   identifiable — uses a startedQueue)
 * - remaining `dynamic_tool_call` → AssembledToolCall (tool.started is
 *   unidentifiable — skip started, assemble from updated/completed only)
 *
 * Grouping key is `toolName`. Each tool.updated creates a new invocation;
 * tool.completed marries the earliest incomplete invocation with the same
 * toolName (FIFO).
 */

/** The set of dynamic_tool_call toolNames already handled by specific groupers. */
const CLAIMED_DYNAMIC_TOOL_NAMES = new Set(["Read", "Grep", "Glob", "WebFetch"]);

interface GenericToolInvocation {
  toolName: string | undefined;
  itemType: string;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

function finalizeGenericTool(
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

  // tool.started only — no data yet, emit a "starting" placeholder
  if (!bestCanonical) {
    const isMcp = inv.itemType === "mcp_tool_call";
    if (isMcp) {
      return {
        kind: "mcp-tool",
        id: firstId,
        createdAt: firstCreatedAt,
        state: "starting",
        heading: toolName,
        toolName,
      };
    }
    return {
      kind: "tool-call",
      id: firstId,
      createdAt: firstCreatedAt,
      state: "starting",
      heading: toolName,
      toolName,
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

  const heading = toolName !== "unknown" ? toolName : "Tool call";
  const detail = bestCanonical.detail;
  const resultContent = extractResultContent(bestCanonical.result);

  const isMcp = inv.itemType === "mcp_tool_call";

  if (isMcp) {
    const assembled: AssembledMcpTool = {
      kind: "mcp-tool",
      id: firstId,
      createdAt: firstCreatedAt,
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
    state: state as AssembledToolCall["state"],
    heading,
    toolName,
  };
  if (detail) assembled.detail = detail;
  if (bestCanonical.toolCallId) assembled.toolCallId = bestCanonical.toolCallId;
  if (resultContent) assembled.resultContent = resultContent;
  return assembled;
}

function groupGenericToolActivities(
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
        // Try to marry to earliest unmatched MCP started with same toolName
        const pending = mcpStartedQueue.find(
          (inv) => !inv.hasCompleted && inv.toolName === toolName,
        );
        if (pending) {
          pending.activities.push(activity);
          if (toolName) pending.toolName = toolName;
        } else {
          const inv: GenericToolInvocation = {
            toolName,
            itemType,
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
        // Try started queue first
        const pending = mcpStartedQueue.find(
          (inv) => !inv.hasCompleted && inv.toolName === toolName,
        );
        if (pending) {
          pending.activities.push(activity);
          pending.hasCompleted = true;
          if (toolName) pending.toolName = toolName;
        } else {
          // Try byToolName (from orphan updated)
          const bucket = toolName ? byToolName.get(toolName) : undefined;
          const existing = bucket?.find((inv) => !inv.hasCompleted);
          if (existing) {
            existing.activities.push(activity);
            existing.hasCompleted = true;
          } else {
            const inv: GenericToolInvocation = {
              toolName,
              itemType,
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
        const existing = bucket?.find((inv) => !inv.hasCompleted);
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

// ---------------------------------------------------------------------------
// local_bash task activity claiming
// ---------------------------------------------------------------------------

/**
 * Collect task.started and task.completed activity IDs for local_bash tasks.
 * These are redundant with assembled command rows — the command already shows
 * the result. task.progress for sub-agents is NOT claimed.
 */
function collectLocalBashActivityIds(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Set<string> {
  const ids = new Set<string>();

  // First pass: collect taskIds from task.started with taskType "local_bash"
  const localBashTaskIds = new Set<string>();
  for (const activity of activities) {
    if (activity.kind !== "task.started") continue;
    const p = isRecord(activity.payload) ? activity.payload : null;
    if (p && p.taskType === "local_bash" && typeof p.taskId === "string") {
      localBashTaskIds.add(p.taskId);
      ids.add(activity.id);
    }
  }

  // Second pass: claim task.completed whose taskId matches a local_bash task
  if (localBashTaskIds.size > 0) {
    for (const activity of activities) {
      if (activity.kind !== "task.completed") continue;
      const p = isRecord(activity.payload) ? activity.payload : null;
      if (p && typeof p.taskId === "string" && localBashTaskIds.has(p.taskId)) {
        ids.add(activity.id);
      }
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Main assembly entry point
// ---------------------------------------------------------------------------

export interface ClaudeAssemblyResult {
  tools: AssembledToolInvocation[];
  /** Activity IDs claimed by assembly — the work log should exclude these to
   *  avoid duplicate entries. Includes tool lifecycle activities and redundant
   *  local_bash task activities. */
  claimedActivityIds: ReadonlySet<string>;
}

/**
 * Assemble Claude activities into tool invocations.
 *
 * Groups tool lifecycle events by invocation and produces one
 * AssembledToolInvocation per group. Returns the assembled tools plus a set
 * of all activity IDs that were consumed, so the work log can exclude them.
 */
export function assembleClaudeTools(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ClaudeAssemblyResult {
  const commandInvocations = groupCommandActivities(activities);
  const fileChangeInvocations = groupFileChangeActivities(activities);
  const fileReadInvocations = groupFileReadActivities(activities);
  const fileSearchInvocations = groupFileSearchActivities(activities);
  const webSearchInvocations = groupWebSearchActivities(activities);
  const webFetchInvocations = groupWebFetchActivities(activities);
  const subAgentInvocations = groupSubAgentActivities(activities);
  const genericToolInvocations = groupGenericToolActivities(activities);
  const taskLinks = buildSubAgentTaskLinks(activities);
  const assembled: AssembledToolInvocation[] = [];

  // Collect all activity IDs consumed by grouping functions.
  const claimedActivityIds = new Set<string>();

  const allInvocationGroups = [
    commandInvocations,
    fileChangeInvocations,
    fileReadInvocations,
    fileSearchInvocations,
    webSearchInvocations,
    webFetchInvocations,
    subAgentInvocations,
    genericToolInvocations,
  ];
  for (const group of allInvocationGroups) {
    for (const inv of group) {
      for (const activity of inv.activities) {
        claimedActivityIds.add(activity.id);
      }
    }
  }

  // Also claim tool.started activities that weren't grouped (e.g. unidentifiable
  // dynamic_tool_call started events that were skipped). These are noise in the
  // work log — they'd show as empty "started" entries with no data.
  for (const activity of activities) {
    if (activity.kind !== "tool.started") continue;
    const itemType = extractItemType(activity.payload);
    if (
      itemType === "command_execution" ||
      itemType === "file_change" ||
      itemType === "web_search" ||
      itemType === "collab_agent_tool_call" ||
      itemType === "dynamic_tool_call" ||
      itemType === "mcp_tool_call"
    ) {
      claimedActivityIds.add(activity.id);
    }
  }

  // Claim local_bash task activities (redundant with assembled commands).
  const localBashIds = collectLocalBashActivityIds(activities);
  for (const id of localBashIds) {
    claimedActivityIds.add(id);
  }

  for (const inv of commandInvocations) {
    const result = finalizeCommand(inv);
    if (result) assembled.push(result);
  }

  for (const inv of fileChangeInvocations) {
    const result = finalizeFileChange(inv);
    if (result) assembled.push(result);
  }

  for (const inv of fileReadInvocations) {
    const result = finalizeFileRead(inv);
    if (result) assembled.push(result);
  }

  for (const inv of fileSearchInvocations) {
    const result = finalizeFileSearch(inv);
    if (result) assembled.push(result);
  }

  for (const inv of webSearchInvocations) {
    const result = finalizeWebSearch(inv);
    if (result) assembled.push(result);
  }

  for (const inv of webFetchInvocations) {
    const result = finalizeWebFetch(inv);
    if (result) assembled.push(result);
  }

  for (const inv of subAgentInvocations) {
    const result = finalizeSubAgent(inv, taskLinks.descriptionToTaskId);
    if (result) assembled.push(result);
  }

  for (const inv of genericToolInvocations) {
    const result = finalizeGenericTool(inv);
    if (result) assembled.push(result);
  }

  return { tools: assembled, claimedActivityIds };
}
