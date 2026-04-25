/**
 * Command (command_execution) — grouping and assembly.
 *
 * Grouping strategy:
 *   - tool.started has NO data (just itemType) — creates a pending slot
 *   - tool.updated has data.input.command — marries to earliest unmatched
 *     tool.started of the same itemType, keyed by command string
 *   - tool.completed has data.input.command + result.tool_use_id — marries
 *     to the group with the matching command string
 *   - Unmatched tool.started at the end → state "starting"
 */

import type { OrchestrationThreadActivity, AssembledCommand } from "@t3tools/contracts";

import { extractClaudeToolData } from "../extraction";
import {
  extractCommandString,
  extractItemType,
  extractResultContent,
  shiftMatchingTurnId,
} from "./shared";

// ---------------------------------------------------------------------------
// Shell wrapper unwrapping
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
// Command invocation accumulator
// ---------------------------------------------------------------------------

interface CommandInvocation {
  itemType: string;
  /** Command string — the grouping key. Undefined until first updated/completed. */
  commandString: string | undefined;
  turnId: string | null;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

export function finalizeCommand(inv: CommandInvocation): AssembledCommand | null {
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
  // If tool.completed arrived with status "failed" (interrupted mid-stream),
  // mark as interrupted instead of leaving it stuck as starting.
  if (!bestCanonical || !bestCanonical.input?.command) {
    const wasInterrupted = bestKind === "tool.completed";
    return {
      kind: "command",
      id: firstId,
      createdAt: firstCreatedAt,
      turnId: inv.turnId,
      state: wasInterrupted ? "interrupted" : "starting",
      heading: "Command",
      command: "",
    };
  }

  const formatted = formatCommandForDisplay(bestCanonical.input.command);

  const state =
    bestKind === "tool.completed"
      ? bestCanonical.result?.isError || bestCanonical.status === "failed"
        ? "failed"
        : "completed"
      : bestKind === "tool.updated"
        ? "in-progress"
        : "starting";

  const assembled: AssembledCommand = {
    kind: "command",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
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

export function groupCommandActivities(
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
        turnId: activity.turnId,
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
      // Try to marry to the earliest unmatched tool.started from the same turn
      const pendingStarted = shiftMatchingTurnId(startedQueue, activity.turnId);
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
            turnId: activity.turnId,
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
      // Fallback: match by turnId against the startedQueue (handles interrupted
      // tools where tool.completed arrives with empty input/no command string).
      if (!matched) {
        const pendingStarted = shiftMatchingTurnId(startedQueue, activity.turnId);
        if (pendingStarted) {
          pendingStarted.activities.push(activity);
          pendingStarted.hasCompleted = true;
          matched = true;
        }
      }
      if (!matched) {
        // Standalone completed — create a new invocation
        const inv: CommandInvocation = {
          itemType,
          commandString: cmdStr,
          turnId: activity.turnId,
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
