import { describe, expect, it } from "vitest";
import {
  extractClaudeApprovalInlineDiffs,
  extractClaudeToolData,
  extractClaudeApprovalData,
  extractClaudeApprovalDecision,
  extractClaudeInlineDiffs,
} from "./claude.ts";

import bashFixture from "./fixtures/claude-bash.json";
import editFixture from "./fixtures/claude-edit.json";
import subagentFixture from "./fixtures/claude-subagent.json";
import webSearchFixture from "./fixtures/claude-web-search.json";
import webFetchFixture from "./fixtures/claude-web-fetch.json";
import readFixture from "./fixtures/claude-read.json";
import writeFixture from "./fixtures/claude-write.json";
import grepFixture from "./fixtures/claude-grep.json";
import globFixture from "./fixtures/claude-glob.json";
import editReplaceAllFixture from "./fixtures/claude-edit-replace-all.json";
import nonToolFixture from "./fixtures/claude-non-tool.json";
import approvalFixture from "./fixtures/claude-approval.json";

// ---------------------------------------------------------------------------
// Bash (command_execution)
// ---------------------------------------------------------------------------

describe("claude extraction — bash", () => {
  it("extracts nothing from tool.started (no data yet)", () => {
    const result = extractClaudeToolData(bashFixture.started);
    // started has itemType but no data — should still extract the shell
    expect(result).toMatchObject({
      toolName: "unknown",
      itemType: "command_execution",
    });
    expect(result?.input).toBeUndefined();
    expect(result?.result).toBeUndefined();
  });

  it("extracts input from tool.updated", () => {
    const result = extractClaudeToolData(bashFixture.updated);
    expect(result).toMatchObject({
      toolName: "Bash",
      itemType: "command_execution",
      status: "inProgress",
      detail: "cd /Users/sh/t3code && bun run typecheck",
      input: {
        command: "cd /Users/sh/t3code && bun run typecheck",
        description: "Run typecheck",
      },
    });
    expect(result?.result).toBeUndefined();
  });

  it("extracts input and result from tool.completed", () => {
    const result = extractClaudeToolData(bashFixture.completed);
    expect(result).toMatchObject({
      toolName: "Bash",
      itemType: "command_execution",
      input: {
        command: "cd /Users/sh/t3code && bun run typecheck",
      },
      result: {
        content: expect.stringContaining("9 successful"),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Edit (file_change)
// ---------------------------------------------------------------------------

describe("claude extraction — edit", () => {
  it("extracts edit diff fields from tool.completed", () => {
    const result = extractClaudeToolData(editFixture.completed);
    expect(result).toMatchObject({
      toolName: "Edit",
      itemType: "file_change",
      input: {
        file_path: "/Users/sh/t3code/apps/web/src/components/chat/MessagesTimeline.tsx",
        old_string: "const foo = 1;",
        new_string: "const foo = 2;",
      },
      result: {
        content: "The file has been edited successfully.",
      },
    });
  });

  it("extracts file path from detail on tool.updated", () => {
    const result = extractClaudeToolData(editFixture.updated);
    expect(result).toMatchObject({
      toolName: "Edit",
      itemType: "file_change",
      status: "inProgress",
      detail: "/Users/sh/t3code/apps/web/src/components/chat/MessagesTimeline.tsx",
      input: {
        file_path: "/Users/sh/t3code/apps/web/src/components/chat/MessagesTimeline.tsx",
        old_string: "const foo = 1;",
        new_string: "const foo = 2;",
      },
    });
  });

  it("extracts toolCallId from result.tool_use_id when data.toolCallId is absent", () => {
    const result = extractClaudeToolData({
      itemType: "file_change",
      detail: "/tmp/example.md",
      data: {
        toolName: "Edit",
        input: {
          file_path: "/tmp/example.md",
          old_string: "before",
          new_string: "after",
        },
        result: {
          tool_use_id: "toolu_example_123",
          type: "tool_result",
          content: "updated",
        },
      },
    });

    expect(result?.toolCallId).toBe("toolu_example_123");
  });

  it("extracts inline diffs for Edit payloads", () => {
    expect(extractClaudeInlineDiffs(editFixture.completed)).toEqual([
      {
        filePath: "/Users/sh/t3code/apps/web/src/components/chat/MessagesTimeline.tsx",
        toolCallId: "toolu_01ABC123",
        toolName: "Edit",
        changeKind: "update",
        source: "before_after",
        oldString: "const foo = 1;",
        newString: "const foo = 2;",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sub-agent (collab_agent_tool_call)
// ---------------------------------------------------------------------------

describe("claude extraction — subagent", () => {
  it("extracts agent input fields from tool.updated", () => {
    const result = extractClaudeToolData(subagentFixture.updated);
    expect(result).toMatchObject({
      toolName: "Agent",
      itemType: "collab_agent_tool_call",
      status: "inProgress",
      input: {
        description: "Read T3 code notes file",
        subagent_type: "Explore",
        prompt: expect.stringContaining("sh/t3code/__notes/CLAUDE.md"),
      },
    });
  });

  it("extracts content block array from tool.completed result", () => {
    const result = extractClaudeToolData(subagentFixture.completed);
    expect(result).toMatchObject({
      toolName: "Agent",
      itemType: "collab_agent_tool_call",
      result: {
        content: [
          {
            type: "text",
            text: expect.stringContaining("project instructions"),
          },
        ],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// WebSearch
// ---------------------------------------------------------------------------

describe("claude extraction — web search", () => {
  it("extracts query from tool.updated", () => {
    const result = extractClaudeToolData(webSearchFixture.updated);
    expect(result).toMatchObject({
      toolName: "WebSearch",
      itemType: "web_search",
      input: { query: "Claude AI 2026" },
    });
  });

  it("extracts result from tool.completed", () => {
    const result = extractClaudeToolData(webSearchFixture.completed);
    expect(result?.result?.content).toEqual(expect.stringContaining("Search results"));
  });
});

// ---------------------------------------------------------------------------
// WebFetch / dynamic_tool_call
// ---------------------------------------------------------------------------

describe("claude extraction — web fetch", () => {
  it("extracts url and prompt from tool.updated", () => {
    const result = extractClaudeToolData(webFetchFixture.updated);
    expect(result).toMatchObject({
      toolName: "WebFetch",
      itemType: "dynamic_tool_call",
      input: {
        url: "https://registry.npmjs.org/lucide-react/latest",
        prompt: "What is the version number?",
      },
    });
  });

  it("marks failed results with isError", () => {
    const result = extractClaudeToolData(webFetchFixture.failed);
    expect(result).toMatchObject({
      toolName: "WebFetch",
      itemType: "dynamic_tool_call",
      status: "failed",
      result: {
        isError: true,
        error: "Request failed with status code 403",
        content: "Request failed with status code 403",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Read (dynamic_tool_call)
// ---------------------------------------------------------------------------

describe("claude extraction — read", () => {
  it("extracts file_path from input", () => {
    const result = extractClaudeToolData(readFixture.completed);
    expect(result).toMatchObject({
      toolName: "Read",
      itemType: "dynamic_tool_call",
      input: {
        file_path: "/Users/sh/t3code/__notes/CLAUDE.md",
      },
      result: {
        content: expect.stringContaining("Project notes"),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Write (file_change)
// ---------------------------------------------------------------------------

describe("claude extraction — write", () => {
  it("extracts file_path and content from tool.completed", () => {
    const result = extractClaudeToolData(writeFixture.completed);
    expect(result).toMatchObject({
      toolName: "Write",
      itemType: "file_change",
      input: {
        file_path: "/tmp/ui-adapter-fixture-bait.ts",
        content: expect.stringContaining("REPLACE_ME"),
      },
      result: {
        content: "File created successfully at: /tmp/ui-adapter-fixture-bait.ts",
      },
    });
  });

  it("has no old_string/new_string (unlike Edit)", () => {
    const result = extractClaudeToolData(writeFixture.completed);
    expect(result?.input?.old_string).toBeUndefined();
    expect(result?.input?.new_string).toBeUndefined();
  });

  it("extracts inline diffs for Write payloads", () => {
    const [inlineDiff] = extractClaudeInlineDiffs(writeFixture.completed);
    expect(inlineDiff).toMatchObject({
      filePath: "/tmp/ui-adapter-fixture-bait.ts",
      toolName: "Write",
      changeKind: "add",
      source: "before_after",
      oldString: "",
      anchorLine: 1,
    });
    expect(inlineDiff?.newString).toEqual(expect.stringContaining("REPLACE_ME"));
  });
});

// ---------------------------------------------------------------------------
// Grep (dynamic_tool_call)
// ---------------------------------------------------------------------------

describe("claude extraction — grep", () => {
  it("extracts pattern and path from tool.completed", () => {
    const result = extractClaudeToolData(grepFixture.completed);
    expect(result).toMatchObject({
      toolName: "Grep",
      itemType: "dynamic_tool_call",
      input: {
        pattern: "REPLACE_ME",
      },
      result: {
        content: expect.stringContaining("const placeholder"),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Glob (dynamic_tool_call)
// ---------------------------------------------------------------------------

describe("claude extraction — glob", () => {
  it("extracts pattern and path from tool.completed", () => {
    const result = extractClaudeToolData(globFixture.completed);
    expect(result).toMatchObject({
      toolName: "Glob",
      itemType: "dynamic_tool_call",
      input: {
        pattern: "ui-adapter-fixture-bait*",
      },
      result: {
        content: "/tmp/ui-adapter-fixture-bait.ts",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Edit with replace_all (file_change)
// ---------------------------------------------------------------------------

describe("claude extraction — edit replace_all", () => {
  it("extracts replace_all flag from input", () => {
    const result = extractClaudeToolData(editReplaceAllFixture.completed);
    expect(result).toMatchObject({
      toolName: "Edit",
      itemType: "file_change",
      input: {
        file_path: "/tmp/ui-adapter-fixture-bait.ts",
        old_string: "REPLACE_ME",
        new_string: "REPLACED",
        replace_all: true,
      },
      result: {
        content: expect.stringContaining("All occurrences were successfully replaced"),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Non-tool payloads — should all return null
// ---------------------------------------------------------------------------

describe("claude extraction — non-tool payloads", () => {
  it("returns null for content delta", () => {
    expect(extractClaudeToolData(nonToolFixture.contentDelta)).toBeNull();
  });

  it("returns null for context compaction", () => {
    expect(extractClaudeToolData(nonToolFixture.contextCompaction)).toBeNull();
  });

  it("returns null for approval request", () => {
    expect(extractClaudeToolData(nonToolFixture.approval)).toBeNull();
  });

  it("returns null for context window update", () => {
    expect(extractClaudeToolData(nonToolFixture.contextWindowUpdated)).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(extractClaudeToolData(null)).toBeNull();
    expect(extractClaudeToolData(undefined)).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(extractClaudeToolData({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Approval extraction
// ---------------------------------------------------------------------------

describe("claude extraction — approvals", () => {
  it("extracts approval request with tool data from args", () => {
    const result = extractClaudeApprovalData(approvalFixture.requested);
    expect(result).toMatchObject({
      requestId: "7fdfa34f-7577-493b-a557-cf11f3118363",
      requestKind: "file-change",
      detail: "/tmp/ui-adapter-fixture-bait.ts",
      toolName: "Edit",
      toolUseId: "toolu_01HWJ3nMqdiubw4v3StAbeWq",
      input: {
        file_path: "/tmp/ui-adapter-fixture-bait.ts",
        old_string: 'const placeholder = "REPLACED";',
        new_string: 'const placeholder = "APPROVAL_TEST";',
        replace_all: false,
      },
    });
    // No decision yet — it's a request, not a resolution
    expect(result?.decision).toBeUndefined();
  });

  it("extracts inline diffs from approval args", () => {
    expect(extractClaudeApprovalInlineDiffs(approvalFixture.requested)).toEqual([
      {
        filePath: "/tmp/ui-adapter-fixture-bait.ts",
        toolCallId: "toolu_01HWJ3nMqdiubw4v3StAbeWq",
        toolName: "Edit",
        changeKind: "update",
        source: "before_after",
        oldString: 'const placeholder = "REPLACED";',
        newString: 'const placeholder = "APPROVAL_TEST";',
      },
    ]);
  });

  it("extracts decline decision from resolved payload", () => {
    const decision = extractClaudeApprovalDecision(approvalFixture.resolvedDecline);
    expect(decision).toBe("decline");
  });

  it("extracts accept decision from resolved payload", () => {
    const decision = extractClaudeApprovalDecision(approvalFixture.resolvedAccept);
    expect(decision).toBe("accept");
  });

  it("returns null for non-approval payloads", () => {
    expect(extractClaudeApprovalData(bashFixture.completed)).toBeNull();
    expect(extractClaudeApprovalDecision(bashFixture.completed)).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(extractClaudeApprovalData(null)).toBeNull();
    expect(extractClaudeApprovalData({})).toBeNull();
    expect(extractClaudeApprovalDecision(null)).toBeNull();
    expect(extractClaudeApprovalDecision({ decision: "bogus" })).toBeNull();
  });
});
