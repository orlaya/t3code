/**
 * Sub-agent (Agent tool) grouping and assembly.
 *
 * collab_agent_tool_call has its own itemType, so tool.started IS identifiable
 * — uses a startedQueue (same as command/web-search).
 *
 * Grouping key is `description` from `data.input.description`.
 * taskId is grafted via the task-linking helper.
 */

import type { OrchestrationThreadActivity, AssembledSubAgent } from "@t3tools/contracts";

import { extractClaudeToolData } from "../extraction";
import {
  extractItemType,
  extractDescription,
  extractResultContent,
  shiftMatchingTurnId,
} from "./shared";

interface SubAgentInvocation {
  /** Grouping key — description from tool.updated data.input.description. */
  description: string | undefined;
  turnId: string | null;
  activities: OrchestrationThreadActivity[];
  hasStarted: boolean;
  hasCompleted: boolean;
}

export function finalizeSubAgent(
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

export function groupSubAgentActivities(
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
        turnId: activity.turnId,
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
      const pendingStarted = shiftMatchingTurnId(startedQueue, activity.turnId);
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
            turnId: activity.turnId,
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
          turnId: activity.turnId,
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
