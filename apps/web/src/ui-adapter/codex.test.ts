import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  assembleCodexTools,
  extractCodexInlineDiffs,
  extractCodexToolData,
} from "./codex/index.ts";
import editFixture from "./fixtures/codex-apply-patch-edit.json";
import writeFixture from "./fixtures/codex-apply-patch-write.json";

function makeActivity(overrides: {
  id: string;
  kind: string;
  tone: OrchestrationThreadActivity["tone"];
  summary: string;
  payload: unknown;
  turnId?: string;
  createdAt: string;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id),
    kind: overrides.kind,
    tone: overrides.tone,
    summary: overrides.summary,
    payload: overrides.payload,
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    createdAt: overrides.createdAt,
  };
}

function fileChangePayloadsFromFixture(fixture: {
  activities: Array<{ kind: string; payload: unknown }>;
}): unknown[] {
  return fixture.activities
    .filter((activity) => activity.kind === "tool.completed")
    .map((activity) => activity.payload)
    .filter(
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as Record<string, unknown>).itemType === "file_change",
    );
}

describe("codex extraction", () => {
  it("extracts command tool data", () => {
    expect(
      extractCodexToolData({
        itemType: "command_execution",
        data: {
          item: {
            type: "commandExecution",
            id: "call-command-1",
            command: "pwd",
            aggregatedOutput: "/users/sh/t3code\n",
            exitCode: 0,
          },
        },
      }),
    ).toMatchObject({
      toolName: "Command",
      itemType: "command_execution",
      toolCallId: "call-command-1",
      detail: "pwd",
      input: {
        command: "pwd",
      },
      result: {
        content: "/users/sh/t3code\n",
        exitCode: 0,
      },
    });
  });

  it("extracts file-change tool data", () => {
    const [payload] = fileChangePayloadsFromFixture(writeFixture);
    expect(extractCodexToolData(payload)).toMatchObject({
      toolName: "ApplyPatch",
      itemType: "file_change",
      toolCallId: "call_gd67shqpLHs9jsvWZb3SY3Qs",
      detail: "/Users/sh/t3code/__notes/tool-patch-create-example.md",
      input: {
        file_path: "/Users/sh/t3code/__notes/tool-patch-create-example.md",
      },
    });
  });

  it("extracts patch-native inline diffs for update changes", () => {
    const [firstPayload] = fileChangePayloadsFromFixture(editFixture);
    expect(extractCodexInlineDiffs(firstPayload)).toEqual([
      {
        filePath: "/Users/sh/t3code/__notes/tool-patch-create-example.md",
        toolCallId: "call_jBZpQsLxnn1LParsZIDLZcMC",
        toolName: "ApplyPatch",
        changeKind: "update",
        source: "patch",
        unifiedPatch:
          "diff --git a/Users/sh/t3code/__notes/tool-patch-create-example.md b/Users/sh/t3code/__notes/tool-patch-create-example.md\n--- a/Users/sh/t3code/__notes/tool-patch-create-example.md\n+++ b/Users/sh/t3code/__notes/tool-patch-create-example.md\n@@ -2,3 +2,3 @@\n \n-This file was created as a simple `apply_patch` test.\n+This file was created as a simple `apply_patch` edit test.\n \n",
        anchorLine: 2,
      },
    ]);
  });

  it("extracts before/after inline diffs for add changes", () => {
    const [payload] = fileChangePayloadsFromFixture(writeFixture);
    expect(extractCodexInlineDiffs(payload)).toEqual([
      {
        filePath: "/Users/sh/t3code/__notes/tool-patch-create-example.md",
        toolCallId: "call_gd67shqpLHs9jsvWZb3SY3Qs",
        toolName: "ApplyPatch",
        changeKind: "add",
        source: "before_after",
        oldString: "",
        newString:
          "# Tool Patch Create Example\n\nThis file was created as a simple `apply_patch` test.\n\n- Purpose: isolated file creation\n- Location: `__notes`\n- Format: Markdown\n",
        anchorLine: 1,
      },
    ]);
  });

  it("extracts multiple patch-native inline diffs from the edit fixture", () => {
    const [firstPayload, secondPayload] = fileChangePayloadsFromFixture(editFixture);
    const allDiffs = [
      ...extractCodexInlineDiffs(firstPayload),
      ...extractCodexInlineDiffs(secondPayload),
    ];
    expect(allDiffs).toHaveLength(2);
    expect(allDiffs.map((diff) => diff.toolCallId)).toEqual([
      "call_jBZpQsLxnn1LParsZIDLZcMC",
      "call_vlNdgDeDUYy26te198FjvXSQ",
    ]);
  });
});

describe("codex assembly", () => {
  it("unwraps shell command wrappers for started command placeholders", () => {
    const result = assembleCodexTools([
      makeActivity({
        id: "command-start",
        kind: "tool.started",
        tone: "tool",
        summary: "Command started",
        payload: {
          itemType: "command_execution",
          providerItemId: "call-command-1",
          detail: "/bin/zsh -lc 'sed -n '\\''1,420p'\\'' apps/web/src/foo.ts'",
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:23.033Z",
      }),
    ]);

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      kind: "command",
      id: "command-start",
      state: "starting",
      command: "sed -n '1,420p' apps/web/src/foo.ts",
      rawCommand: "/bin/zsh -lc 'sed -n '\\''1,420p'\\'' apps/web/src/foo.ts'",
    });
  });

  it("marries file-change started and completed activities by providerItemId across checkpoints", () => {
    const filePath = "/Users/sh/t3code/apps/web/src/example.ts";
    const providerItemId = "call_file_change_1";
    const result = assembleCodexTools([
      makeActivity({
        id: "activity-start",
        kind: "tool.started",
        tone: "tool",
        summary: "File change started",
        payload: {
          itemType: "file_change",
          providerItemId,
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:23.033Z",
      }),
      makeActivity({
        id: "activity-checkpoint",
        kind: "checkpoint.captured",
        tone: "info",
        summary: "Checkpoint captured",
        payload: {
          turnCount: 12,
          status: "ready",
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:23.200Z",
      }),
      makeActivity({
        id: "activity-complete",
        kind: "tool.completed",
        tone: "tool",
        summary: "File change",
        payload: {
          itemType: "file_change",
          providerItemId,
          status: "completed",
          data: {
            item: {
              type: "fileChange",
              id: providerItemId,
              status: "completed",
              changes: [
                {
                  path: filePath,
                  kind: {
                    type: "update",
                    move_path: null,
                  },
                  diff: "@@ -1,1 +1,1 @@\n-old\n+new\n",
                },
              ],
            },
          },
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:23.200Z",
      }),
    ]);

    expect(result.claimedActivityIds.has("activity-checkpoint")).toBe(false);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      kind: "edit",
      id: "activity-start",
      state: "completed",
      filePath,
      toolCallId: providerItemId,
    });
    expect(result.tools[0]?.kind === "edit" ? result.tools[0].inlineDiffs : []).toHaveLength(1);
  });

  it("does not cross-wire overlapping file changes that complete out of FIFO order", () => {
    const providerItemA = "call_file_change_a";
    const providerItemB = "call_file_change_b";
    const fileA = "/Users/sh/t3code/a.ts";
    const fileB = "/Users/sh/t3code/b.ts";

    const result = assembleCodexTools([
      makeActivity({
        id: "start-a",
        kind: "tool.started",
        tone: "tool",
        summary: "File change started",
        payload: {
          itemType: "file_change",
          providerItemId: providerItemA,
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:20.000Z",
      }),
      makeActivity({
        id: "start-b",
        kind: "tool.started",
        tone: "tool",
        summary: "File change started",
        payload: {
          itemType: "file_change",
          providerItemId: providerItemB,
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:21.000Z",
      }),
      makeActivity({
        id: "complete-b",
        kind: "tool.completed",
        tone: "tool",
        summary: "File change",
        payload: {
          itemType: "file_change",
          providerItemId: providerItemB,
          status: "completed",
          data: {
            item: {
              type: "fileChange",
              id: providerItemB,
              status: "completed",
              changes: [
                {
                  path: fileB,
                  kind: { type: "update", move_path: null },
                  diff: "@@ -1,1 +1,1 @@\n-b old\n+b new\n",
                },
              ],
            },
          },
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:22.000Z",
      }),
      makeActivity({
        id: "complete-a",
        kind: "tool.completed",
        tone: "tool",
        summary: "File change",
        payload: {
          itemType: "file_change",
          providerItemId: providerItemA,
          status: "completed",
          data: {
            item: {
              type: "fileChange",
              id: providerItemA,
              status: "completed",
              changes: [
                {
                  path: fileA,
                  kind: { type: "update", move_path: null },
                  diff: "@@ -1,1 +1,1 @@\n-a old\n+a new\n",
                },
              ],
            },
          },
        },
        turnId: "turn-1",
        createdAt: "2026-06-02T08:44:23.000Z",
      }),
    ]);

    expect(result.tools).toHaveLength(2);
    expect(result.tools.map((tool) => tool.id)).toEqual(["start-a", "start-b"]);
    expect(result.tools.map((tool) => (tool.kind === "edit" ? tool.filePath : null))).toEqual([
      fileA,
      fileB,
    ]);
    expect(result.tools.map((tool) => tool.toolCallId)).toEqual([providerItemA, providerItemB]);
  });
});
