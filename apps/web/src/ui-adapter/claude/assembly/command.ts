/**
 * Command (command_execution) — grouping and assembly.
 *
 * Grouping strategy: every tool.started / tool.updated / tool.completed for a
 * single command carries the same `providerItemId` (Claude's `tool_use_id`)
 * stamped on by the orchestration projector. We bucket activities by that id;
 * activities without a providerItemId are dropped (they're either pre-projector
 * legacy events or non-Claude events that shouldn't reach this grouper).
 */

import type { OrchestrationThreadActivity, AssembledCommand } from "@t3tools/contracts";

import {
  deriveAssembledState,
  extractResultContent,
  groupByProviderItemId,
  summarizeInvocation,
  type ProviderItemInvocation,
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
// Finalize / group
// ---------------------------------------------------------------------------

export function finalizeCommand(inv: ProviderItemInvocation): AssembledCommand | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind } = summary;

  // tool.started only (no updated/completed ever arrived) — emit a
  // "starting" placeholder. If tool.completed arrived with status "failed"
  // (interrupted mid-stream), mark as interrupted instead.
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
  const state = deriveAssembledState(bestCanonical, bestKind);

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

export function groupCommandActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ProviderItemInvocation[] {
  return groupByProviderItemId(activities, "command_execution");
}
