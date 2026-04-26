/**
 * Main assembly entry point — assembleClaudeTools.
 *
 * Orchestrates all per-tool-type groupers, collects claimed activity IDs,
 * and returns the final assembled tool invocations.
 */

import type { OrchestrationThreadActivity, AssembledToolInvocation } from "@t3tools/contracts";

import { isRecord } from "../../helpers";
import { buildSubAgentTaskLinks } from "../../task-linking";
import { extractItemType, parseHookPrefix } from "./shared";
import { groupCommandActivities, finalizeCommand } from "./command";
import { groupFileChangeActivities, finalizeFileChange } from "./file";
import { groupFileReadActivities, finalizeFileRead } from "./file";
import { groupFileSearchActivities, finalizeFileSearch } from "./file";
import { groupWebSearchActivities, finalizeWebSearch } from "./web";
import { groupWebFetchActivities, finalizeWebFetch } from "./web";
import { groupSubAgentActivities, finalizeSubAgent } from "./sub-agent";
import { groupGenericToolActivities, finalizeGenericTool } from "./generic";

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

  // Post-processing: detect hook-intercepted tool results via ::hook:: prefix.
  // Any tool whose resultContent starts with ::hook::{name}::{status}:: gets
  // hook metadata attached. When status is "ok", override state from "failed"
  // to "completed" — the hook succeeded, it's not an error.
  for (const tool of assembled) {
    if (!("resultContent" in tool) || !tool.resultContent) continue;
    const hookMeta = parseHookPrefix(tool.resultContent);
    if (!hookMeta) continue;
    tool.hook = hookMeta;
    tool.heading = `${tool.heading} · ${hookMeta.name}`;
    if (hookMeta.status === "ok" && tool.state === "failed") {
      tool.state = "completed";
    }
  }

  return { tools: assembled, claimedActivityIds };
}
