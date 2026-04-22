import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { buildSubAgentTaskLinks } from "./task-linking";

function makeActivity(
  kind: string,
  payload: unknown,
  overrides?: { id?: string; tone?: OrchestrationThreadActivity["tone"] },
): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides?.id ?? crypto.randomUUID()),
    kind,
    summary: kind,
    payload,
    turnId: null,
    createdAt: "2026-04-23T00:00:00.000Z",
    tone: overrides?.tone ?? "info",
  };
}

describe("buildSubAgentTaskLinks", () => {
  it("builds description → taskId map from local_agent task.started events", () => {
    const activities = [
      makeActivity("task.started", {
        taskId: "task-abc",
        taskType: "local_agent",
        detail: "Find commands in CLAUDE.md",
      }),
      makeActivity("task.started", {
        taskId: "task-def",
        taskType: "local_agent",
        detail: "Find DB tags",
      }),
    ];

    const links = buildSubAgentTaskLinks(activities);

    expect(links.descriptionToTaskId.get("Find commands in CLAUDE.md")).toBe("task-abc");
    expect(links.descriptionToTaskId.get("Find DB tags")).toBe("task-def");
    expect(links.subAgentTaskIds.has("task-abc")).toBe(true);
    expect(links.subAgentTaskIds.has("task-def")).toBe(true);
  });

  it("ignores local_bash task.started events", () => {
    const activities = [
      makeActivity("task.started", {
        taskId: "task-bash",
        taskType: "local_bash",
        detail: "running typecheck",
      }),
    ];

    const links = buildSubAgentTaskLinks(activities);

    expect(links.descriptionToTaskId.size).toBe(0);
    expect(links.subAgentTaskIds.size).toBe(0);
  });

  it("ignores non-task.started activities", () => {
    const activities = [
      makeActivity("task.progress", {
        taskId: "task-abc",
        detail: "Reading file",
      }),
      makeActivity("task.completed", {
        taskId: "task-abc",
        status: "completed",
      }),
    ];

    const links = buildSubAgentTaskLinks(activities);

    expect(links.descriptionToTaskId.size).toBe(0);
  });

  it("returns empty maps for an empty activity list", () => {
    const links = buildSubAgentTaskLinks([]);

    expect(links.descriptionToTaskId.size).toBe(0);
    expect(links.subAgentTaskIds.size).toBe(0);
  });
});
