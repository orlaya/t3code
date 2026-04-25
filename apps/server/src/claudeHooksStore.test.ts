/**
 * Tests for `claudeHooksStore.ts` — the pure generate/reconcile/fingerprint
 * helpers and the filesystem read/write/sync operations.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it, expect } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import type {
  HookAction,
  HookMatcherGroup,
  HooksClaudeFile,
  ManagedHookEntry,
  UnmanagedHooks,
} from "@t3tools/contracts";
import { fingerprintAction, stableStringify } from "@t3tools/shared/claudeHooksFingerprint";
import {
  generateSettingsHooks,
  fingerprintManagedHook,
  fingerprintManagedHooks,
  reconcileUnmanaged,
  takeUnmanagedActionByFingerprint,
  readHooksClaudeFile,
  writeHooksClaudeFile,
  syncSettingsFile,
  syncLevelSettingsFiles,
  hooksClaudeFilePath,
  settingsFilePath,
} from "./claudeHooksStore.ts";
import { ServerConfig } from "./config.ts";

// ── Helpers ────────���─────────────────────────────────────────────────

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(
    Layer.fresh(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-hooks-store-test-",
      }),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const cmd = (command: string): HookAction => ({ type: "command", command });
const prompt = (text: string): HookAction => ({ type: "prompt", prompt: text });

const managedHook = (
  overrides: Partial<ManagedHookEntry> & { event: string; action: HookAction },
): ManagedHookEntry => ({
  name: overrides.name ?? "Test hook",
  draft: overrides.draft ?? false,
  file: overrides.file ?? "committed",
  event: overrides.event as ManagedHookEntry["event"],
  action: overrides.action,
  ...(overrides.matcher !== undefined ? { matcher: overrides.matcher } : {}),
  ...(overrides.groupTimeout !== undefined ? { groupTimeout: overrides.groupTimeout } : {}),
  ...(overrides.description !== undefined ? { description: overrides.description } : {}),
});

// ── stableStringify ──────��───────────────────────────────────────────

describe("stableStringify", () => {
  it("sorts keys so insertion order doesn't matter", () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("sorts nested keys recursively", () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it("handles null and primitives", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(true)).toBe("true");
  });
});

// ─��� fingerprintAction / fingerprintManagedHook ──────────────────────

describe("fingerprinting", () => {
  it("produces identical fingerprints for identical event+matcher+action", () => {
    const fp1 = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    const fp2 = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    expect(fp1).toBe(fp2);
  });

  it("differs when the event changes", () => {
    const fp1 = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    const fp2 = fingerprintAction("PostToolUse", "Bash", cmd("exit 1"));
    expect(fp1).not.toBe(fp2);
  });

  it("differs when the matcher changes", () => {
    const fp1 = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    const fp2 = fingerprintAction("PreToolUse", "Grep", cmd("exit 1"));
    expect(fp1).not.toBe(fp2);
  });

  it("differs when the action changes", () => {
    const fp1 = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    const fp2 = fingerprintAction("PreToolUse", "Bash", cmd("exit 0"));
    expect(fp1).not.toBe(fp2);
  });

  it("treats undefined matcher as null for fingerprinting", () => {
    const fp1 = fingerprintAction("Stop", undefined, cmd("echo bye"));
    const fp2 = fingerprintAction("Stop", undefined, cmd("echo bye"));
    expect(fp1).toBe(fp2);
  });

  it("undefined and explicit matcher differ", () => {
    const fp1 = fingerprintAction("Stop", undefined, cmd("echo"));
    const fp2 = fingerprintAction("Stop", "Bash", cmd("echo"));
    expect(fp1).not.toBe(fp2);
  });

  it("fingerprintManagedHook delegates to fingerprintAction correctly", () => {
    const hook = managedHook({ event: "PreToolUse", matcher: "Bash", action: cmd("exit 1") });
    const fromHook = fingerprintManagedHook(hook);
    const direct = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    expect(fromHook).toBe(direct);
  });

  it("fingerprintManagedHooks builds set from all hooks including drafts", () => {
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "PreToolUse", action: cmd("echo a") }),
      id2: managedHook({ event: "Stop", action: cmd("echo b"), draft: true }),
    };
    const fps = fingerprintManagedHooks(managed);
    expect(fps.size).toBe(2);
    expect(fps.has(fingerprintAction("PreToolUse", undefined, cmd("echo a")))).toBe(true);
    expect(fps.has(fingerprintAction("Stop", undefined, cmd("echo b")))).toBe(true);
  });

  it("action key order doesn't affect fingerprint", () => {
    // Build two actions with the same content but different insertion order
    const a: HookAction = { type: "command", command: "echo hi", timeout: 10 };
    const b: HookAction = { timeout: 10, type: "command", command: "echo hi" } as HookAction;
    expect(fingerprintAction("Stop", undefined, a)).toBe(fingerprintAction("Stop", undefined, b));
  });
});

// ── generateSettingsHooks ──────────────���────────────────────────────

describe("generateSettingsHooks", () => {
  it("generates from managed-only hooks", () => {
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "PreToolUse", matcher: "Bash", action: cmd("exit 1") }),
    };
    const result = generateSettingsHooks(managed, {});
    expect(result.PreToolUse).toBeDefined();
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.matcher).toBe("Bash");
    expect(result.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks[0]).toEqual(cmd("exit 1"));
  });

  it("skips draft hooks", () => {
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "PreToolUse", action: cmd("exit 1"), draft: true }),
    };
    const result = generateSettingsHooks(managed, {});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("merges managed actions into matching unmanaged groups", () => {
    const unmanaged: Record<string, ReadonlyArray<HookMatcherGroup>> = {
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo pre-existing")] }],
    };
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "PreToolUse", matcher: "Bash", action: cmd("exit 1") }),
    };
    const result = generateSettingsHooks(managed, unmanaged);
    // Should be one group with two actions, not two groups
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks).toHaveLength(2);
    expect(result.PreToolUse![0]!.hooks[0]).toEqual(cmd("echo pre-existing"));
    expect(result.PreToolUse![0]!.hooks[1]).toEqual(cmd("exit 1"));
  });

  it("creates separate groups when matcher differs", () => {
    const unmanaged: Record<string, ReadonlyArray<HookMatcherGroup>> = {
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo pre-existing")] }],
    };
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "PreToolUse", matcher: "Grep", action: cmd("exit 1") }),
    };
    const result = generateSettingsHooks(managed, unmanaged);
    expect(result.PreToolUse).toHaveLength(2);
  });

  it("creates separate groups when groupTimeout differs", () => {
    const unmanaged: Record<string, ReadonlyArray<HookMatcherGroup>> = {
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo")], timeout: 30 }],
    };
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({
        event: "PreToolUse",
        matcher: "Bash",
        action: cmd("exit 1"),
        groupTimeout: 60,
      }),
    };
    const result = generateSettingsHooks(managed, unmanaged);
    expect(result.PreToolUse).toHaveLength(2);
    expect(result.PreToolUse![0]!.timeout).toBe(30);
    expect(result.PreToolUse![1]!.timeout).toBe(60);
  });

  it("handles catch-all groups (no matcher)", () => {
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "Stop", action: cmd("echo bye") }),
    };
    const result = generateSettingsHooks(managed, {});
    expect(result.Stop).toHaveLength(1);
    expect(result.Stop![0]!.matcher).toBeUndefined();
  });

  it("produces deterministic output regardless of ID ordering", () => {
    const managed: Record<string, ManagedHookEntry> = {
      zzz: managedHook({ event: "Stop", action: cmd("echo z") }),
      aaa: managedHook({ event: "Stop", action: cmd("echo a") }),
    };
    const result = generateSettingsHooks(managed, {});
    // Sorted by ID: aaa before zzz
    expect(result.Stop![0]!.hooks[0]).toEqual(cmd("echo a"));
    expect(result.Stop![0]!.hooks[1]).toEqual(cmd("echo z"));
  });

  it("handles multiple events", () => {
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "PreToolUse", matcher: "Bash", action: cmd("exit 1") }),
      id2: managedHook({ event: "Stop", action: prompt("summarize") }),
    };
    const result = generateSettingsHooks(managed, {});
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.Stop).toHaveLength(1);
  });

  it("preserves unmanaged groups when no managed hooks exist", () => {
    const unmanaged: Record<string, ReadonlyArray<HookMatcherGroup>> = {
      Stop: [{ hooks: [cmd("echo bye")] }],
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("check")] }],
    };
    const result = generateSettingsHooks({}, unmanaged);
    expect(result.Stop).toHaveLength(1);
    expect(result.PreToolUse).toHaveLength(1);
  });

  it("does not include groupTimeout or matcher when undefined", () => {
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "Stop", action: cmd("echo") }),
    };
    const result = generateSettingsHooks(managed, {});
    const group = result.Stop![0]!;
    expect("matcher" in group).toBe(false);
    expect("timeout" in group).toBe(false);
  });

  it("multiple managed hooks with same event+matcher produce one group with both actions", () => {
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({ event: "PreToolUse", matcher: "Bash", action: cmd("exit 1") }),
      id2: managedHook({ event: "PreToolUse", matcher: "Bash", action: cmd("echo check") }),
    };
    const result = generateSettingsHooks(managed, {});
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks).toHaveLength(2);
    // Ordered by hook ID: id1 before id2
    expect(result.PreToolUse![0]!.hooks[0]).toEqual(cmd("exit 1"));
    expect(result.PreToolUse![0]!.hooks[1]).toEqual(cmd("echo check"));
  });

  it("managed hook merges into matching unmanaged group with same matcher and timeout", () => {
    const unmanaged: Record<string, ReadonlyArray<HookMatcherGroup>> = {
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo pre-existing")], timeout: 30 }],
    };
    const managed: Record<string, ManagedHookEntry> = {
      id1: managedHook({
        event: "PreToolUse",
        matcher: "Bash",
        action: cmd("exit 1"),
        groupTimeout: 30,
      }),
    };
    const result = generateSettingsHooks(managed, unmanaged);
    // Same matcher + same timeout → merged into one group
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks).toHaveLength(2);
    expect(result.PreToolUse![0]!.timeout).toBe(30);
    expect(result.PreToolUse![0]!.hooks[0]).toEqual(cmd("echo pre-existing"));
    expect(result.PreToolUse![0]!.hooks[1]).toEqual(cmd("exit 1"));
  });
});

// ── reconcileUnmanaged ────────────��─────────────────────────────────

describe("reconcileUnmanaged", () => {
  it("returns everything when no managed fingerprints exist", () => {
    const settings = {
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo hi")] } satisfies HookMatcherGroup],
    };
    const result = reconcileUnmanaged(settings, new Set());
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks).toHaveLength(1);
  });

  it("strips actions that match managed fingerprints", () => {
    const action = cmd("exit 1");
    const fp = fingerprintAction("PreToolUse", "Bash", action);

    const settings = {
      PreToolUse: [
        { matcher: "Bash", hooks: [action, cmd("echo other")] } satisfies HookMatcherGroup,
      ],
    };
    const result = reconcileUnmanaged(settings, new Set([fp]));
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks[0]).toEqual(cmd("echo other"));
  });

  it("drops entire matcher group when all actions are claimed", () => {
    const action = cmd("exit 1");
    const fp = fingerprintAction("PreToolUse", "Bash", action);

    const settings = {
      PreToolUse: [{ matcher: "Bash", hooks: [action] } satisfies HookMatcherGroup],
    };
    const result = reconcileUnmanaged(settings, new Set([fp]));
    expect(result.PreToolUse).toBeUndefined();
  });

  it("drops entire event when all groups are empty", () => {
    const a1 = cmd("exit 1");
    const a2 = cmd("exit 2");
    const fp1 = fingerprintAction("PreToolUse", "Bash", a1);
    const fp2 = fingerprintAction("PreToolUse", undefined, a2);

    const settings = {
      PreToolUse: [
        { matcher: "Bash", hooks: [a1] } satisfies HookMatcherGroup,
        { hooks: [a2] } satisfies HookMatcherGroup,
      ],
    };
    const result = reconcileUnmanaged(settings, new Set([fp1, fp2]));
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("preserves group timeout on remaining groups", () => {
    const settings = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [cmd("claimed"), cmd("remains")],
          timeout: 30,
        } satisfies HookMatcherGroup,
      ],
    };
    const fp = fingerprintAction("PreToolUse", "Bash", cmd("claimed"));
    const result = reconcileUnmanaged(settings, new Set([fp]));
    expect(result.PreToolUse![0]!.timeout).toBe(30);
  });

  it("handles reordered matcher groups gracefully", () => {
    // Two groups, different matchers — claim one action from each
    const a1 = cmd("exit 1");
    const a2 = cmd("echo hello");
    const fp1 = fingerprintAction("PreToolUse", "Bash", a1);

    const settings = {
      PreToolUse: [
        { matcher: "Bash", hooks: [a1, cmd("other-bash")] } satisfies HookMatcherGroup,
        { matcher: "Grep", hooks: [a2] } satisfies HookMatcherGroup,
      ],
    };
    const result = reconcileUnmanaged(settings, new Set([fp1]));
    expect(result.PreToolUse).toHaveLength(2);
    expect(result.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks[0]).toEqual(cmd("other-bash"));
    expect(result.PreToolUse![1]!.hooks[0]).toEqual(a2);
  });

  it("does not claim action when content matches but matcher differs", () => {
    const action = cmd("exit 1");
    // Fingerprint is for (PreToolUse, "Bash", cmd("exit 1"))
    const fp = fingerprintAction("PreToolUse", "Bash", action);

    // Same action content, but under matcher "Grep" — should NOT be claimed
    const settings = {
      PreToolUse: [{ matcher: "Grep", hooks: [action] } satisfies HookMatcherGroup],
    };
    const result = reconcileUnmanaged(settings, new Set([fp]));
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(result.PreToolUse![0]!.hooks[0]).toEqual(action);
  });

  it("claims only the matching event when same action exists under two events", () => {
    const action = cmd("echo");
    const fpPreToolUse = fingerprintAction("PreToolUse", undefined, action);

    const settings = {
      PreToolUse: [{ hooks: [action] } satisfies HookMatcherGroup],
      Stop: [{ hooks: [action] } satisfies HookMatcherGroup],
    };
    const result = reconcileUnmanaged(settings, new Set([fpPreToolUse]));
    // PreToolUse claimed → gone
    expect(result.PreToolUse).toBeUndefined();
    // Stop NOT claimed → survives
    expect(result.Stop).toHaveLength(1);
    expect(result.Stop![0]!.hooks[0]).toEqual(action);
  });
});

// ── takeUnmanagedActionByFingerprint ────────────────────────────────

describe("takeUnmanagedActionByFingerprint", () => {
  const baseUnmanaged: UnmanagedHooks = {
    committed: {
      PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit 1"), cmd("echo other")] }],
      Stop: [{ hooks: [cmd("echo bye")] }],
    },
    local: {
      Stop: [{ hooks: [prompt("summarize")] }],
    },
  };

  it("finds and removes a committed action", () => {
    const fp = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    const result = takeUnmanagedActionByFingerprint(baseUnmanaged, fp);
    expect(result).not.toBeNull();
    expect(result!.taken.file).toBe("committed");
    expect(result!.taken.event).toBe("PreToolUse");
    expect(result!.taken.matcher).toBe("Bash");
    expect(result!.taken.action).toEqual(cmd("exit 1"));
    // Remaining group still has one action
    expect(result!.unmanaged.committed.PreToolUse).toHaveLength(1);
    expect(result!.unmanaged.committed.PreToolUse![0]!.hooks[0]).toEqual(cmd("echo other"));
  });

  it("finds and removes a local action", () => {
    const fp = fingerprintAction("Stop", undefined, prompt("summarize"));
    const result = takeUnmanagedActionByFingerprint(baseUnmanaged, fp);
    expect(result).not.toBeNull();
    expect(result!.taken.file).toBe("local");
    expect(result!.taken.event).toBe("Stop");
  });

  it("drops the entire group when last action is taken", () => {
    const fp = fingerprintAction("Stop", undefined, cmd("echo bye"));
    const result = takeUnmanagedActionByFingerprint(baseUnmanaged, fp);
    expect(result).not.toBeNull();
    // Stop event should be gone from committed
    expect(result!.unmanaged.committed.Stop).toBeUndefined();
  });

  it("drops the event key when last group is taken", () => {
    const unmanaged: UnmanagedHooks = {
      committed: {
        Stop: [{ hooks: [cmd("only-one")] }],
      },
      local: {},
    };
    const fp = fingerprintAction("Stop", undefined, cmd("only-one"));
    const result = takeUnmanagedActionByFingerprint(unmanaged, fp);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.unmanaged.committed)).toHaveLength(0);
  });

  it("returns null when fingerprint doesn't match anything", () => {
    const fp = fingerprintAction("Stop", undefined, cmd("nonexistent"));
    const result = takeUnmanagedActionByFingerprint(baseUnmanaged, fp);
    expect(result).toBeNull();
  });

  it("preserves groupTimeout on taken action", () => {
    const unmanaged: UnmanagedHooks = {
      committed: {
        PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit 1")], timeout: 30 }],
      },
      local: {},
    };
    const fp = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    const result = takeUnmanagedActionByFingerprint(unmanaged, fp);
    expect(result!.taken.groupTimeout).toBe(30);
  });

  it("does not mutate the original unmanaged object", () => {
    const fp = fingerprintAction("PreToolUse", "Bash", cmd("exit 1"));
    const result = takeUnmanagedActionByFingerprint(baseUnmanaged, fp);
    expect(result).not.toBeNull();
    // Original should still have both actions
    expect(baseUnmanaged.committed.PreToolUse![0]!.hooks).toHaveLength(2);
  });

  it("searches committed before local", () => {
    // Same action in both committed and local — should find committed first
    const unmanaged: UnmanagedHooks = {
      committed: { Stop: [{ hooks: [cmd("echo")] }] },
      local: { Stop: [{ hooks: [cmd("echo")] }] },
    };
    const fp = fingerprintAction("Stop", undefined, cmd("echo"));
    const result = takeUnmanagedActionByFingerprint(unmanaged, fp);
    expect(result!.taken.file).toBe("committed");
    // Local copy should still be there
    expect(result!.unmanaged.local.Stop).toHaveLength(1);
  });
});

// ── Filesystem-backed operations ────────────────────────────────────

it.layer(TestLayer)("claudeHooksStore filesystem", (it) => {
  // ── readHooksClaudeFile / writeHooksClaudeFile ─────────────────

  describe("readHooksClaudeFile", () => {
    it.effect("returns empty file shape when file doesn't exist", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const file = yield* readHooksClaudeFile(config.stateDir);
        expect(file.version).toBe(1);
        expect(file.global.managed).toEqual({});
        expect(file.projects).toEqual({});
      }),
    );

    it.effect("round-trips a written file", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const data: HooksClaudeFile = {
          version: 1,
          global: {
            managed: {
              abc: managedHook({ event: "PreToolUse", matcher: "Bash", action: cmd("exit 1") }),
            },
            unmanaged: { committed: {}, local: {} },
          },
          projects: {},
        };
        yield* writeHooksClaudeFile(config.stateDir, data);
        const readBack = yield* readHooksClaudeFile(config.stateDir);
        expect(readBack.version).toBe(1);
        expect(readBack.global.managed.abc?.name).toBe("Test hook");
        expect(readBack.global.managed.abc?.action).toEqual(cmd("exit 1"));
      }),
    );

    it.effect("returns empty file shape for empty file content", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const filePath = hooksClaudeFilePath(pathService, config.stateDir);
        yield* fs.makeDirectory(pathService.dirname(filePath), { recursive: true });
        yield* fs.writeFileString(filePath, "");
        const file = yield* readHooksClaudeFile(config.stateDir);
        expect(file.version).toBe(1);
        expect(file.global.managed).toEqual({});
      }),
    );
  });

  // ── syncSettingsFile ───────────────────────────────────────────

  describe("syncSettingsFile", () => {
    it.effect("writes managed hooks to the committed settings file", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-sync-test-" });
        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
        };
        const unmanaged: UnmanagedHooks = { committed: {}, local: {} };

        yield* syncSettingsFile("project", "committed", managed, unmanaged, projectDir);

        const filePath = settingsFilePath(pathService, "project", "committed", projectDir);
        const raw = yield* fs.readFileString(filePath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const hooks = parsed["hooks"] as Record<string, unknown>;
        expect(hooks).toBeDefined();
        expect(hooks["PreToolUse"]).toBeDefined();
      }),
    );

    it.effect("does not write local-targeted hooks into the committed file", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;

        // Use project level so we're writing to a temp dir, not ~/.claude/
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-proj-test-" });
        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({
            event: "PreToolUse",
            action: cmd("exit 1"),
            file: "local", // targets local, not committed
          }),
        };
        const unmanaged: UnmanagedHooks = { committed: {}, local: {} };

        yield* syncSettingsFile("project", "committed", managed, unmanaged, projectDir);

        const filePath = settingsFilePath(pathService, "project", "committed", projectDir);
        const exists = yield* fs.exists(filePath);
        // File shouldn't exist because there's nothing to write to committed
        expect(exists).toBe(false);
      }),
    );

    it.effect("writes local-targeted hooks to the local settings file", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-local-test-" });
        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({
            event: "Stop",
            action: cmd("echo bye"),
            file: "local",
          }),
        };
        const unmanaged: UnmanagedHooks = { committed: {}, local: {} };

        yield* syncSettingsFile("project", "local", managed, unmanaged, projectDir);

        const filePath = settingsFilePath(pathService, "project", "local", projectDir);
        const raw = yield* fs.readFileString(filePath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const hooks = parsed["hooks"] as Record<string, unknown>;
        expect(hooks).toBeDefined();
        expect(hooks["Stop"]).toBeDefined();
      }),
    );

    it.effect("preserves non-hook keys in the settings file", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-preserve-test-" });
        const filePath = settingsFilePath(pathService, "project", "committed", projectDir);

        // Pre-populate with some other keys
        yield* fs.makeDirectory(pathService.dirname(filePath), { recursive: true });
        yield* fs.writeFileString(
          filePath,
          JSON.stringify({ permissions: { allow: ["Bash"] }, theme: "dark" }, null, 2),
        );

        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({ event: "Stop", action: cmd("echo"), file: "committed" }),
        };
        yield* syncSettingsFile(
          "project",
          "committed",
          managed,
          { committed: {}, local: {} },
          projectDir,
        );

        const raw = yield* fs.readFileString(filePath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(parsed["theme"]).toBe("dark");
        expect((parsed["permissions"] as Record<string, unknown>)["allow"]).toEqual(["Bash"]);
        expect(parsed["hooks"]).toBeDefined();
      }),
    );

    it.effect("preserves file content on idempotent sync", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;

        // Use project level to avoid touching ~/.claude/
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-idem-test-" });

        // Pre-populate with hooks + extra keys
        const filePath = settingsFilePath(pathService, "project", "committed", projectDir);
        yield* fs.makeDirectory(pathService.dirname(filePath), { recursive: true });
        const initialContent = JSON.stringify(
          {
            permissions: { allow: ["Bash"] },
            hooks: { Stop: [{ hooks: [{ type: "command", command: "echo" }] }] },
          },
          null,
          2,
        );
        yield* fs.writeFileString(filePath, initialContent);

        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({ event: "Stop", action: cmd("echo"), file: "committed" }),
        };
        const unmanaged: UnmanagedHooks = { committed: {}, local: {} };

        // Sync — should no-op because the hooks content is the same
        yield* syncSettingsFile("project", "committed", managed, unmanaged, projectDir);

        // File content should be exactly unchanged (byte-identical)
        const afterSync = yield* fs.readFileString(filePath);
        expect(afterSync).toBe(initialContent);
      }),
    );

    it.effect("removes file when it becomes entirely empty", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-remove-test-" });
        const filePath = settingsFilePath(pathService, "project", "committed", projectDir);

        // Write a file with only hooks
        yield* fs.makeDirectory(pathService.dirname(filePath), { recursive: true });
        yield* fs.writeFileString(
          filePath,
          JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo" }] }] } }),
        );

        // Sync with no hooks — should delete
        yield* syncSettingsFile(
          "project",
          "committed",
          {},
          { committed: {}, local: {} },
          projectDir,
        );

        const exists = yield* fs.exists(filePath);
        expect(exists).toBe(false);
      }),
    );

    it.effect("does not write draft hooks to settings files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-draft-test-" });
        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({
            event: "PreToolUse",
            action: cmd("exit 1"),
            file: "committed",
            draft: true,
          }),
        };
        const unmanaged: UnmanagedHooks = { committed: {}, local: {} };

        yield* syncSettingsFile("project", "committed", managed, unmanaged, projectDir);

        const filePath = settingsFilePath(pathService, "project", "committed", projectDir);
        const exists = yield* fs.exists(filePath);
        expect(exists).toBe(false);
      }),
    );

    it.effect("includes unmanaged hooks alongside managed in generated file", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-merge-test-" });
        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({
            event: "Stop",
            action: cmd("echo managed"),
            file: "committed",
          }),
        };
        const unmanaged: UnmanagedHooks = {
          committed: {
            PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo unmanaged")] }],
          },
          local: {},
        };

        yield* syncSettingsFile("project", "committed", managed, unmanaged, projectDir);

        const filePath = settingsFilePath(pathService, "project", "committed", projectDir);
        const raw = yield* fs.readFileString(filePath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const hooks = parsed["hooks"] as Record<string, unknown>;
        expect(hooks["Stop"]).toBeDefined();
        expect(hooks["PreToolUse"]).toBeDefined();
      }),
    );
  });

  // ── syncLevelSettingsFiles ─────────────────────────────────────

  describe("syncLevelSettingsFiles", () => {
    it.effect("writes committed and local hooks to their respective files", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const pathService = yield* Path.Path;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-level-test-" });
        const managed: Record<string, ManagedHookEntry> = {
          id1: managedHook({
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
          id2: managedHook({
            event: "Stop",
            action: prompt("summarize"),
            file: "local",
          }),
        };
        const unmanaged: UnmanagedHooks = { committed: {}, local: {} };

        yield* syncLevelSettingsFiles("project", managed, unmanaged, projectDir);

        const committedPath = settingsFilePath(pathService, "project", "committed", projectDir);
        const localPath = settingsFilePath(pathService, "project", "local", projectDir);

        const committedRaw = yield* fs.readFileString(committedPath);
        const localRaw = yield* fs.readFileString(localPath);
        const committed = JSON.parse(committedRaw) as Record<string, unknown>;
        const local = JSON.parse(localRaw) as Record<string, unknown>;

        // Committed file has PreToolUse but NOT Stop
        const committedHooks = committed["hooks"] as Record<string, unknown>;
        expect(committedHooks["PreToolUse"]).toBeDefined();
        expect(committedHooks["Stop"]).toBeUndefined();

        // Local file has Stop but NOT PreToolUse
        const localHooks = local["hooks"] as Record<string, unknown>;
        expect(localHooks["Stop"]).toBeDefined();
        expect(localHooks["PreToolUse"]).toBeUndefined();
      }),
    );
  });

  // ── Project-level path resolution ──────────────────────────────

  describe("settingsFilePath", () => {
    it.effect("global committed path is under ~/.claude/", () =>
      Effect.gen(function* () {
        const pathService = yield* Path.Path;
        const result = settingsFilePath(pathService, "global", "committed", "/whatever");
        expect(result).toContain(".claude/settings.json");
        expect(result).not.toContain("/whatever");
      }),
    );

    it.effect("project committed path is under {cwd}/.claude/", () =>
      Effect.gen(function* () {
        const pathService = yield* Path.Path;
        const result = settingsFilePath(pathService, "project", "committed", "/my/project");
        expect(result).toBe("/my/project/.claude/settings.json");
      }),
    );

    it.effect("project local path is under {cwd}/.claude/", () =>
      Effect.gen(function* () {
        const pathService = yield* Path.Path;
        const result = settingsFilePath(pathService, "project", "local", "/my/project");
        expect(result).toBe("/my/project/.claude/settings.local.json");
      }),
    );
  });
});
