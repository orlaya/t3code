import * as Schema from "effect/Schema";
import { assert, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  HookEvent,
  CommandHookAction,
  PromptHookAction,
  AgentHookAction,
  HttpHookAction,
  HookAction,
  HookMatcherGroup,
  HooksConfig,
  ManagedHookFile,
  ManagedHookEntry,
  UnmanagedHooks,
  HooksClaudeFile,
  HooksLevel,
  HookDiagnostic,
  ClaudeHooksGetInput,
  ClaudeHooksWriteInput,
  ClaudeHooksWriteResult,
  ClaudeHooksDeleteInput,
  ClaudeHooksDeleteResult,
  ClaudeHooksPullInInput,
  ClaudeHooksPullInResult,
  ClaudeHooksError,
  ClaudeHooksAllProjectsResult,
  ClaudeHooksSubscribeInput,
  ClaudeHooksStreamEvent,
} from "./settingsHooks.ts";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

const decodeFail = <S extends Schema.Top>(schema: S, input: unknown) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(decode(schema, input));
    assert.strictEqual(result._tag, "Failure");
  });

// ── HookEvent ──────────────────────────────────────────────────────

describe("HookEvent", () => {
  it.effect("accepts all known event names", () =>
    Effect.gen(function* () {
      const events = [
        "PreToolUse",
        "PostToolUse",
        "Notification",
        "Stop",
        "SessionStart",
        "SessionEnd",
        "SubagentStart",
        "SubagentStop",
        "PermissionRequest",
        "FileChanged",
      ] as const;
      for (const event of events) {
        const parsed = yield* decode(HookEvent, event);
        assert.strictEqual(parsed, event);
      }
    }),
  );

  it.effect("rejects unknown event names", () => decodeFail(HookEvent, "MadeUpEvent"));

  it.effect("rejects empty string", () => decodeFail(HookEvent, ""));
});

// ── HookAction variants ────────────────────────────────────────────

describe("CommandHookAction", () => {
  it.effect("parses a minimal command action", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(CommandHookAction, {
        type: "command",
        command: "echo hello",
      });
      assert.strictEqual(parsed.type, "command");
      assert.strictEqual(parsed.command, "echo hello");
      assert.strictEqual(parsed.timeout, undefined);
      assert.strictEqual(parsed.shell, undefined);
    }),
  );

  it.effect("parses a command action with all optional fields", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(CommandHookAction, {
        type: "command",
        command: "exit 1",
        shell: "bash",
        async: true,
        asyncRewake: false,
        timeout: 30,
        statusMessage: "Blocking...",
        once: true,
        if: "Bash(run_in_background*)",
      });
      assert.strictEqual(parsed.command, "exit 1");
      assert.strictEqual(parsed.shell, "bash");
      assert.strictEqual(parsed.async, true);
      assert.strictEqual(parsed.asyncRewake, false);
      assert.strictEqual(parsed.timeout, 30);
      assert.strictEqual(parsed.statusMessage, "Blocking...");
      assert.strictEqual(parsed.once, true);
      assert.strictEqual(parsed.if, "Bash(run_in_background*)");
    }),
  );

  it.effect("rejects missing command field", () =>
    decodeFail(CommandHookAction, { type: "command" }),
  );

  it.effect("rejects invalid shell value", () =>
    decodeFail(CommandHookAction, {
      type: "command",
      command: "echo hi",
      shell: "zsh",
    }),
  );
});

describe("PromptHookAction", () => {
  it.effect("parses a prompt action", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(PromptHookAction, {
        type: "prompt",
        prompt: "Review this change",
      });
      assert.strictEqual(parsed.type, "prompt");
      assert.strictEqual(parsed.prompt, "Review this change");
    }),
  );

  it.effect("accepts optional model field", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(PromptHookAction, {
        type: "prompt",
        prompt: "Check this",
        model: "claude-sonnet-4-20250514",
      });
      assert.strictEqual(parsed.model, "claude-sonnet-4-20250514");
    }),
  );
});

describe("AgentHookAction", () => {
  it.effect("parses an agent action", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(AgentHookAction, {
        type: "agent",
        prompt: "Run the linter",
      });
      assert.strictEqual(parsed.type, "agent");
      assert.strictEqual(parsed.prompt, "Run the linter");
    }),
  );
});

describe("HttpHookAction", () => {
  it.effect("parses an http action with headers", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HttpHookAction, {
        type: "http",
        url: "https://example.com/hook",
        headers: { Authorization: "Bearer xyz" },
      });
      assert.strictEqual(parsed.type, "http");
      assert.strictEqual(parsed.url, "https://example.com/hook");
      assert.deepEqual(parsed.headers, { Authorization: "Bearer xyz" });
    }),
  );

  it.effect("rejects missing url", () => decodeFail(HttpHookAction, { type: "http" }));
});

describe("HookAction (union)", () => {
  it.effect("discriminates by type field", () =>
    Effect.gen(function* () {
      const cmd = yield* decode(HookAction, { type: "command", command: "echo" });
      assert.strictEqual(cmd.type, "command");

      const prompt = yield* decode(HookAction, { type: "prompt", prompt: "hi" });
      assert.strictEqual(prompt.type, "prompt");

      const agent = yield* decode(HookAction, { type: "agent", prompt: "go" });
      assert.strictEqual(agent.type, "agent");

      const http = yield* decode(HookAction, { type: "http", url: "https://x.com" });
      assert.strictEqual(http.type, "http");
    }),
  );

  it.effect("rejects unknown action type", () =>
    decodeFail(HookAction, { type: "webhook", url: "https://x.com" }),
  );
});

// ── HookMatcherGroup ───────────────────────────────────────────────

describe("HookMatcherGroup", () => {
  it.effect("parses a group with matcher and multiple hooks", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HookMatcherGroup, {
        matcher: "Bash",
        hooks: [
          { type: "command", command: "echo pre" },
          { type: "prompt", prompt: "review" },
        ],
        timeout: 60,
      });
      assert.strictEqual(parsed.matcher, "Bash");
      assert.lengthOf(parsed.hooks, 2);
      assert.strictEqual(parsed.timeout, 60);
    }),
  );

  it.effect("parses a group without matcher (catch-all)", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HookMatcherGroup, {
        hooks: [{ type: "command", command: "echo hi" }],
      });
      assert.strictEqual(parsed.matcher, undefined);
      assert.lengthOf(parsed.hooks, 1);
    }),
  );

  it.effect("rejects missing hooks array", () => decodeFail(HookMatcherGroup, { matcher: "Bash" }));
});

// ── HooksConfig ────────────────────────────────────────────────────

describe("HooksConfig", () => {
  it.effect("parses a realistic hooks config", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HooksConfig, {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "exit 1" }],
          },
        ],
        Stop: [
          {
            hooks: [{ type: "prompt", prompt: "summarize" }],
          },
        ],
      });
      assert.lengthOf(parsed.PreToolUse ?? [], 1);
      assert.lengthOf(parsed.Stop ?? [], 1);
    }),
  );

  it.effect("accepts an empty config", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HooksConfig, {});
      assert.deepEqual(parsed, {});
    }),
  );
});

// ── ManagedHookEntry ───────────────────────────────────────────────

describe("ManagedHookEntry", () => {
  it.effect("parses a full managed hook", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ManagedHookEntry, {
        name: "Block background bash",
        description: "Prevents run_in_background on Bash",
        draft: true,
        file: "committed",
        event: "PreToolUse",
        matcher: "Bash",
        action: { type: "command", command: "exit 1" },
        groupTimeout: 10,
      });
      assert.strictEqual(parsed.name, "Block background bash");
      assert.strictEqual(parsed.draft, true);
      assert.strictEqual(parsed.file, "committed");
      assert.strictEqual(parsed.event, "PreToolUse");
      assert.strictEqual(parsed.matcher, "Bash");
      assert.strictEqual(parsed.action.type, "command");
      assert.strictEqual(parsed.groupTimeout, 10);
    }),
  );

  it.effect("defaults draft to false when omitted", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ManagedHookEntry, {
        name: "My hook",
        file: "local",
        event: "Stop",
        action: { type: "command", command: "echo done" },
      });
      assert.strictEqual(parsed.draft, false);
    }),
  );

  it.effect("accepts both file targets", () =>
    Effect.gen(function* () {
      const committed = yield* decode(ManagedHookFile, "committed");
      assert.strictEqual(committed, "committed");

      const local = yield* decode(ManagedHookFile, "local");
      assert.strictEqual(local, "local");
    }),
  );

  it.effect("rejects draft as a file target", () => decodeFail(ManagedHookFile, "draft"));

  it.effect("rejects missing name", () =>
    decodeFail(ManagedHookEntry, {
      file: "committed",
      event: "Stop",
      action: { type: "command", command: "echo" },
    }),
  );

  it.effect("rejects invalid event", () =>
    decodeFail(ManagedHookEntry, {
      name: "Bad event hook",
      file: "committed",
      event: "FakeEvent",
      action: { type: "command", command: "echo" },
    }),
  );
});

// ── UnmanagedHooks ─────────────────────────────────────────────────

describe("UnmanagedHooks", () => {
  it.effect("parses event-keyed unmanaged hooks per file target", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(UnmanagedHooks, {
        committed: {
          PreToolUse: [{ matcher: "Grep", hooks: [{ type: "command", command: "echo hi" }] }],
        },
        local: {},
      });
      assert.lengthOf(parsed.committed.PreToolUse ?? [], 1);
      assert.deepEqual(parsed.local, {});
    }),
  );

  it.effect("defaults both targets to empty when omitted", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(UnmanagedHooks, {});
      assert.deepEqual(parsed.committed, {});
      assert.deepEqual(parsed.local, {});
    }),
  );
});

// ── HooksClaudeFile ────────────────────────────────────────────────

describe("HooksClaudeFile", () => {
  it.effect("parses a complete file", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HooksClaudeFile, {
        version: 1,
        global: {
          managed: {
            abc123: {
              name: "Test hook",
              file: "committed",
              event: "PreToolUse",
              matcher: "Bash",
              action: { type: "command", command: "exit 1" },
            },
          },
          unmanaged: {
            committed: {
              Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
            },
            local: {},
          },
        },
        projects: {
          "/Users/sh/work/foo": {
            managed: {},
            unmanaged: { committed: {}, local: {} },
          },
        },
      });
      assert.strictEqual(parsed.version, 1);
      assert.strictEqual(Object.keys(parsed.global.managed).length, 1);
      assert.strictEqual(parsed.global.managed.abc123?.name, "Test hook");
      assert.strictEqual(parsed.global.managed.abc123?.draft, false); // default
      assert.strictEqual(Object.keys(parsed.projects).length, 1);
    }),
  );

  it.effect("defaults everything from an empty object", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HooksClaudeFile, {});
      assert.strictEqual(parsed.version, 1);
      assert.deepEqual(parsed.global.managed, {});
      assert.deepEqual(parsed.global.unmanaged.committed, {});
      assert.deepEqual(parsed.global.unmanaged.local, {});
      assert.deepEqual(parsed.projects, {});
    }),
  );

  it.effect("defaults level fields when a project entry is sparse", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HooksClaudeFile, {
        version: 1,
        global: {},
        projects: {
          "/Users/sh/proj": {},
        },
      });
      const proj = parsed.projects["/Users/sh/proj"];
      assert.isDefined(proj);
      assert.deepEqual(proj!.managed, {});
      assert.deepEqual(proj!.unmanaged.committed, {});
      assert.deepEqual(proj!.unmanaged.local, {});
    }),
  );

  it.effect("preserves multiple managed hooks with different IDs", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HooksClaudeFile, {
        global: {
          managed: {
            id1: {
              name: "Hook A",
              file: "committed",
              event: "PreToolUse",
              action: { type: "command", command: "echo a" },
            },
            id2: {
              name: "Hook B",
              file: "local",
              event: "Stop",
              action: { type: "prompt", prompt: "summarize" },
            },
          },
        },
      });
      assert.strictEqual(Object.keys(parsed.global.managed).length, 2);
      assert.strictEqual(parsed.global.managed.id1?.file, "committed");
      assert.strictEqual(parsed.global.managed.id2?.file, "local");
    }),
  );

  it.effect("preserves hooks across multiple project keys", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HooksClaudeFile, {
        projects: {
          "/proj/a": {
            managed: {
              x: {
                name: "Proj A hook",
                file: "committed",
                event: "Stop",
                action: { type: "command", command: "echo a" },
              },
            },
          },
          "/proj/b": {
            managed: {
              y: {
                name: "Proj B hook",
                file: "local",
                event: "SessionStart",
                action: { type: "command", command: "echo b" },
              },
            },
          },
        },
      });
      assert.strictEqual(parsed.projects["/proj/a"]?.managed.x?.name, "Proj A hook");
      assert.strictEqual(parsed.projects["/proj/b"]?.managed.y?.name, "Proj B hook");
    }),
  );
});

// ── Diagnostics ────────────────────────────────────────────────────

describe("HookDiagnostic", () => {
  it.effect("parses a diagnostic with all locator fields", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HookDiagnostic, {
        severity: "error",
        message: "Unknown event FooBar",
        event: "FooBar",
        matcherIndex: 0,
        hookIndex: 2,
      });
      assert.strictEqual(parsed.severity, "error");
      assert.strictEqual(parsed.event, "FooBar");
      assert.strictEqual(parsed.hookIndex, 2);
    }),
  );

  it.effect("parses a diagnostic with only severity and message", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(HookDiagnostic, {
        severity: "warning",
        message: "Suspicious timeout value",
      });
      assert.strictEqual(parsed.severity, "warning");
      assert.strictEqual(parsed.event, undefined);
    }),
  );
});

// ── RPC inputs and results ─────────────────────────────────────────

describe("ClaudeHooksGetInput", () => {
  it.effect("accepts empty input", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksGetInput, {});
      assert.strictEqual(parsed.cwd, undefined);
    }),
  );

  it.effect("accepts a cwd", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksGetInput, { cwd: "/Users/sh/proj" });
      assert.strictEqual(parsed.cwd, "/Users/sh/proj");
    }),
  );
});

describe("ClaudeHooksWriteInput", () => {
  it.effect("parses a create (no hookId)", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksWriteInput, {
        level: "global",
        hook: {
          name: "My hook",
          file: "committed",
          event: "PreToolUse",
          action: { type: "command", command: "exit 1" },
        },
      });
      assert.strictEqual(parsed.hookId, undefined);
      assert.strictEqual(parsed.level, "global");
      assert.strictEqual(parsed.hook.name, "My hook");
    }),
  );

  it.effect("parses an update (with hookId)", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksWriteInput, {
        hookId: "abc-123",
        level: "project",
        cwd: "/Users/sh/proj",
        hook: {
          name: "Updated hook",
          file: "local",
          event: "Stop",
          action: { type: "prompt", prompt: "sum up" },
        },
      });
      assert.strictEqual(parsed.hookId, "abc-123");
      assert.strictEqual(parsed.level, "project");
      assert.strictEqual(parsed.cwd, "/Users/sh/proj");
    }),
  );

  it.effect("rejects project level without cwd", () =>
    // Note: schema itself doesn't enforce this — it's a server-side check.
    // The schema allows cwd to be optional regardless of level.
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksWriteInput, {
        level: "project",
        hook: {
          name: "Orphan hook",
          file: "committed",
          event: "Stop",
          action: { type: "command", command: "echo" },
        },
      });
      assert.strictEqual(parsed.cwd, undefined);
      assert.strictEqual(parsed.level, "project");
    }),
  );
});

describe("ClaudeHooksWriteResult", () => {
  it.effect("parses a write result", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksWriteResult, {
        hookId: "new-id-456",
        hook: {
          name: "Created",
          file: "committed",
          event: "PreToolUse",
          action: { type: "command", command: "exit 1" },
        },
      });
      assert.strictEqual(parsed.hookId, "new-id-456");
      assert.strictEqual(parsed.hook.name, "Created");
    }),
  );
});

describe("ClaudeHooksDeleteInput", () => {
  it.effect("accepts hookId for managed delete", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksDeleteInput, {
        level: "global",
        hookId: "abc-123",
      });
      assert.strictEqual(parsed.hookId, "abc-123");
      assert.strictEqual(parsed.fingerprint, undefined);
    }),
  );

  it.effect("accepts fingerprint for unmanaged delete", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksDeleteInput, {
        level: "project",
        cwd: "/Users/sh/proj",
        fingerprint: "sha256abc",
      });
      assert.strictEqual(parsed.fingerprint, "sha256abc");
      assert.strictEqual(parsed.hookId, undefined);
    }),
  );
});

describe("ClaudeHooksDeleteResult", () => {
  it.effect("parses deleted true and false", () =>
    Effect.gen(function* () {
      const yes = yield* decode(ClaudeHooksDeleteResult, { deleted: true });
      assert.strictEqual(yes.deleted, true);

      const no = yield* decode(ClaudeHooksDeleteResult, { deleted: false });
      assert.strictEqual(no.deleted, false);
    }),
  );
});

describe("ClaudeHooksPullInInput", () => {
  it.effect("parses a pull-in request", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksPullInInput, {
        level: "global",
        fingerprint: "fp-xyz",
        name: "Adopted hook",
        description: "Was an unmanaged pre-existing hook",
      });
      assert.strictEqual(parsed.fingerprint, "fp-xyz");
      assert.strictEqual(parsed.name, "Adopted hook");
      assert.strictEqual(parsed.description, "Was an unmanaged pre-existing hook");
    }),
  );

  it.effect("rejects missing fingerprint", () =>
    decodeFail(ClaudeHooksPullInInput, {
      level: "global",
      name: "No fingerprint",
    }),
  );

  it.effect("rejects missing name", () =>
    decodeFail(ClaudeHooksPullInInput, {
      level: "global",
      fingerprint: "fp-xyz",
    }),
  );
});

describe("ClaudeHooksPullInResult", () => {
  it.effect("parses a pull-in result", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksPullInResult, {
        hookId: "new-managed-id",
        hook: {
          name: "Adopted",
          file: "committed",
          event: "PreToolUse",
          matcher: "Bash",
          action: { type: "command", command: "exit 1" },
        },
      });
      assert.strictEqual(parsed.hookId, "new-managed-id");
      assert.strictEqual(parsed.hook.name, "Adopted");
      assert.strictEqual(parsed.hook.file, "committed");
    }),
  );
});

// ── ClaudeHooksError ───────────────────────────────────────────────

describe("ClaudeHooksError", () => {
  it("constructs with correct message", () => {
    const err = new ClaudeHooksError({
      filePath: "/home/user/.config/t3/hooks-claude.json",
      detail: "JSON parse failed",
    });
    assert.include(err.message, "hooks-claude.json");
    assert.include(err.message, "JSON parse failed");
    assert.strictEqual(err._tag, "ClaudeHooksError");
  });
});

// ── All-projects result + stream events ────────────────────────────

describe("ClaudeHooksAllProjectsResult", () => {
  it.effect("parses a result with global and multiple projects", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksAllProjectsResult, {
        global: {
          managed: {},
          unmanaged: { committed: {}, local: {} },
          diagnostics: [],
        },
        projects: [
          {
            cwd: "/Users/sh/proj-a",
            title: "Project A",
            managed: {
              h1: {
                name: "Hook 1",
                file: "committed",
                event: "Stop",
                action: { type: "command", command: "echo a" },
              },
            },
            unmanaged: { committed: {}, local: {} },
            diagnostics: [],
          },
          {
            cwd: "/Users/sh/proj-b",
            title: "Project B",
            managed: {},
            unmanaged: { committed: {}, local: {} },
            diagnostics: [],
          },
        ],
      });
      assert.lengthOf(parsed.projects, 2);
      assert.strictEqual(parsed.projects[0]?.cwd, "/Users/sh/proj-a");
      assert.strictEqual(parsed.projects[0]?.managed.h1?.name, "Hook 1");
      assert.strictEqual(parsed.projects[1]?.title, "Project B");
    }),
  );
});

describe("ClaudeHooksStreamEvent", () => {
  it.effect("discriminates snapshot events", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksStreamEvent, {
        version: 1,
        type: "snapshot",
        payload: {
          global: { managed: {}, unmanaged: { committed: {}, local: {} }, diagnostics: [] },
          projects: [],
        },
      });
      assert.strictEqual(parsed.type, "snapshot");
    }),
  );

  it.effect("discriminates updated events", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksStreamEvent, {
        version: 1,
        type: "updated",
        payload: {
          global: { managed: {}, unmanaged: { committed: {}, local: {} }, diagnostics: [] },
          projects: [],
        },
      });
      assert.strictEqual(parsed.type, "updated");
    }),
  );

  it.effect("rejects unknown event type", () =>
    decodeFail(ClaudeHooksStreamEvent, {
      version: 1,
      type: "deleted",
      payload: {
        global: { managed: {}, unmanaged: { committed: {}, local: {} }, diagnostics: [] },
        projects: [],
      },
    }),
  );
});

describe("ClaudeHooksSubscribeInput", () => {
  it.effect("accepts empty object", () =>
    Effect.gen(function* () {
      const parsed = yield* decode(ClaudeHooksSubscribeInput, {});
      assert.deepEqual(parsed, {});
    }),
  );
});

// ── HooksLevel ─────────────────────────────────────────────────────

describe("HooksLevel", () => {
  it.effect("accepts global and project", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* decode(HooksLevel, "global"), "global");
      assert.strictEqual(yield* decode(HooksLevel, "project"), "project");
    }),
  );

  it.effect("rejects unknown levels", () => decodeFail(HooksLevel, "workspace"));
});
