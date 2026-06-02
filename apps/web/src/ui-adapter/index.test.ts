import { describe, expect, it } from "vitest";
import {
  extractApprovalInlineDiffs,
  extractInlineDiffs,
  extractInlineDiffsFromApprovalArgs,
  extractToolData,
  getLifecycleMap,
} from "./index.ts";

import bashFixture from "./fixtures/claude-bash.json";
import editFixture from "./fixtures/claude-edit.json";

describe("extractToolData dispatcher", () => {
  it("dispatches to Claude extractor for claudeAgent", () => {
    const result = extractToolData(bashFixture.completed, "claudeAgent");
    expect(result).toMatchObject({
      toolName: "Bash",
      itemType: "command_execution",
    });
  });

  it("returns null for unknown provider", () => {
    expect(extractToolData(bashFixture.completed, "somethingElse")).toBeNull();
  });

  it("returns degraded result for cross-provider payloads (shared itemType field)", () => {
    // Codex extractor can parse the itemType from a Claude payload — it
    // returns a sparse/degraded result, not null. Both providers use the
    // same itemType vocabulary.
    const codexResult = extractToolData(bashFixture.completed, "codex");
    expect(codexResult).not.toBeNull();
    expect(codexResult?.toolName).toBe("unknown");
    expect(codexResult?.itemType).toBe("command_execution");
  });

  it("returns null for stubbed providers", () => {
    expect(extractToolData(bashFixture.completed, "opencode")).toBeNull();
    expect(extractToolData(bashFixture.completed, "cursor")).toBeNull();
  });
});

describe("extractInlineDiffs dispatcher", () => {
  it("dispatches to Claude inline diff extraction", () => {
    expect(extractInlineDiffs(editFixture.completed, "claudeAgent")).toMatchObject([
      {
        toolName: "Edit",
        source: "before_after",
        changeKind: "update",
      },
    ]);
  });

  it("returns empty array for unknown provider", () => {
    expect(extractInlineDiffs(editFixture.completed, "somethingElse")).toEqual([]);
  });
});

describe("extractInlineDiffsFromApprovalArgs", () => {
  it("normalizes Claude-style approval args into inline diffs", () => {
    expect(
      extractInlineDiffsFromApprovalArgs({
        toolName: "Edit",
        toolUseId: "toolu-1",
        input: {
          file_path: "/tmp/example.ts",
          old_string: "before",
          new_string: "after",
        },
      }),
    ).toEqual([
      {
        filePath: "/tmp/example.ts",
        toolCallId: "toolu-1",
        toolName: "Edit",
        changeKind: "update",
        source: "before_after",
        oldString: "before",
        newString: "after",
      },
    ]);
  });
});

describe("extractApprovalInlineDiffs dispatcher", () => {
  it("extracts Codex apply-patch approval diffs from fileChanges", () => {
    expect(
      extractApprovalInlineDiffs(
        {
          requestId: "approval-1",
          requestKind: "file-change",
          args: {
            callId: "call-1",
            conversationId: "thread-1",
            fileChanges: {
              "/tmp/example.ts": {
                type: "update",
                unified_diff: "@@ -1 +1 @@\n-before\n+after\n",
              },
            },
          },
        },
        "codex",
      ),
    ).toEqual([
      {
        filePath: "/tmp/example.ts",
        toolCallId: "call-1",
        toolName: "ApplyPatch",
        changeKind: "update",
        source: "patch",
        unifiedPatch:
          "diff --git a/tmp/example.ts b/tmp/example.ts\n--- a/tmp/example.ts\n+++ b/tmp/example.ts\n@@ -1 +1 @@\n-before\n+after\n",
        anchorLine: 1,
      },
    ]);
  });

  it("returns no Codex approval diff when the file-change request has no fileChanges", () => {
    expect(
      extractApprovalInlineDiffs(
        {
          requestId: "approval-1",
          requestKind: "file-change",
          args: {
            itemId: "item-1",
            threadId: "thread-1",
            turnId: "turn-1",
          },
        },
        "codex",
      ),
    ).toEqual([]);
  });
});

describe("getLifecycleMap", () => {
  it("returns lifecycle map for known providers", () => {
    const claude = getLifecycleMap("claudeAgent");
    expect(claude).toBeDefined();
    expect(claude?.command_execution).toMatchObject({
      lifecycle: "tracked",
      events: ["tool.started", "tool.updated", "tool.completed"],
    });
  });

  it("returns cursor lifecycle with no tool.started", () => {
    const cursor = getLifecycleMap("cursor");
    expect(cursor?.command_execution).toMatchObject({
      lifecycle: "tracked",
      events: ["tool.updated", "tool.completed"],
    });
  });

  it("returns undefined for unknown provider", () => {
    expect(getLifecycleMap("whatever")).toBeUndefined();
  });
});
