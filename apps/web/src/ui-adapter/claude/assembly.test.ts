import { describe, expect, it } from "vitest";
import {
  EventId,
  type AssembledCommand,
  type AssembledFileRead,
  type AssembledFileSearch,
  type AssembledSubAgent,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

import { assembleClaudeTools } from "./assembly";
import bashFixture from "../fixtures/claude-bash.json";
import readFixture from "../fixtures/claude-read.json";
import grepFixture from "../fixtures/claude-grep.json";
import globFixture from "../fixtures/claude-glob.json";
import twoSubagentsFixture from "../fixtures/claude-two-subagents.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActivity(
  kind: string,
  payload: unknown,
  overrides?: {
    id?: string;
    summary?: string;
    createdAt?: string;
    tone?: OrchestrationThreadActivity["tone"];
    /**
     * providerItemId — Claude `tool_use_id` plumbed through by the
     * orchestration projector. The assembly groupers join lifecycle events
     * (started → updated → completed) by this id. Pass the same value for
     * every activity belonging to a single tool invocation.
     */
    pid?: string;
  },
): OrchestrationThreadActivity {
  let finalPayload = payload;
  if (
    overrides?.pid !== undefined &&
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload)
  ) {
    finalPayload = { ...(payload as Record<string, unknown>), providerItemId: overrides.pid };
  }
  return {
    id: EventId.make(overrides?.id ?? crypto.randomUUID()),
    kind,
    summary: overrides?.summary ?? kind,
    payload: finalPayload,
    turnId: null,
    createdAt: overrides?.createdAt ?? "2026-04-22T00:00:00.000Z",
    tone: overrides?.tone ?? "tool",
  };
}

function makeCommandPayload(
  phase: "started" | "updated" | "completed",
  command?: string,
  toolUseId?: string,
) {
  if (phase === "started") {
    return { itemType: "command_execution", detail: "{}" };
  }
  const base: Record<string, unknown> = {
    itemType: "command_execution",
    status: phase === "updated" ? "inProgress" : undefined,
    detail: command,
    data: {
      toolName: "Bash",
      input: { command },
      ...(phase === "completed" && toolUseId
        ? {
            result: {
              tool_use_id: toolUseId,
              type: "tool_result",
              content: "output",
              is_error: false,
            },
          }
        : {}),
    },
  };
  return base;
}

function expectCommand(value: unknown): AssembledCommand {
  const obj = value as Record<string, unknown>;
  expect(obj.kind).toBe("command");
  return obj as unknown as AssembledCommand;
}

function expectFileRead(value: unknown): AssembledFileRead {
  const obj = value as Record<string, unknown>;
  expect(obj.kind).toBe("file-read");
  return obj as unknown as AssembledFileRead;
}

function expectFileSearch(value: unknown): AssembledFileSearch {
  const obj = value as Record<string, unknown>;
  expect(obj.kind).toBe("file-search");
  return obj as unknown as AssembledFileSearch;
}

// ---------------------------------------------------------------------------
// Command assembly
// ---------------------------------------------------------------------------

describe("claude assembly — command", () => {
  it("assembles a full started → updated → completed lifecycle into one entry", () => {
    const activities = [
      makeActivity("tool.started", bashFixture.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", bashFixture.updated, { id: "act-2", pid: "tu-1" }),
      makeActivity("tool.completed", bashFixture.completed, { id: "act-3", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(1);
    const cmd = expectCommand(result[0]);
    expect(cmd.id).toBe("act-1");
    expect(cmd.state).toBe("completed");
    expect(cmd.heading).toBe("Command");
    expect(cmd.command).toBe("cd /Users/sh/t3code && bun run typecheck");
    expect(cmd.toolCallId).toBe("toolu_01Kfinm1YJUAumJztREbBqpW");
    expect(cmd.resultContent).toContain("Tasks:    9 successful");
  });

  it("assembles an in-progress command from started + updated", () => {
    const activities = [
      makeActivity("tool.started", bashFixture.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", bashFixture.updated, { id: "act-2", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(1);
    const cmd = expectCommand(result[0]);
    expect(cmd.id).toBe("act-1");
    expect(cmd.state).toBe("in-progress");
    expect(cmd.command).toBe("cd /Users/sh/t3code && bun run typecheck");
    expect(cmd.resultContent).toBeUndefined();
  });

  it("assembles from just updated + completed (no started)", () => {
    const activities = [
      makeActivity("tool.updated", bashFixture.updated, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.completed", bashFixture.completed, { id: "act-2", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(1);
    const cmd = expectCommand(result[0]);
    expect(cmd.id).toBe("act-1");
    expect(cmd.state).toBe("completed");
    expect(cmd.command).toBe("cd /Users/sh/t3code && bun run typecheck");
  });

  it("handles two consecutive commands as separate invocations", () => {
    const activities = [
      makeActivity("tool.started", bashFixture.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", bashFixture.updated, { id: "act-2", pid: "tu-1" }),
      makeActivity("tool.completed", bashFixture.completed, { id: "act-3", pid: "tu-1" }),
      makeActivity("tool.started", bashFixture.started, { id: "act-4", pid: "tu-2" }),
      makeActivity("tool.updated", bashFixture.updated, { id: "act-5", pid: "tu-2" }),
      makeActivity("tool.completed", bashFixture.completed, { id: "act-6", pid: "tu-2" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("act-1");
    expect(result[1]!.id).toBe("act-4");
  });

  it("groups interleaved parallel commands by providerItemId", () => {
    // Three commands fire in parallel; started events interleave with updated
    // events from different commands. All lifecycle events for one command
    // share a providerItemId — the grouping is robust to interleaving.
    const activities = [
      makeActivity("tool.started", makeCommandPayload("started"), {
        id: "s1",
        pid: "tu-1",
        createdAt: "2026-04-20T01:27:43.669Z",
      }),
      makeActivity("tool.updated", makeCommandPayload("updated", "bun run typecheck"), {
        id: "u1",
        pid: "tu-1",
        createdAt: "2026-04-20T01:27:44.399Z",
      }),
      makeActivity("tool.started", makeCommandPayload("started"), {
        id: "s2",
        pid: "tu-2",
        createdAt: "2026-04-20T01:27:44.421Z",
      }),
      makeActivity("tool.updated", makeCommandPayload("updated", "bun run fmt"), {
        id: "u2",
        pid: "tu-2",
        createdAt: "2026-04-20T01:27:45.236Z",
      }),
      makeActivity("tool.started", makeCommandPayload("started"), {
        id: "s3",
        pid: "tu-3",
        createdAt: "2026-04-20T01:27:45.239Z",
      }),
      makeActivity("tool.updated", makeCommandPayload("updated", "echo hello"), {
        id: "u3",
        pid: "tu-3",
        createdAt: "2026-04-20T01:27:45.760Z",
      }),
      // Non-tool events in between
      makeActivity(
        "context-window.updated",
        { usedTokens: 37424 },
        { id: "ctx", createdAt: "2026-04-20T01:27:58.855Z" },
      ),
      // Completions arrive later, potentially with duplicate updated events
      makeActivity(
        "tool.completed",
        makeCommandPayload("completed", "bun run typecheck", "toolu_01Kf"),
        { id: "c1", pid: "tu-1", createdAt: "2026-04-20T01:27:58.857Z" },
      ),
      makeActivity("tool.updated", makeCommandPayload("updated", "bun run typecheck"), {
        id: "u1-dup",
        pid: "tu-1",
        createdAt: "2026-04-20T01:27:58.857Z",
      }),
      makeActivity("tool.completed", makeCommandPayload("completed", "bun run fmt", "toolu_01JW"), {
        id: "c2",
        pid: "tu-2",
        createdAt: "2026-04-20T01:27:59.792Z",
      }),
      makeActivity("tool.completed", makeCommandPayload("completed", "echo hello", "toolu_01F7"), {
        id: "c3",
        pid: "tu-3",
        createdAt: "2026-04-20T01:27:59.809Z",
      }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(3);

    const cmd1 = expectCommand(result[0]);
    expect(cmd1.id).toBe("s1");
    expect(cmd1.command).toBe("bun run typecheck");
    expect(cmd1.state).toBe("completed");
    expect(cmd1.toolCallId).toBe("toolu_01Kf");

    const cmd2 = expectCommand(result[1]);
    expect(cmd2.id).toBe("s2");
    expect(cmd2.command).toBe("bun run fmt");
    expect(cmd2.state).toBe("completed");
    expect(cmd2.toolCallId).toBe("toolu_01JW");

    const cmd3 = expectCommand(result[2]);
    expect(cmd3.id).toBe("s3");
    expect(cmd3.command).toBe("echo hello");
    expect(cmd3.state).toBe("completed");
    expect(cmd3.toolCallId).toBe("toolu_01F7");
  });

  it("absorbs duplicate tool.updated arriving with tool.completed (same providerItemId)", () => {
    // Claude sends a duplicate tool.updated at the same time as tool.completed
    // for the same tool invocation. With ID-based grouping these are simply
    // appended to the same invocation's activity list — no phantom spinner.
    const activities = [
      makeActivity("tool.started", makeCommandPayload("started"), {
        id: "s1",
        pid: "tu-1",
        createdAt: "2026-04-30T08:20:48.616Z",
      }),
      makeActivity("tool.updated", makeCommandPayload("updated", "outline main/*.rs"), {
        id: "u1",
        pid: "tu-1",
        createdAt: "2026-04-30T08:20:49.482Z",
      }),
      makeActivity("tool.started", makeCommandPayload("started"), {
        id: "s2",
        pid: "tu-2",
        createdAt: "2026-04-30T08:20:49.485Z",
      }),
      makeActivity(
        "tool.completed",
        makeCommandPayload("completed", "outline main/*.rs", "toolu_01MG"),
        { id: "c1", pid: "tu-1", createdAt: "2026-04-30T08:20:50.163Z" },
      ),
      // Duplicate updated for tu-1 — same providerItemId as the completed
      makeActivity("tool.updated", makeCommandPayload("updated", "outline main/*.rs"), {
        id: "u1-dup",
        pid: "tu-1",
        createdAt: "2026-04-30T08:20:50.163Z",
      }),
      // Second command's lifecycle (tu-2)
      makeActivity("tool.updated", makeCommandPayload("updated", "ls /Users/sh"), {
        id: "u2",
        pid: "tu-2",
        createdAt: "2026-04-30T08:20:50.180Z",
      }),
      makeActivity(
        "tool.completed",
        makeCommandPayload("completed", "ls /Users/sh", "toolu_01Ld"),
        { id: "c2", pid: "tu-2", createdAt: "2026-04-30T08:20:50.236Z" },
      ),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(2);

    const cmd1 = expectCommand(result[0]);
    expect(cmd1.command).toBe("outline main/*.rs");
    expect(cmd1.state).toBe("completed");

    const cmd2 = expectCommand(result[1]);
    expect(cmd2.command).toBe("ls /Users/sh");
    expect(cmd2.state).toBe("completed");
  });

  it("parallel commands: fast command's tool.updated with result echo arrives before slow command's input", () => {
    // Real scenario: two parallel commands — fast one (bun test) finishes
    // quickly, slow one takes ~48s. The fast command's tool.updated-with-result
    // arrives BEFORE either command has its input materialised. Each command's
    // events still group correctly by providerItemId regardless of timing.
    const activities = [
      makeActivity("tool.started", makeCommandPayload("started"), {
        id: "s1",
        pid: "tu-fast",
        createdAt: "2026-04-30T22:17:25.986Z",
      }),
      makeActivity("tool.updated", makeCommandPayload("updated", "bun test assembly.test.ts"), {
        id: "u1",
        pid: "tu-fast",
        createdAt: "2026-04-30T22:17:26.408Z",
      }),
      makeActivity("tool.started", makeCommandPayload("started"), {
        id: "s2",
        pid: "tu-slow",
        createdAt: "2026-04-30T22:17:26.409Z",
      }),
      // Fast command's tool.updated WITH result data — arrives before its completed
      makeActivity(
        "tool.updated",
        {
          itemType: "command_execution",
          status: "inProgress",
          detail: "bun test assembly.test.ts",
          data: {
            toolName: "Bash",
            input: { command: "bun test assembly.test.ts" },
            result: {
              tool_use_id: "toolu_01RjZa",
              type: "tool_result",
              content: "31 pass\n0 fail",
              is_error: false,
            },
          },
        },
        { id: "u1-dup", pid: "tu-fast", createdAt: "2026-04-30T22:17:26.681Z" },
      ),
      makeActivity(
        "tool.completed",
        makeCommandPayload("completed", "bun test assembly.test.ts", "toolu_01RjZa"),
        { id: "c1", pid: "tu-fast", createdAt: "2026-04-30T22:17:26.681Z" },
      ),
      // Slow command's input (60s after the fast one completed)
      makeActivity(
        "tool.updated",
        makeCommandPayload("updated", "bun run fmt && bun run typecheck && bun run lint"),
        { id: "u2", pid: "tu-slow", createdAt: "2026-04-30T22:17:26.689Z" },
      ),
      makeActivity(
        "tool.completed",
        makeCommandPayload(
          "completed",
          "bun run fmt && bun run typecheck && bun run lint",
          "toolu_01SbY6",
        ),
        { id: "c2", pid: "tu-slow", createdAt: "2026-04-30T22:18:14.706Z" },
      ),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(2);

    const cmd1 = expectCommand(result[0]);
    expect(cmd1.command).toBe("bun test assembly.test.ts");
    expect(cmd1.state).toBe("completed");

    const cmd2 = expectCommand(result[1]);
    expect(cmd2.command).toBe("bun run fmt && bun run typecheck && bun run lint");
    expect(cmd2.state).toBe("completed");
    expect(cmd2.id).toBe("s2");
  });

  it("incremental assembly: slow command shows details at every stage", () => {
    // Simulates what actually happens in the UI: the assembly re-runs each
    // time a new activity arrives. At every stage, once the slow command's
    // tool.updated has arrived, it must show its command string.
    //
    // This catches rendering bugs where the final assembly is correct but
    // intermediate states show a bare "Command" while waiting.
    const s1 = makeActivity("tool.started", makeCommandPayload("started"), {
      id: "s1",
      pid: "tu-fast",
      createdAt: "2026-05-01T10:00:00.000Z",
    });
    const u1 = makeActivity(
      "tool.updated",
      makeCommandPayload("updated", "bun test assembly.test.ts"),
      { id: "u1", pid: "tu-fast", createdAt: "2026-05-01T10:00:00.015Z" },
    );
    const s2 = makeActivity("tool.started", makeCommandPayload("started"), {
      id: "s2",
      pid: "tu-slow",
      createdAt: "2026-05-01T10:00:00.020Z",
    });
    const u2 = makeActivity(
      "tool.updated",
      makeCommandPayload("updated", "bun run fmt && bun run typecheck && bun run lint"),
      { id: "u2", pid: "tu-slow", createdAt: "2026-05-01T10:00:00.150Z" },
    );
    const u1dup = makeActivity(
      "tool.updated",
      {
        itemType: "command_execution",
        status: "inProgress",
        detail: "bun test assembly.test.ts",
        data: {
          toolName: "Bash",
          input: { command: "bun test assembly.test.ts" },
          result: {
            tool_use_id: "toolu_01",
            type: "tool_result",
            content: "32 pass",
            is_error: false,
          },
        },
      },
      { id: "u1-dup", pid: "tu-fast", createdAt: "2026-05-01T10:00:00.240Z" },
    );
    const c1 = makeActivity(
      "tool.completed",
      makeCommandPayload("completed", "bun test assembly.test.ts", "toolu_01"),
      { id: "c1", pid: "tu-fast", createdAt: "2026-05-01T10:00:00.241Z" },
    );

    // Stage 1: just s1 — bare "Command" spinner (expected)
    let result = assembleClaudeTools([s1]).tools;
    expect(result).toHaveLength(1);
    expect(expectCommand(result[0]).command).toBe("");

    // Stage 2: s1 + u1 — first command shows its string
    result = assembleClaudeTools([s1, u1]).tools;
    expect(result).toHaveLength(1);
    expect(expectCommand(result[0]).command).toBe("bun test assembly.test.ts");

    // Stage 3: s1 + u1 + s2 — second command is bare (expected, no updated yet)
    result = assembleClaudeTools([s1, u1, s2]).tools;
    expect(result).toHaveLength(2);
    expect(expectCommand(result[0]).command).toBe("bun test assembly.test.ts");
    expect(expectCommand(result[1]).command).toBe("");

    // Stage 4: s1 + u1 + s2 + u2 — BOTH commands must show details
    result = assembleClaudeTools([s1, u1, s2, u2]).tools;
    expect(result).toHaveLength(2);
    expect(expectCommand(result[0]).command).toBe("bun test assembly.test.ts");
    expect(expectCommand(result[1]).command).toBe(
      "bun run fmt && bun run typecheck && bun run lint",
    );
    expect(expectCommand(result[1]).id).toBe("s2");

    // Stage 5: + u1-dup (result echo) — slow command must STILL show details
    result = assembleClaudeTools([s1, u1, s2, u2, u1dup]).tools;
    expect(result).toHaveLength(2);
    expect(expectCommand(result[0]).command).toBe("bun test assembly.test.ts");
    expect(expectCommand(result[1]).command).toBe(
      "bun run fmt && bun run typecheck && bun run lint",
    );
    expect(expectCommand(result[1]).id).toBe("s2");

    // Stage 6: + c1 (fast command completes) — slow command still shows details
    result = assembleClaudeTools([s1, u1, s2, u2, u1dup, c1]).tools;
    expect(result).toHaveLength(2);
    expect(expectCommand(result[0]).command).toBe("bun test assembly.test.ts");
    expect(expectCommand(result[0]).state).toBe("completed");
    expect(expectCommand(result[1]).command).toBe(
      "bun run fmt && bun run typecheck && bun run lint",
    );
    expect(expectCommand(result[1]).state).toBe("in-progress");
    expect(expectCommand(result[1]).id).toBe("s2");
  });

  it("emits starting state for unmatched tool.started (crash/disconnect)", () => {
    const activities = [
      makeActivity("tool.started", makeCommandPayload("started"), { id: "orphan", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(1);
    const cmd = expectCommand(result[0]);
    expect(cmd.id).toBe("orphan");
    expect(cmd.state).toBe("starting");
    expect(cmd.command).toBe("");
  });

  it("non-tool activities between events do not break grouping", () => {
    const activities = [
      makeActivity("tool.started", makeCommandPayload("started"), { id: "s1", pid: "tu-1" }),
      makeActivity("content.delta", { text: "thinking..." }, { id: "noise" }),
      makeActivity("tool.updated", makeCommandPayload("updated", "bun run typecheck"), {
        id: "u1",
        pid: "tu-1",
      }),
      makeActivity("task.completed", { taskId: "t1" }, { id: "task" }),
      makeActivity(
        "tool.completed",
        makeCommandPayload("completed", "bun run typecheck", "toolu_abc"),
        { id: "c1", pid: "tu-1" },
      ),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(1);
    const cmd = expectCommand(result[0]);
    expect(cmd.id).toBe("s1");
    expect(cmd.state).toBe("completed");
    expect(cmd.command).toBe("bun run typecheck");
  });

  it("unwraps shell wrapper commands", () => {
    const wrappedPayload = {
      ...bashFixture.updated,
      data: {
        ...bashFixture.updated.data,
        input: {
          command: "bash -c 'bun run typecheck'",
        },
      },
    };

    const activities = [makeActivity("tool.updated", wrappedPayload, { id: "act-1", pid: "tu-1" })];

    const { tools: result } = assembleClaudeTools(activities);

    expect(result).toHaveLength(1);
    const cmd = expectCommand(result[0]);
    expect(cmd.command).toBe("bun run typecheck");
    expect(cmd.rawCommand).toBe("bash -c 'bun run typecheck'");
  });
});

// ---------------------------------------------------------------------------
// File read assembly
// ---------------------------------------------------------------------------

function makeFileReadPayload(phase: "started" | "updated" | "completed", filePath?: string) {
  if (phase === "started") {
    return { itemType: "dynamic_tool_call", detail: "{}" };
  }
  const base: Record<string, unknown> = {
    itemType: "dynamic_tool_call",
    status: phase === "updated" ? "inProgress" : undefined,
    detail: filePath,
    data: {
      toolName: "Read",
      input: { file_path: filePath },
      ...(phase === "completed"
        ? {
            result: {
              tool_use_id: "toolu_read_01",
              type: "tool_result",
              content: "1\tfile content here...",
            },
          }
        : {}),
    },
  };
  return base;
}

describe("claude assembly — file-read", () => {
  it("assembles a full started → updated → completed lifecycle into one entry", () => {
    // tool.started is skipped for dynamic_tool_call (no toolName); invocation
    // is created from the first tool.updated.
    const activities = [
      makeActivity("tool.started", readFixture.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", readFixture.updated, { id: "act-2", pid: "tu-1" }),
      makeActivity("tool.completed", readFixture.completed, { id: "act-3", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(1);
    const read = expectFileRead(reads[0]);
    expect(read.id).toBe("act-2"); // from updated, not started
    expect(read.state).toBe("completed");
    expect(read.heading).toBe("Read");
    expect(read.filePath).toBe("/Users/sh/t3code/__notes/CLAUDE.md");
    expect(read.toolCallId).toBe("toolu_01Y6CR3yNx7gEn47y9Muqox9");
    expect(read.resultContent).toContain("Some content here...");
  });

  it("assembles an in-progress read from started + updated", () => {
    const activities = [
      makeActivity("tool.started", readFixture.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", readFixture.updated, { id: "act-2", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(1);
    const read = expectFileRead(reads[0]);
    expect(read.state).toBe("in-progress");
    expect(read.filePath).toBe("/Users/sh/t3code/__notes/CLAUDE.md");
    expect(read.resultContent).toBeUndefined();
  });

  it("assembles from just updated + completed (no started)", () => {
    const activities = [
      makeActivity("tool.updated", readFixture.updated, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.completed", readFixture.completed, { id: "act-2", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(1);
    const read = expectFileRead(reads[0]);
    expect(read.id).toBe("act-1");
    expect(read.state).toBe("completed");
  });

  it("handles two consecutive reads of different files as separate invocations", () => {
    const activities = [
      makeActivity("tool.started", makeFileReadPayload("started"), { id: "s1", pid: "tu-1" }),
      makeActivity("tool.updated", makeFileReadPayload("updated", "/a.ts"), {
        id: "u1",
        pid: "tu-1",
      }),
      makeActivity("tool.completed", makeFileReadPayload("completed", "/a.ts"), {
        id: "c1",
        pid: "tu-1",
      }),
      makeActivity("tool.started", makeFileReadPayload("started"), { id: "s2", pid: "tu-2" }),
      makeActivity("tool.updated", makeFileReadPayload("updated", "/b.ts"), {
        id: "u2",
        pid: "tu-2",
      }),
      makeActivity("tool.completed", makeFileReadPayload("completed", "/b.ts"), {
        id: "c2",
        pid: "tu-2",
      }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(2);
    const read1 = expectFileRead(reads[0]);
    const read2 = expectFileRead(reads[1]);
    expect(read1.filePath).toBe("/a.ts");
    expect(read1.id).toBe("u1"); // from updated, not started
    expect(read2.filePath).toBe("/b.ts");
    expect(read2.id).toBe("u2");
  });

  it("does not pick up Grep activities as file-read", () => {
    const grepPayload = {
      itemType: "dynamic_tool_call",
      status: "inProgress",
      detail: "pattern",
      data: {
        toolName: "Grep",
        input: { pattern: "something", path: "/src" },
      },
    };

    const activities = [
      makeActivity("tool.started", makeFileReadPayload("started"), { id: "s1", pid: "tu-1" }),
      makeActivity("tool.updated", grepPayload, { id: "u1", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(0);
  });

  it("does not emit orphan tool.started as file-read when it could be any dynamic tool", () => {
    // tool.started for dynamic_tool_call is skipped — without a toolName we
    // can't tell if it's Read or Grep, so the Read grouper produces nothing.
    const activities = [
      makeActivity("tool.started", makeFileReadPayload("started"), { id: "orphan", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(0);
  });

  it("does not absorb activities belonging to a parallel Glob invocation", () => {
    // Real scenario: Glob and Read fire in parallel. Each invocation has its
    // own providerItemId so events never cross-contaminate.
    const globUpdated = {
      itemType: "dynamic_tool_call",
      status: "inProgress",
      detail: "**/*.ts",
      data: { toolName: "Glob", input: { pattern: "**/*.ts" } },
    };
    const globCompleted = {
      itemType: "dynamic_tool_call",
      detail: "**/*.ts",
      data: {
        toolName: "Glob",
        input: { pattern: "**/*.ts" },
        result: { tool_use_id: "toolu_glob", type: "tool_result", content: "a.ts\nb.ts" },
      },
    };

    const activities = [
      makeActivity("tool.started", makeFileReadPayload("started"), {
        id: "glob-s",
        pid: "tu-glob",
      }),
      makeActivity("tool.updated", globUpdated, { id: "glob-u", pid: "tu-glob" }),
      makeActivity("tool.started", makeFileReadPayload("started"), {
        id: "read-s",
        pid: "tu-read",
      }),
      makeActivity("tool.updated", makeFileReadPayload("updated", "/a.ts"), {
        id: "read-u",
        pid: "tu-read",
      }),
      makeActivity("tool.completed", globCompleted, { id: "glob-c", pid: "tu-glob" }),
      makeActivity("tool.completed", makeFileReadPayload("completed", "/a.ts"), {
        id: "read-c",
        pid: "tu-read",
      }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(1);
    const read = expectFileRead(reads[0]);
    expect(read.filePath).toBe("/a.ts");
    expect(read.state).toBe("completed");
  });

  it("interleaves with command activities without interference", () => {
    const activities = [
      makeActivity("tool.started", bashFixture.started, { id: "cmd-s", pid: "tu-cmd" }),
      makeActivity("tool.started", readFixture.started, { id: "read-s", pid: "tu-read" }),
      makeActivity("tool.updated", bashFixture.updated, { id: "cmd-u", pid: "tu-cmd" }),
      makeActivity("tool.updated", readFixture.updated, { id: "read-u", pid: "tu-read" }),
      makeActivity("tool.completed", bashFixture.completed, { id: "cmd-c", pid: "tu-cmd" }),
      makeActivity("tool.completed", readFixture.completed, { id: "read-c", pid: "tu-read" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const commands = result.filter((r) => r.kind === "command");
    const reads = result.filter((r) => r.kind === "file-read");
    expect(commands).toHaveLength(1);
    expect(reads).toHaveLength(1);
    expect(expectCommand(commands[0]).id).toBe("cmd-s");
    expect(expectFileRead(reads[0]).id).toBe("read-u"); // from updated, not started
  });
});

// ---------------------------------------------------------------------------
// File search assembly (Grep / Glob)
// ---------------------------------------------------------------------------

describe("claude assembly — file-search", () => {
  it("assembles a Grep lifecycle into one entry with correct heading", () => {
    const activities = [
      makeActivity("tool.started", grepFixture.started, { id: "s1", pid: "tu-1" }),
      makeActivity("tool.updated", grepFixture.updated, { id: "u1", pid: "tu-1" }),
      makeActivity("tool.completed", grepFixture.completed, { id: "c1", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const searches = result.filter((r) => r.kind === "file-search");
    expect(searches).toHaveLength(1);
    const search = expectFileSearch(searches[0]);
    expect(search.id).toBe("u1"); // from updated, not started
    expect(search.state).toBe("completed");
    expect(search.heading).toBe("Grep");
    expect(search.toolName).toBe("Grep");
    expect(search.pattern).toBe("REPLACE_ME");
    expect(search.filePath).toBe("/tmp/ui-adapter-fixture-bait.ts");
    expect(search.toolCallId).toBe("toolu_01KVprGoQqi8ZPpnmnFjiewi");
    expect(search.resultContent).toContain("REPLACE_ME");
  });

  it("assembles a Glob lifecycle into one entry with correct heading", () => {
    const activities = [
      makeActivity("tool.started", globFixture.started, { id: "s1", pid: "tu-1" }),
      makeActivity("tool.updated", globFixture.updated, { id: "u1", pid: "tu-1" }),
      makeActivity("tool.completed", globFixture.completed, { id: "c1", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const searches = result.filter((r) => r.kind === "file-search");
    expect(searches).toHaveLength(1);
    const search = expectFileSearch(searches[0]);
    expect(search.heading).toBe("Glob");
    expect(search.toolName).toBe("Glob");
    expect(search.pattern).toBe("ui-adapter-fixture-bait*");
    expect(search.filePath).toBe("/tmp");
  });

  it("handles interleaved Grep and Glob as separate invocations", () => {
    const activities = [
      makeActivity("tool.updated", grepFixture.updated, { id: "grep-u", pid: "tu-grep" }),
      makeActivity("tool.updated", globFixture.updated, { id: "glob-u", pid: "tu-glob" }),
      makeActivity("tool.completed", grepFixture.completed, { id: "grep-c", pid: "tu-grep" }),
      makeActivity("tool.completed", globFixture.completed, { id: "glob-c", pid: "tu-glob" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const searches = result.filter((r) => r.kind === "file-search");
    expect(searches).toHaveLength(2);
    expect(expectFileSearch(searches[0]).heading).toBe("Grep");
    expect(expectFileSearch(searches[1]).heading).toBe("Glob");
  });

  it("does not pick up Read activities as file-search", () => {
    const activities = [
      makeActivity("tool.updated", readFixture.updated, { id: "read-u", pid: "tu-read" }),
      makeActivity("tool.completed", readFixture.completed, { id: "read-c", pid: "tu-read" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const searches = result.filter((r) => r.kind === "file-search");
    expect(searches).toHaveLength(0);
    const reads = result.filter((r) => r.kind === "file-read");
    expect(reads).toHaveLength(1);
  });

  it("does not emit orphan tool.started as file-search", () => {
    const activities = [
      makeActivity("tool.started", grepFixture.started, { id: "orphan", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const searches = result.filter((r) => r.kind === "file-search");
    expect(searches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Helper: expect sub-agent
// ---------------------------------------------------------------------------

function expectSubAgent(value: unknown): AssembledSubAgent {
  const obj = value as Record<string, unknown>;
  expect(obj.kind).toBe("sub-agent");
  return obj as unknown as AssembledSubAgent;
}

// ---------------------------------------------------------------------------
// Sub-agent assembly
// ---------------------------------------------------------------------------

describe("claude assembly — sub-agent", () => {
  const fixture1 = twoSubagentsFixture.agent1;
  const fixture2 = twoSubagentsFixture.agent2;

  it("assembles a full started → updated → completed lifecycle into one entry", () => {
    const activities = [
      makeActivity("tool.started", fixture1.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", fixture1.updated, { id: "act-2", pid: "tu-1" }),
      makeActivity("tool.completed", fixture1.completed, { id: "act-3", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(1);
    const sa = expectSubAgent(subAgents[0]);
    expect(sa.id).toBe("act-1");
    expect(sa.state).toBe("completed");
    expect(sa.heading).toBe("Sub-agent — Explore: Find commands in T3 code CLAUDE.md");
    expect(sa.brief.prompt).toContain("Read the file at");
    expect(sa.brief.description).toBe("Find commands in T3 code CLAUDE.md");
    expect(sa.brief.agentType).toBe("Explore");
    expect(sa.toolCallId).toBe("toolu_01GptbM5Z3soyiidGv2Gzrop");
    expect(sa.resultContent).toContain("bun run typecheck");
  });

  it("assembles an in-progress sub-agent from started + updated", () => {
    const activities = [
      makeActivity("tool.started", fixture1.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", fixture1.updated, { id: "act-2", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(1);
    const sa = expectSubAgent(subAgents[0]);
    expect(sa.state).toBe("in-progress");
    expect(sa.brief.description).toBe("Find commands in T3 code CLAUDE.md");
    expect(sa.resultContent).toBeUndefined();
  });

  it("emits a starting placeholder from tool.started only", () => {
    const activities = [
      makeActivity("tool.started", fixture1.started, { id: "act-1", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(1);
    const sa = expectSubAgent(subAgents[0]);
    expect(sa.state).toBe("starting");
    expect(sa.heading).toBe("Sub-agent");
    expect(sa.brief.prompt).toBe("");
  });

  it("assembles two concurrent sub-agents independently", () => {
    const activities = [
      makeActivity("tool.started", fixture1.started, { id: "a1-started", pid: "tu-1" }),
      makeActivity("tool.updated", fixture1.updated, { id: "a1-updated", pid: "tu-1" }),
      makeActivity("tool.started", fixture2.started, { id: "a2-started", pid: "tu-2" }),
      makeActivity("tool.updated", fixture2.updated, { id: "a2-updated", pid: "tu-2" }),
      makeActivity("tool.completed", fixture1.completed, { id: "a1-completed", pid: "tu-1" }),
      makeActivity("tool.completed", fixture2.completed, { id: "a2-completed", pid: "tu-2" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(2);

    const sa1 = expectSubAgent(subAgents[0]);
    expect(sa1.id).toBe("a1-started");
    expect(sa1.state).toBe("completed");
    expect(sa1.brief.description).toBe("Find commands in T3 code CLAUDE.md");
    expect(sa1.resultContent).toContain("bun run typecheck");

    const sa2 = expectSubAgent(subAgents[1]);
    expect(sa2.id).toBe("a2-started");
    expect(sa2.state).toBe("completed");
    expect(sa2.brief.description).toBe("Find DB tags in Orlaya repo");
    expect(sa2.resultContent).toContain("API.basis.md");
  });

  it("grafts taskId when task.started activity is present", () => {
    const activities = [
      makeActivity("tool.started", fixture1.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", fixture1.updated, { id: "act-2", pid: "tu-1" }),
      makeActivity("task.started", fixture1.taskStarted, {
        id: "task-1",
        tone: "info",
      }),
      makeActivity("tool.completed", fixture1.completed, { id: "act-3", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(1);
    const sa = expectSubAgent(subAgents[0]);
    expect(sa.taskId).toBe("ac683365249f8eb0f");
  });

  it("grafts independent taskIds to concurrent sub-agents", () => {
    const activities = [
      makeActivity("tool.started", fixture1.started, { id: "a1-started", pid: "tu-1" }),
      makeActivity("tool.updated", fixture1.updated, { id: "a1-updated", pid: "tu-1" }),
      makeActivity("task.started", fixture1.taskStarted, { id: "t1", tone: "info" }),
      makeActivity("tool.started", fixture2.started, { id: "a2-started", pid: "tu-2" }),
      makeActivity("tool.updated", fixture2.updated, { id: "a2-updated", pid: "tu-2" }),
      makeActivity("task.started", fixture2.taskStarted, { id: "t2", tone: "info" }),
      makeActivity("tool.completed", fixture1.completed, { id: "a1-completed", pid: "tu-1" }),
      makeActivity("tool.completed", fixture2.completed, { id: "a2-completed", pid: "tu-2" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(2);

    const sa1 = expectSubAgent(subAgents[0]);
    expect(sa1.taskId).toBe("ac683365249f8eb0f");

    const sa2 = expectSubAgent(subAgents[1]);
    expect(sa2.taskId).toBe("aabbc5d0d5b3fb7f8");
  });

  it("absorbs duplicate tool.updated that arrives with tool.completed", () => {
    // Claude sends a duplicate tool.updated at the same time as tool.completed
    const activities = [
      makeActivity("tool.started", fixture1.started, { id: "act-1", pid: "tu-1" }),
      makeActivity("tool.updated", fixture1.updated, { id: "act-2", pid: "tu-1" }),
      makeActivity("tool.completed", fixture1.completed, { id: "act-3", pid: "tu-1" }),
      makeActivity("tool.updated", fixture1.completed, { id: "act-4", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(1);
    const sa = expectSubAgent(subAgents[0]);
    expect(sa.state).toBe("completed");
  });

  it("handles tool.completed without prior started/updated", () => {
    const activities = [
      makeActivity("tool.completed", fixture1.completed, { id: "act-1", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(1);
    const sa = expectSubAgent(subAgents[0]);
    expect(sa.state).toBe("completed");
    expect(sa.brief.description).toBe("Find commands in T3 code CLAUDE.md");
  });

  it("does not produce sub-agent entries for non-collab_agent activities", () => {
    const activities = [
      makeActivity("tool.started", bashFixture.started, { id: "cmd-1", pid: "tu-1" }),
      makeActivity("tool.updated", bashFixture.updated, { id: "cmd-2", pid: "tu-1" }),
      makeActivity("tool.completed", bashFixture.completed, { id: "cmd-3", pid: "tu-1" }),
    ];

    const { tools: result } = assembleClaudeTools(activities);

    const subAgents = result.filter((r) => r.kind === "sub-agent");
    expect(subAgents).toHaveLength(0);
  });
});
