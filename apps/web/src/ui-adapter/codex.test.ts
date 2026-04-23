import { describe, expect, it } from "vitest";

import { extractCodexInlineDiffs, extractCodexToolData } from "./codex/index.ts";
import editFixture from "./fixtures/codex-apply-patch-edit.json";
import writeFixture from "./fixtures/codex-apply-patch-write.json";

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
