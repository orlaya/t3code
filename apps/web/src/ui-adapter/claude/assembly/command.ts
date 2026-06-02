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
import { formatCommandForDisplay } from "../../commandDisplay";

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
