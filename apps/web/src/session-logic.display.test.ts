import { EventId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveWorkLogEntries } from "./session-logic/index";
import { resolveToolDisplayPresentation } from "./ui-adapter";

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id ?? crypto.randomUUID()),
    createdAt: overrides.createdAt ?? "2026-04-22T00:00:00.000Z",
    kind: overrides.kind ?? "tool.completed",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload: overrides.payload ?? {},
    turnId: null,
  };
}

describe("resolveToolDisplayPresentation", () => {
  it("normalizes command tools into a shared command heading", () => {
    const result = resolveToolDisplayPresentation({
      providerName: "claudeAgent",
      tool: {
        toolName: "Bash",
        itemType: "command_execution",
        input: {
          command: "bun run lint",
        },
      },
    });

    expect(result).toMatchObject({
      displayKind: "command",
      heading: "Command",
      lifecycleShape: "started-updated-completed",
      capabilities: {
        hasCommandPreview: true,
        hasProgressState: true,
        hasResultText: true,
      },
    });
  });

  it("distinguishes read tools from generic tool-call headings", () => {
    const result = resolveToolDisplayPresentation({
      providerName: "claudeAgent",
      tool: {
        toolName: "Read",
        itemType: "dynamic_tool_call",
        input: {
          file_path: "/users/sh/t3code/apps/web/src/session-logic.ts",
        },
      },
    });

    expect(result).toMatchObject({
      displayKind: "file-read",
      heading: "Read",
    });
  });
});

describe("deriveWorkLogEntries display semantics", () => {
  it("stores canonical display headings without discarding provider-native tool metadata", () => {
    const [entry] = deriveWorkLogEntries(
      [
        makeActivity({
          summary: "Bash",
          payload: {
            itemType: "command_execution",
            detail: "bun run lint",
            data: {
              toolName: "Bash",
              input: {
                command: "bun run lint",
              },
            },
          },
        }),
      ],
      undefined,
      "claudeAgent",
    );

    expect(entry).toMatchObject({
      toolTitle: "Bash",
      displayKind: "command",
      displayHeading: "Command",
      lifecycleShape: "started-updated-completed",
    });
  });

  it("uses shared edit headings for codex patches", () => {
    const [entry] = deriveWorkLogEntries(
      [
        makeActivity({
          summary: "ApplyPatch",
          payload: {
            itemType: "file_change",
            detail: "/users/sh/t3code/apps/web/src/session-logic.ts",
            data: {
              item: {
                id: "call-1",
                type: "fileChange",
                changes: [
                  {
                    path: "/users/sh/t3code/apps/web/src/session-logic.ts",
                    kind: { type: "update" },
                    diff: "@@ -1 +1 @@\n-old\n+new\n",
                  },
                ],
              },
            },
          },
        }),
      ],
      undefined,
      "codex",
    );

    expect(entry).toMatchObject({
      toolTitle: "ApplyPatch",
      displayKind: "edit",
      displayHeading: "Edit",
    });
  });
});
