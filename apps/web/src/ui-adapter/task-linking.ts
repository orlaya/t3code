/**
 * Task-linking helper — associates task.* activities with sub-agent invocations.
 *
 * When Claude spawns a sub-agent, the SDK emits two parallel streams:
 *   - tool.started → tool.updated → tool.completed  (the Agent tool invocation)
 *   - task.started → task.progress* → task.completed  (the sub-agent's progress)
 *
 * There's no shared ID between them. The link is:
 *   task.started.payload.detail === tool.updated.data.input.description
 *   (and they arrive at the same timestamp)
 *
 * This helper scans activities and builds a lookup from description → taskId,
 * so the assembly layer can graft taskIds onto AssembledSubAgent.
 *
 * The same data is reusable for step 7 (generic tool filtering) to identify
 * which task.* activities belong to sub-agents vs local_bash commands.
 */

import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { isRecord } from "./helpers";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SubAgentTaskLinks {
  /** Map from task description → taskId (for grafting onto assembled sub-agents). */
  descriptionToTaskId: Map<string, string>;
  /** Set of all taskIds belonging to sub-agents (taskType === "local_agent"). */
  subAgentTaskIds: Set<string>;
}

/**
 * Scan activities for task.started events with taskType "local_agent" and build
 * a description → taskId lookup. The description matches the sub-agent's
 * `input.description` field from the tool.updated payload.
 */
export function buildSubAgentTaskLinks(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): SubAgentTaskLinks {
  const descriptionToTaskId = new Map<string, string>();
  const subAgentTaskIds = new Set<string>();

  for (const activity of activities) {
    if (activity.kind !== "task.started") continue;

    const payload = activity.payload;
    if (!isRecord(payload)) continue;

    const taskType = typeof payload.taskType === "string" ? payload.taskType : undefined;
    if (taskType !== "local_agent") continue;

    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    const detail = typeof payload.detail === "string" ? payload.detail : undefined;

    if (taskId && detail) {
      descriptionToTaskId.set(detail, taskId);
      subAgentTaskIds.add(taskId);
    }
  }

  return { descriptionToTaskId, subAgentTaskIds };
}
