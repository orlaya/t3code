/**
 * Sub-agent (Agent tool) grouping and assembly.
 *
 * collab_agent_tool_call has its own itemType, so all three lifecycle events
 * carry providerItemId — group by that. taskId is grafted via the task-linking
 * helper using the description string.
 */

import type { OrchestrationThreadActivity, AssembledSubAgent } from "@t3tools/contracts";

import {
  deriveAssembledState,
  extractResultContent,
  groupByProviderItemId,
  summarizeInvocation,
  type ProviderItemInvocation,
} from "./shared";

type SubAgentInvocation = ProviderItemInvocation;

export function finalizeSubAgent(
  inv: SubAgentInvocation,
  descriptionToTaskId: Map<string, string>,
): AssembledSubAgent | null {
  const summary = summarizeInvocation(inv);
  if (!summary) return null;
  const { firstId, firstCreatedAt, bestCanonical, bestKind } = summary;

  // tool.started only — no data yet, emit a "starting" placeholder.
  // If tool.completed arrived with status "failed" (e.g. interrupted mid-stream
  // before the input was fully delivered), mark as interrupted, not starting.
  if (!bestCanonical || !bestCanonical.input?.prompt) {
    const wasInterrupted = bestKind === "tool.completed";
    return {
      kind: "sub-agent",
      id: firstId,
      createdAt: firstCreatedAt,
      turnId: inv.turnId,
      state: wasInterrupted ? "interrupted" : "starting",
      heading: "Sub-agent",
      brief: { prompt: "", description: "" },
    };
  }

  const state = deriveAssembledState(bestCanonical, bestKind);
  const description = bestCanonical.input.description ?? "";
  const agentType = bestCanonical.input.subagent_type;

  // Build the heading: "Sub-agent — Explore: description" matching old display
  const typePrefix = agentType ? `${agentType}: ` : "";
  const heading = description ? `Sub-agent — ${typePrefix}${description}` : "Sub-agent";

  const assembled: AssembledSubAgent = {
    kind: "sub-agent",
    id: firstId,
    createdAt: firstCreatedAt,
    turnId: inv.turnId,
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

export function groupSubAgentActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): SubAgentInvocation[] {
  return groupByProviderItemId(activities, "collab_agent_tool_call");
}
