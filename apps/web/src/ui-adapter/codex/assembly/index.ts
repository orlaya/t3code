/**
 * Codex assembly orchestrator — assembleCodexTools.
 *
 * Minimal viable assembly:
 *   - command_execution → AssembledCommand
 *   - file_change → AssembledEdit / AssembledWrite (one per file in changes[])
 *   - everything else → AssembledToolCall (generic fallback)
 *
 * Sub-agents (collab_agent_tool_call) are deliberately NOT given special
 * treatment — they go through generic like everything else. Codex sub-agents
 * don't follow a linear timeline; proper UI support needs its own design pass.
 */

import type {
  OrchestrationThreadActivity,
  AssembledToolInvocation,
  AssembledCommand,
  AssembledEdit,
  AssembledWrite,
  AssembledToolCall,
} from "@t3tools/contracts";

import { extractCodexToolData, extractCodexInlineDiffs } from "../extraction";
import {
  extractItemType,
  extractCommandString,
  extractToolCallId,
  extractAggregatedOutput,
  extractExitCode,
  extractDetail,
  extractFileChanges,
} from "./shared";

// ---------------------------------------------------------------------------
// Shell wrapper unwrapping (same logic as Claude — Codex wraps commands too)
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

function unwrapShellCommand(value: string): string {
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

// ---------------------------------------------------------------------------
// Invocation accumulators
// ---------------------------------------------------------------------------

interface ToolInvocation {
  itemType: string;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

// ---------------------------------------------------------------------------
// Command assembly
// ---------------------------------------------------------------------------

function assembleCommand(inv: ToolInvocation): AssembledCommand | null {
  // Find completed activity (has data); fall back to started (no data)
  const completed = inv.activities.find((a) => a.kind === "tool.completed");
  const first = inv.activities[0];
  if (!first) return null;

  if (!completed) {
    // Only tool.started — emit "starting" placeholder
    return {
      kind: "command",
      id: first.id,
      createdAt: first.createdAt,
      state: "starting",
      heading: "Command",
      command: extractDetail(first.payload) ?? "",
    };
  }

  const rawCommand = extractCommandString(completed.payload) ?? extractDetail(completed.payload);
  const displayCommand = rawCommand ? unwrapShellCommand(rawCommand) : "";
  const output = extractAggregatedOutput(completed.payload);
  const exitCode = extractExitCode(completed.payload);

  const state = exitCode !== undefined && exitCode !== 0 ? "failed" : "completed";

  const assembled: AssembledCommand = {
    kind: "command",
    id: first.id,
    createdAt: first.createdAt,
    state,
    heading: "Command",
    command: displayCommand,
  };

  if (rawCommand && displayCommand !== rawCommand) {
    assembled.rawCommand = rawCommand;
  }
  const toolCallId = extractToolCallId(completed.payload);
  if (toolCallId) assembled.toolCallId = toolCallId;
  if (output) assembled.resultContent = output;

  return assembled;
}

// ---------------------------------------------------------------------------
// File change assembly — one AssembledEdit/Write per file in changes[]
// ---------------------------------------------------------------------------

function assembleFileChanges(inv: ToolInvocation): Array<AssembledEdit | AssembledWrite> {
  const completed = inv.activities.find((a) => a.kind === "tool.completed");
  const first = inv.activities[0];
  if (!first) return [];

  if (!completed) {
    // Only tool.started — emit a single "starting" placeholder
    return [
      {
        kind: "edit",
        id: first.id,
        createdAt: first.createdAt,
        state: "starting",
        heading: "Edit",
        filePath: "",
        inlineDiffs: [],
      },
    ];
  }

  const changes = extractFileChanges(completed.payload);
  if (changes.length === 0) {
    // Completed but no parseable changes — generic edit placeholder
    return [
      {
        kind: "edit",
        id: first.id,
        createdAt: first.createdAt,
        state: "completed",
        heading: "Edit",
        filePath: "",
        inlineDiffs: [],
      },
    ];
  }

  // Extract all inline diffs from the completed payload — they cover all files
  const allDiffs = extractCodexInlineDiffs(completed.payload);
  const toolCallId = extractToolCallId(completed.payload);

  // Split into one assembled invocation per file
  return changes.map((change, index) => {
    const diffsForFile = allDiffs.filter((d) => d.filePath === change.path);
    // Use a stable unique ID per file within the invocation
    const id = index === 0 ? first.id : `${first.id}:file-${String(index)}`;

    if (change.changeKind === "add") {
      const assembled: AssembledWrite = {
        kind: "write",
        id,
        createdAt: first.createdAt,
        state: "completed",
        heading: "Write",
        filePath: change.path,
      };
      if (toolCallId) assembled.toolCallId = toolCallId;
      // For add, the diff content IS the file content
      if (change.diff) assembled.content = change.diff;
      return assembled;
    }

    // update / delete / move → Edit
    const assembled: AssembledEdit = {
      kind: "edit",
      id,
      createdAt: first.createdAt,
      state: "completed",
      heading: "Edit",
      filePath: change.path,
      inlineDiffs: diffsForFile,
    };
    if (toolCallId) assembled.toolCallId = toolCallId;
    return assembled;
  });
}

// ---------------------------------------------------------------------------
// Generic tool assembly — everything else
// ---------------------------------------------------------------------------

function assembleGenericTool(inv: ToolInvocation): AssembledToolCall | null {
  // Prefer completed, fall back to started
  const completed = inv.activities.find((a) => a.kind === "tool.completed");
  const first = inv.activities[0];
  if (!first) return null;

  const bestPayload = completed?.payload ?? first.payload;
  const canonical = extractCodexToolData(bestPayload);

  if (!canonical) {
    return {
      kind: "tool-call",
      id: first.id,
      createdAt: first.createdAt,
      state: completed ? "completed" : "starting",
      heading: "Tool",
      toolName: "Tool",
    };
  }

  const state = completed ? (canonical.result?.isError ? "failed" : "completed") : "in-progress";

  const assembled: AssembledToolCall = {
    kind: "tool-call",
    id: first.id,
    createdAt: first.createdAt,
    state,
    heading: canonical.toolName !== "unknown" ? canonical.toolName : "Tool",
    toolName: canonical.toolName,
  };

  if (canonical.detail) assembled.detail = canonical.detail;
  if (canonical.toolCallId) assembled.toolCallId = canonical.toolCallId;

  const resultContent =
    typeof canonical.result?.content === "string" ? canonical.result.content.trim() : undefined;
  if (resultContent) assembled.resultContent = resultContent;

  return assembled;
}

// ---------------------------------------------------------------------------
// Main assembly entry point
// ---------------------------------------------------------------------------

export interface CodexAssemblyResult {
  tools: AssembledToolInvocation[];
  claimedActivityIds: ReadonlySet<string>;
}

export function assembleCodexTools(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): CodexAssemblyResult {
  // Group tool lifecycle activities into invocations by FIFO matching
  const invocations: ToolInvocation[] = [];
  const startedQueue = new Map<string, ToolInvocation[]>();

  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }

    const itemType = extractItemType(activity.payload);
    if (itemType === "unknown") continue;

    if (activity.kind === "tool.started") {
      const inv: ToolInvocation = {
        itemType,
        activities: [activity],
        hasStarted: true,
        hasCompleted: false,
      };
      invocations.push(inv);

      let queue = startedQueue.get(itemType);
      if (!queue) {
        queue = [];
        startedQueue.set(itemType, queue);
      }
      queue.push(inv);
      continue;
    }

    // tool.updated or tool.completed — try to marry to earliest unmatched started
    const queue = startedQueue.get(itemType);
    const pending = queue?.find((inv) => !inv.hasCompleted);

    if (pending) {
      pending.activities.push(activity);
      if (activity.kind === "tool.completed") {
        pending.hasCompleted = true;
      }
    } else {
      // Standalone updated/completed — create a new invocation
      const inv: ToolInvocation = {
        itemType,
        activities: [activity],
        hasStarted: false,
        hasCompleted: activity.kind === "tool.completed",
      };
      invocations.push(inv);
    }
  }

  // Assemble each invocation into the appropriate type
  const tools: AssembledToolInvocation[] = [];
  const claimedActivityIds = new Set<string>();

  for (const inv of invocations) {
    // Claim all activities in the invocation
    for (const activity of inv.activities) {
      claimedActivityIds.add(activity.id);
    }

    switch (inv.itemType) {
      case "command_execution": {
        const result = assembleCommand(inv);
        if (result) tools.push(result);
        break;
      }
      case "file_change": {
        const results = assembleFileChanges(inv);
        for (const result of results) {
          tools.push(result);
        }
        break;
      }
      default: {
        const result = assembleGenericTool(inv);
        if (result) tools.push(result);
        break;
      }
    }
  }

  return { tools, claimedActivityIds };
}
