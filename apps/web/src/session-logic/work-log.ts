/**
 * Work log derivation — LEGACY, being replaced by the assembly layer.
 *
 * DO NOT ADD NEW LOGIC TO THIS FILE. Claude already goes entirely through the
 * assembly path (ui-adapter/claude/assembly.ts). This file only remains for
 * providers that haven't been migrated yet (Codex, OpenCode, Cursor). As each
 * provider gets its own assembly, it will stop hitting this file. Once all
 * providers are migrated, this file and the WorkLogEntry type get deleted.
 *
 * The assembly layer returns a set of claimed activity IDs. Those are excluded
 * here via the `excludeActivityIds` parameter so the work log never duplicates
 * what assembly already handles. This keeps the file provider-agnostic — it
 * does not know or care which provider claimed which activities.
 *
 * Transforms raw activity streams into WorkLogEntry[] for the UI. Uses the
 * UI adapter to extract canonical tool data instead of digging into
 * provider-specific payload shapes.
 *
 * The collapse/merge machinery handles the fact that a single tool invocation
 * produces multiple activities (started → updated → completed) and collapses
 * them into a single work log entry where possible.
 */

import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  extractInlineDiffs,
  extractToolData,
  normalizeCompactToolLabel,
  resolveToolDisplayPresentation,
} from "../ui-adapter";
import type { WorkLogEntry } from "./types";
import { compareActivitiesByOrder } from "./helpers";

// ---------------------------------------------------------------------------
// Internal type — not exported
// ---------------------------------------------------------------------------

interface DerivedWorkLogEntry extends WorkLogEntry {
  activityKind: OrchestrationThreadActivity["kind"];
  collapseKey?: string;
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Command display formatting (shell wrapper unwrapping)
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

/**
 * Format a command string for display — unwrap shell wrappers, produce both
 * the normalised display command and the raw original (when they differ).
 */
function formatCommandForDisplay(command: string | undefined): {
  command: string | null;
  rawCommand: string | null;
} {
  if (!command) return { command: null, rawCommand: null };
  const normalized = unwrapKnownShellCommandWrapper(command);
  return {
    command: normalized,
    rawCommand: normalized !== command ? command : null,
  };
}

// ---------------------------------------------------------------------------
// Exit code stripping
// ---------------------------------------------------------------------------

function stripTrailingExitCode(value: string): {
  output: string | null;
  exitCode?: number | undefined;
} {
  const trimmed = value.trim();
  const match = /^(?<output>[\s\S]*?)(?:\s*<exited with exit code (?<code>\d+)>)\s*$/i.exec(
    trimmed,
  );
  if (!match?.groups) {
    return { output: trimmed.length > 0 ? trimmed : null };
  }
  const exitCode = Number.parseInt(match.groups.code ?? "", 10);
  const normalizedOutput = match.groups.output?.trim() ?? "";
  return {
    output: normalizedOutput.length > 0 ? normalizedOutput : null,
    ...(Number.isInteger(exitCode) ? { exitCode } : {}),
  };
}

// ---------------------------------------------------------------------------
// Detail display formatting
// ---------------------------------------------------------------------------

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateInlinePreview(value: string, maxLength = 84): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizePreviewForComparison(value: string | null | undefined): string | null {
  const normalized = asTrimmedString(value);
  if (!normalized) return null;
  return normalizeCompactToolLabel(normalizeInlinePreview(normalized)).toLowerCase();
}

function summarizeToolTextOutput(value: string): string | null {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => normalizeInlinePreview(line))
    .filter((line) => line.length > 0);
  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) return truncateInlinePreview(firstLine);
  if (lines.length > 1) return `${lines.length.toLocaleString()} lines`;
  return null;
}

/**
 * Summarise rawOutput from a payload — used as a detail fallback when the
 * canonical detail duplicates the heading. This accesses raw payload data
 * that the canonical shape doesn't model (totalFiles, truncated, etc).
 */
function summarizeToolRawOutput(payload: Record<string, unknown> | null): string | null {
  const data = asRecord(payload?.data);
  const rawOutput = asRecord(data?.rawOutput);
  if (!rawOutput) return null;

  const totalFiles = asNumber(rawOutput.totalFiles);
  if (totalFiles !== null) {
    const suffix = rawOutput.truncated === true ? "+" : "";
    return `${totalFiles.toLocaleString()} file${totalFiles === 1 ? "" : "s"}${suffix}`;
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) return summarizeToolTextOutput(content);

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) return summarizeToolTextOutput(stdout);

  return null;
}

/**
 * Format the detail string for display. Strips placeholder values, trailing
 * exit codes, and deduplicates against the heading. Falls back to rawOutput
 * summary when the detail is redundant.
 */
function formatDetailForDisplay(
  canonicalDetail: string | undefined,
  heading: string,
  rawPayload: Record<string, unknown> | null,
  isCommandExecution: boolean,
): string | null {
  const rawDetail = asTrimmedString(canonicalDetail);
  // tool.started events use "{}" as a placeholder detail — skip it.
  const detail = rawDetail && rawDetail !== "{}" ? stripTrailingExitCode(rawDetail).output : null;
  const normalizedHeading = normalizePreviewForComparison(heading);
  const normalizedDetail = normalizePreviewForComparison(detail);

  if (detail && normalizedHeading !== normalizedDetail) {
    return detail;
  }

  // Command tools don't need rawOutput fallback.
  if (isCommandExecution) return null;

  const rawOutputSummary = summarizeToolRawOutput(rawPayload);
  if (rawOutputSummary) {
    const normalizedRawOutputSummary = normalizePreviewForComparison(rawOutputSummary);
    if (normalizedRawOutputSummary !== normalizedHeading) {
      return rawOutputSummary;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Request kind extraction (for approval-like entries in the work log)
// ---------------------------------------------------------------------------

function requestKindFromRequestType(requestType: unknown): WorkLogEntry["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function extractWorkLogRequestKind(
  payload: Record<string, unknown> | null,
): WorkLogEntry["requestKind"] | undefined {
  if (
    payload?.requestKind === "command" ||
    payload?.requestKind === "file-read" ||
    payload?.requestKind === "file-change" ||
    payload?.requestKind === "tool-call"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload?.requestType) ?? undefined;
}

function deriveToolLifecycleCollapseKey(entry: DerivedWorkLogEntry): string | undefined {
  if (entry.activityKind !== "tool.updated" && entry.activityKind !== "tool.completed") {
    return undefined;
  }
  if (entry.toolCallId) {
    return `tool:${entry.toolCallId}`;
  }
  const normalizedLabel = normalizeCompactToolLabel(entry.toolTitle ?? entry.label);
  const detail = entry.detail?.trim() ?? "";
  const itemType = entry.itemType ?? "";
  if (normalizedLabel.length === 0 && detail.length === 0 && itemType.length === 0) {
    return undefined;
  }
  return [itemType, normalizedLabel, detail].join("\u001f");
}

// ---------------------------------------------------------------------------
// Activity → DerivedWorkLogEntry (the core mapping)
// ---------------------------------------------------------------------------

function toDerivedWorkLogEntry(
  activity: OrchestrationThreadActivity,
  providerName: string,
): DerivedWorkLogEntry {
  const payload = asRecord(activity.payload);
  const canonical = extractToolData(activity.payload, providerName);
  const inlineDiffs = extractInlineDiffs(activity.payload, providerName);
  const isTaskActivity = activity.kind === "task.progress" || activity.kind === "task.completed";

  // --- Task activities (task.progress / task.completed) ---
  // These are NOT tool activities — extractToolData returns null for them.
  // They carry their own summary/detail in the raw payload.
  if (isTaskActivity) {
    const taskSummary =
      typeof payload?.summary === "string" && payload.summary.length > 0 ? payload.summary : null;
    const taskDetailAsLabel =
      !taskSummary && typeof payload?.detail === "string" && payload.detail.length > 0
        ? payload.detail
        : null;
    const taskLabel = taskSummary || taskDetailAsLabel;
    const detail =
      !taskDetailAsLabel &&
      payload &&
      typeof payload.detail === "string" &&
      payload.detail.length > 0
        ? stripTrailingExitCode(payload.detail).output
        : null;

    const entry: DerivedWorkLogEntry = {
      id: activity.id,
      createdAt: activity.createdAt,
      label: taskLabel || activity.summary,
      tone:
        activity.kind === "task.progress"
          ? "thinking"
          : activity.tone === "approval"
            ? "info"
            : activity.tone,
      activityKind: activity.kind,
    };
    if (detail) entry.detail = detail;
    if (payload && typeof payload.taskId === "string") entry.taskId = payload.taskId;
    const collapseKey = deriveToolLifecycleCollapseKey(entry);
    if (collapseKey) entry.collapseKey = collapseKey;
    return entry;
  }

  // --- Tool activities (with canonical data from UI adapter) ---
  if (canonical) {
    const presentation = resolveToolDisplayPresentation({ tool: canonical, providerName });
    const heading = canonical.toolName !== "unknown" ? canonical.toolName : activity.summary;
    const commandPreview = formatCommandForDisplay(canonical.input?.command);
    const detail = formatDetailForDisplay(
      canonical.detail,
      heading,
      payload,
      canonical.itemType === "command_execution",
    );

    const entry: DerivedWorkLogEntry = {
      id: activity.id,
      createdAt: activity.createdAt,
      label: activity.summary,
      tone: activity.tone === "approval" ? "info" : activity.tone,
      activityKind: activity.kind,
    };

    if (detail) entry.detail = detail;
    if (commandPreview.command) entry.command = commandPreview.command;
    if (commandPreview.rawCommand) entry.rawCommand = commandPreview.rawCommand;
    const changedFiles = inlineDiffs.map((diff) => diff.filePath);
    if (changedFiles.length > 0) {
      entry.changedFiles = Array.from(new Set(changedFiles));
    } else if (canonical.input?.file_path) {
      entry.changedFiles = [canonical.input.file_path];
    }
    if (canonical.toolName !== "unknown") entry.toolTitle = canonical.toolName;
    entry.displayKind = presentation.displayKind;
    entry.displayHeading = presentation.heading;
    entry.lifecycleShape = presentation.lifecycleShape;
    entry.displayCapabilities = presentation.capabilities;
    entry.itemType = canonical.itemType;
    if (canonical.toolCallId) entry.toolCallId = canonical.toolCallId;

    // Sub-agent brief
    if (canonical.itemType === "collab_agent_tool_call" && canonical.input?.prompt) {
      entry.subAgentBrief = {
        prompt: canonical.input.prompt,
        description: canonical.input.description ?? entry.label,
        ...(canonical.input.subagent_type ? { agentType: canonical.input.subagent_type } : {}),
      };
    }

    // Sub-agent result (content block array)
    if (canonical.itemType === "collab_agent_tool_call" && canonical.result?.content) {
      const content = canonical.result.content;
      if (Array.isArray(content)) {
        const textBlock = content.find(
          (block) => block.type === "text" && typeof block.text === "string",
        );
        if (textBlock?.text) {
          entry.subAgentResult = textBlock.text;
        }
      }
    }

    // Result content (for non-sub-agent tools: bash output, grep results, etc.)
    if (
      (activity.kind === "tool.completed" || activity.kind === "tool.updated") &&
      !entry.subAgentResult &&
      canonical.result
    ) {
      const content = canonical.result.content;
      if (typeof content === "string") {
        const trimmed = content.trim();
        if (trimmed.length > 0) entry.resultContent = trimmed;
      }
    }

    const requestKind = extractWorkLogRequestKind(payload);
    if (requestKind) entry.requestKind = requestKind;

    const collapseKey = deriveToolLifecycleCollapseKey(entry);
    if (collapseKey) entry.collapseKey = collapseKey;
    return entry;
  }

  // --- Non-tool, non-task activities (compaction, approvals, etc.) ---
  // Fallback to raw payload for summary/detail.
  const title = asTrimmedString(payload?.title);
  const detail = asTrimmedString(payload?.detail);

  const entry: DerivedWorkLogEntry = {
    id: activity.id,
    createdAt: activity.createdAt,
    label: activity.summary,
    tone: activity.tone === "approval" ? "info" : activity.tone,
    activityKind: activity.kind,
  };

  if (detail && detail !== "{}") {
    const stripped = stripTrailingExitCode(detail).output;
    if (stripped) entry.detail = stripped;
  }
  if (title) entry.toolTitle = title;

  const requestKind = extractWorkLogRequestKind(payload);
  if (requestKind) entry.requestKind = requestKind;

  const collapseKey = deriveToolLifecycleCollapseKey(entry);
  if (collapseKey) entry.collapseKey = collapseKey;
  return entry;
}

// ---------------------------------------------------------------------------
// Plan boundary detection
// ---------------------------------------------------------------------------

function isPlanBoundaryToolActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "tool.updated" && activity.kind !== "tool.completed") {
    return false;
  }
  const payload = asRecord(activity.payload);
  return typeof payload?.detail === "string" && payload.detail.startsWith("ExitPlanMode:");
}

// ---------------------------------------------------------------------------
// Collapse / merge machinery
// ---------------------------------------------------------------------------

function collapseDerivedWorkLogEntries(
  entries: ReadonlyArray<DerivedWorkLogEntry>,
): DerivedWorkLogEntry[] {
  const collapsed: DerivedWorkLogEntry[] = [];
  for (const entry of entries) {
    const previous = collapsed.at(-1);
    if (previous && shouldCollapseToolLifecycleEntries(previous, entry)) {
      collapsed[collapsed.length - 1] = mergeDerivedWorkLogEntries(previous, entry);
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed;
}

function shouldCollapseToolLifecycleEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): boolean {
  // tool.started → tool.updated collapse for file_change and collab_agent_tool_call.
  // tool.started has no collapseKey or toolCallId, so match by itemType.
  if (
    previous.activityKind === "tool.started" &&
    (next.activityKind === "tool.updated" || next.activityKind === "tool.completed") &&
    previous.itemType === next.itemType &&
    (previous.itemType === "file_change" || previous.itemType === "collab_agent_tool_call")
  ) {
    return true;
  }

  if (previous.activityKind !== "tool.updated" && previous.activityKind !== "tool.completed") {
    return false;
  }
  if (next.activityKind !== "tool.updated" && next.activityKind !== "tool.completed") {
    return false;
  }
  if (previous.activityKind === "tool.completed") {
    return false;
  }
  if (previous.collapseKey !== undefined && previous.collapseKey === next.collapseKey) {
    return true;
  }
  // When one side has a toolCallId and the other doesn't (e.g. Claude's
  // tool.updated has no id but tool.completed carries tool_use_id), fall
  // back to matching by itemType + label.
  if (
    previous.itemType === next.itemType &&
    (previous.toolCallId === undefined) !== (next.toolCallId === undefined) &&
    normalizeCompactToolLabel(previous.toolTitle ?? previous.label) ===
      normalizeCompactToolLabel(next.toolTitle ?? next.label)
  ) {
    return true;
  }
  return false;
}

function mergeDerivedWorkLogEntries(
  previous: DerivedWorkLogEntry,
  next: DerivedWorkLogEntry,
): DerivedWorkLogEntry {
  const changedFiles = mergeChangedFiles(previous.changedFiles, next.changedFiles);
  const detail = next.detail ?? previous.detail;
  const command = next.command ?? previous.command;
  const rawCommand = next.rawCommand ?? previous.rawCommand;
  const toolTitle = next.toolTitle ?? previous.toolTitle;
  const displayKind = next.displayKind ?? previous.displayKind;
  const displayHeading = next.displayHeading ?? previous.displayHeading;
  const lifecycleShape = next.lifecycleShape ?? previous.lifecycleShape;
  const displayCapabilities = next.displayCapabilities ?? previous.displayCapabilities;
  const itemType = next.itemType ?? previous.itemType;
  const requestKind = next.requestKind ?? previous.requestKind;
  const collapseKey = next.collapseKey ?? previous.collapseKey;
  const toolCallId = next.toolCallId ?? previous.toolCallId;
  return {
    ...previous,
    ...next,
    ...(detail ? { detail } : {}),
    ...(command ? { command } : {}),
    ...(rawCommand ? { rawCommand } : {}),
    ...(changedFiles.length > 0 ? { changedFiles } : {}),
    ...(toolTitle ? { toolTitle } : {}),
    ...(displayKind ? { displayKind } : {}),
    ...(displayHeading ? { displayHeading } : {}),
    ...(lifecycleShape ? { lifecycleShape } : {}),
    ...(displayCapabilities ? { displayCapabilities } : {}),
    ...(itemType ? { itemType } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(collapseKey ? { collapseKey } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
}

function mergeChangedFiles(
  previous: ReadonlyArray<string> | undefined,
  next: ReadonlyArray<string> | undefined,
): string[] {
  const merged = [...(previous ?? []), ...(next ?? [])];
  if (merged.length === 0) return [];
  return [...new Set(merged)];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function deriveWorkLogEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  visibleTurnIds: Set<TurnId> | TurnId | undefined,
  providerName: string,
  /** Activity IDs claimed by the assembly layer — these are excluded from the
   *  work log to avoid duplicate entries. Provider-agnostic: the assembly layer
   *  decides what it handles and returns the IDs, work-log just respects them. */
  excludeActivityIds?: ReadonlySet<string>,
): WorkLogEntry[] {
  const ordered = [...activities].toSorted(compareActivitiesByOrder);
  const entries = ordered
    .filter((activity) => {
      if (excludeActivityIds && excludeActivityIds.has(activity.id)) return false;
      return true;
    })
    .filter((activity) => {
      if (visibleTurnIds === undefined) return true;
      if (visibleTurnIds instanceof Set)
        return activity.turnId !== null && visibleTurnIds.has(activity.turnId);
      return activity.turnId === visibleTurnIds;
    })
    .filter((activity) => {
      if (activity.kind !== "tool.started") return true;
      const p = activity.payload as Record<string, unknown> | null;
      const itemType = p?.itemType;
      return itemType === "file_change" || itemType === "collab_agent_tool_call";
    })
    .filter((activity) => activity.kind !== "task.started")
    .filter((activity) => activity.kind !== "context-window.updated")
    .filter((activity) => activity.kind !== "provider.approval.respond.failed")
    .filter((activity) => activity.kind !== "provider.user-input.respond.failed")
    .filter((activity) => activity.summary !== "Checkpoint captured")
    .filter((activity) => !isPlanBoundaryToolActivity(activity))
    .map((activity) => toDerivedWorkLogEntry(activity, providerName));
  const collapsed = collapseDerivedWorkLogEntries(entries);

  // Drop tool.started entries for sub-agents that have been superseded by
  // a tool.updated (task.progress entries prevent adjacency collapse).
  // Each tool.updated consumes the earliest unmatched tool.started.
  const supersededSubAgentStartedIds = new Set<string>();
  {
    const startedQueue: string[] = [];
    for (const entry of collapsed) {
      if (entry.itemType !== "collab_agent_tool_call") continue;
      if (entry.activityKind === "tool.started") {
        startedQueue.push(entry.id);
      } else if (
        (entry.activityKind === "tool.updated" || entry.activityKind === "tool.completed") &&
        startedQueue.length > 0
      ) {
        supersededSubAgentStartedIds.add(startedQueue.shift()!);
      }
    }
  }

  // The tool.updated and tool.completed for a collab_agent_tool_call are
  // usually NOT consecutive (task.progress entries sit between them), so
  // they don't collapse into one entry. Collect identifiers of completed
  // sub-agents so we can mark the remaining tool.updated entries as done.
  const completedSubAgentKeys = new Set<string>();
  const completedSubAgentTaskIds = new Set<string>();
  const updatedSubAgentIdByKey = new Map<string, string>();
  for (const entry of collapsed) {
    if (entry.itemType === "collab_agent_tool_call" && entry.activityKind === "tool.completed") {
      if (entry.toolCallId) completedSubAgentKeys.add(entry.toolCallId);
      if (entry.collapseKey) completedSubAgentKeys.add(entry.collapseKey);
    }
    if (entry.itemType === "collab_agent_tool_call" && entry.activityKind !== "tool.completed") {
      if (entry.toolCallId) updatedSubAgentIdByKey.set(entry.toolCallId, entry.id);
      if (entry.collapseKey) updatedSubAgentIdByKey.set(entry.collapseKey, entry.id);
    }
  }

  // Build a map from subagent description → taskId using task.started activities.
  const taskStartedByDetail = new Map<string, string>();
  for (const activity of ordered) {
    if (activity.kind !== "task.started") continue;
    const p = asRecord(activity.payload);
    if (p && typeof p.taskId === "string" && typeof p.detail === "string") {
      taskStartedByDetail.set(p.detail, p.taskId);
    }
  }
  for (const entry of collapsed) {
    if (entry.itemType === "collab_agent_tool_call" && entry.subAgentBrief) {
      const matchedTaskId = taskStartedByDetail.get(entry.subAgentBrief.description);
      if (matchedTaskId) entry.taskId = matchedTaskId;
    }
  }

  // Build taskId-based fallbacks for filtering and ID transfer.
  const updatedSubAgentIdByTaskId = new Map<string, string>();
  for (const entry of collapsed) {
    if (entry.itemType !== "collab_agent_tool_call" || !entry.taskId) continue;
    if (entry.activityKind === "tool.completed") {
      completedSubAgentTaskIds.add(entry.taskId);
    } else {
      updatedSubAgentIdByTaskId.set(entry.taskId, entry.id);
    }
  }

  // Non-sub-agent tools: when task events break the collapse chain, we can end
  // up with both a tool.updated and a tool.completed for the same tool call.
  // Keep the tool.updated (renders first with spinner) and graft the completed's
  // result data onto it, then drop the tool.completed.
  const completedToolEntryIdsToDrop = new Set<string>();
  const graftedToolEntryIds = new Set<string>();
  for (let index = 0; index < collapsed.length - 1; index += 1) {
    const current = collapsed[index];
    const next = collapsed[index + 1];
    if (!current || !next) continue;
    if (current.itemType === "collab_agent_tool_call" || next.itemType === "collab_agent_tool_call")
      continue;
    if (current.activityKind !== "tool.updated" || next.activityKind !== "tool.completed") continue;

    const sameInvocation =
      (current.toolCallId !== undefined &&
        next.toolCallId !== undefined &&
        current.toolCallId === next.toolCallId) ||
      (current.itemType === next.itemType &&
        current.detail === next.detail &&
        normalizeCompactToolLabel(current.toolTitle ?? current.label) ===
          normalizeCompactToolLabel(next.toolTitle ?? next.label));
    if (!sameInvocation) continue;

    if (next.resultContent) current.resultContent = next.resultContent;
    completedToolEntryIdsToDrop.add(next.id);
    graftedToolEntryIds.add(current.id);
  }

  // Context compaction: drop "compacting" entries that have a corresponding
  // "compacted" after them. Keep the last "compacting" if no subsequent "compacted".
  const lastCompaction = collapsed.findLast((e) => e.activityKind === "context-compaction");
  const activeCompactingId =
    lastCompaction?.label === "Context compacting" ? lastCompaction.id : null;

  return collapsed
    .filter((entry) => {
      if (
        entry.activityKind === "context-compaction" &&
        entry.label === "Context compacting" &&
        entry.id !== activeCompactingId
      ) {
        return false;
      }
      if (supersededSubAgentStartedIds.has(entry.id)) {
        return false;
      }
      if (
        entry.itemType === "collab_agent_tool_call" &&
        entry.activityKind !== "tool.completed" &&
        ((entry.toolCallId && completedSubAgentKeys.has(entry.toolCallId)) ||
          (entry.collapseKey && completedSubAgentKeys.has(entry.collapseKey)) ||
          (entry.taskId && completedSubAgentTaskIds.has(entry.taskId)))
      ) {
        return false;
      }
      if (
        entry.itemType !== "collab_agent_tool_call" &&
        entry.activityKind === "tool.completed" &&
        completedToolEntryIdsToDrop.has(entry.id)
      ) {
        return false;
      }
      return true;
    })
    .map(({ activityKind, collapseKey, ...entry }) => {
      if (entry.itemType === "collab_agent_tool_call" && activityKind !== "tool.completed") {
        entry.isSubAgentInProgress = true;
      }
      if (entry.itemType === "collab_agent_tool_call" && activityKind === "tool.completed") {
        const originalId =
          (entry.toolCallId && updatedSubAgentIdByKey.get(entry.toolCallId)) ||
          (collapseKey && updatedSubAgentIdByKey.get(collapseKey)) ||
          (entry.taskId && updatedSubAgentIdByTaskId.get(entry.taskId));
        if (originalId) entry.id = originalId;
      }
      if (
        entry.itemType !== "collab_agent_tool_call" &&
        (activityKind === "tool.updated" || activityKind === "tool.started") &&
        !graftedToolEntryIds.has(entry.id)
      ) {
        entry.isToolInProgress = true;
      }
      if (activityKind === "context-compaction" && entry.label === "Context compacting") {
        entry.isCompacting = true;
      }
      if (activityKind === "context-compaction" && entry.label === "Context compacted") {
        entry.isCompacted = true;
      }
      return entry;
    });
}
