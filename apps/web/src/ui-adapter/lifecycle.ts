/**
 * Tool lifecycle declarations per provider.
 *
 * Declares which activity kinds each provider emits for each tool type,
 * and whether the tool is tracked (has a start and expects a completion).
 *
 * Used for:
 * - Determining if a tool is "in progress" (has started but not completed)
 * - Crash cleanup: finding orphaned tracked tools and marking them cancelled
 * - Knowing whether to expect a "tool.started" event (ACP doesn't emit one)
 */

import type { ProviderLifecycleMap } from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const TRACKED_STANDARD = {
  lifecycle: "tracked" as const,
  events: ["tool.started", "tool.updated", "tool.completed"],
};

export const claudeLifecycles: ProviderLifecycleMap = {
  command_execution: TRACKED_STANDARD,
  file_change: TRACKED_STANDARD,
  collab_agent_tool_call: TRACKED_STANDARD,
  dynamic_tool_call: TRACKED_STANDARD,
  mcp_tool_call: TRACKED_STANDARD,
  web_search: TRACKED_STANDARD,
  image_view: TRACKED_STANDARD,
};

// ---------------------------------------------------------------------------
// ACP / Cursor — no tool.started event
// ---------------------------------------------------------------------------

const TRACKED_NO_STARTED = {
  lifecycle: "tracked" as const,
  events: ["tool.updated", "tool.completed"],
};

export const cursorLifecycles: ProviderLifecycleMap = {
  command_execution: TRACKED_NO_STARTED,
  file_change: TRACKED_NO_STARTED,
  web_search: TRACKED_NO_STARTED,
  dynamic_tool_call: TRACKED_NO_STARTED,
};

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

export const codexLifecycles: ProviderLifecycleMap = {
  command_execution: TRACKED_STANDARD,
  file_change: TRACKED_STANDARD,
  collab_agent_tool_call: TRACKED_STANDARD,
  dynamic_tool_call: TRACKED_STANDARD,
  mcp_tool_call: TRACKED_STANDARD,
  web_search: TRACKED_STANDARD,
  image_view: TRACKED_STANDARD,
};

// ---------------------------------------------------------------------------
// OpenCode
// ---------------------------------------------------------------------------

export const opencodeLifecycles: ProviderLifecycleMap = {
  command_execution: TRACKED_STANDARD,
  file_change: TRACKED_STANDARD,
  collab_agent_tool_call: TRACKED_STANDARD,
  dynamic_tool_call: TRACKED_STANDARD,
  mcp_tool_call: TRACKED_STANDARD,
  web_search: TRACKED_STANDARD,
  image_view: TRACKED_STANDARD,
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const lifecyclesByProvider: Record<string, ProviderLifecycleMap> = {
  claudeAgent: claudeLifecycles,
  cursor: cursorLifecycles,
  codex: codexLifecycles,
  opencode: opencodeLifecycles,
};

/**
 * Get the lifecycle map for a given provider name.
 * Returns undefined for unknown providers.
 */
export function getLifecycleMap(providerName: string): ProviderLifecycleMap | undefined {
  return lifecyclesByProvider[providerName];
}
