/**
 * Tests for `claudeHooks.ts` — the RPC handlers that orchestrate
 * managed/unmanaged hooks through the metadata layer and settings files.
 *
 * These are integration-style tests: they hit the real filesystem via
 * temp dirs (project-level settings only, never ~/.claude/) and exercise
 * the full write→read→sync→reconcile cycle.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ManagedHookEntry, HookAction, ClaudeHooksWriteInput } from "@t3tools/contracts";
import { fingerprintAction } from "@t3tools/shared/claudeHooksFingerprint";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";

const SettingsObject = Schema.Record(Schema.String, Schema.Unknown);
const decodeSettingsObject = Schema.decodeUnknownSync(fromLenientJson(SettingsObject));
const encodeSettingsObject = Schema.encodeUnknownSync(fromJsonStringPretty(SettingsObject));
import { getClaudeHooks, writeClaudeHook, deleteClaudeHook, pullInHook } from "./claudeHooks.ts";
import { readHooksClaudeFile, writeHooksClaudeFile, settingsFilePath } from "./claudeHooksStore.ts";
import { ServerConfig } from "./config.ts";

// ── Helpers ────────────────────────────────────────────────────────

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(
    Layer.fresh(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-hooks-rpc-test-",
      }),
    ),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const cmd = (command: string): HookAction => ({ type: "command", command });

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

/** Read the hooks JSON from a project's committed settings file. */
const readProjectSettingsHooks = (projectDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = settingsFilePath(pathService, "project", "committed", projectDir);
    const exists = yield* fs.exists(filePath);
    if (!exists) return null;
    const raw = yield* fs.readFileString(filePath);
    const parsed = decodeSettingsObject(raw);
    return (parsed["hooks"] ?? null) as Record<string, unknown> | null;
  });

/** Read the hooks JSON from a project's local settings file. */
const readProjectLocalSettingsHooks = (projectDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = settingsFilePath(pathService, "project", "local", projectDir);
    const exists = yield* fs.exists(filePath);
    if (!exists) return null;
    const raw = yield* fs.readFileString(filePath);
    const parsed = decodeSettingsObject(raw);
    return (parsed["hooks"] ?? null) as Record<string, unknown> | null;
  });

/**
 * Seed a project-level settings file with some pre-existing hooks.
 * Simulates what a user would have before T3 adopts the file.
 */
const seedProjectSettings = (
  projectDir: string,
  file: "committed" | "local",
  hooks: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = settingsFilePath(pathService, "project", file, projectDir);
    yield* fs.makeDirectory(pathService.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(filePath, encodeSettingsObject({ hooks }));
  });

// ── Tests ──────────────────────────────────────────────────────────

it.layer(TestLayer)("claudeHooks RPC handlers", (it) => {
  // ── writeClaudeHook ─────────────────────────────────────────────

  describe("writeClaudeHook", () => {
    it.effect("creates a new managed hook and writes to settings file", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-write-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed hooks-claude.json with the project
        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const input: ClaudeHooksWriteInput = {
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Block background bash",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
        };

        const result = yield* writeClaudeHook(input);
        expect(result.hookId).toBeDefined();
        expect(result.hook.name).toBe("Block background bash");

        // Verify hooks-claude.json was updated
        const hooksFile = yield* readHooksClaudeFile(config.stateDir);
        const projectLevel = hooksFile.projects[realProjectDir];
        expect(projectLevel).toBeDefined();
        expect(projectLevel!.managed[result.hookId]).toBeDefined();

        // Verify settings.json was written
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).not.toBeNull();
        expect(settingsHooks!["PreToolUse"]).toBeDefined();
      }),
    );

    it.effect("updates an existing managed hook by hookId", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-update-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Create
        const created = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Original",
            event: "Stop",
            action: cmd("echo original"),
            file: "committed",
          }),
        });

        // Update
        const updated = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: created.hookId,
          hook: managedHook({
            name: "Updated",
            event: "Stop",
            action: cmd("echo updated"),
            file: "committed",
          }),
        });

        expect(updated.hookId).toBe(created.hookId);
        expect(updated.hook.name).toBe("Updated");

        // Only one hook should exist
        const hooksFile = yield* readHooksClaudeFile(config.stateDir);
        const managed = hooksFile.projects[realProjectDir]!.managed;
        expect(Object.keys(managed)).toHaveLength(1);
        expect(managed[created.hookId]!.name).toBe("Updated");
        expect(managed[created.hookId]!.action).toEqual(cmd("echo updated"));
      }),
    );

    it.effect("writes committed hook to settings.json and local hook to settings.local.json", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-target-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Create a committed hook
        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Committed hook",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
        });

        // Create a local hook
        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Local hook",
            event: "Stop",
            action: cmd("echo local"),
            file: "local",
          }),
        });

        // Committed settings file has PreToolUse, not Stop
        const committedHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(committedHooks).not.toBeNull();
        expect(committedHooks!["PreToolUse"]).toBeDefined();
        expect(committedHooks!["Stop"]).toBeUndefined();

        // Local settings file has Stop, not PreToolUse
        const localHooks = yield* readProjectLocalSettingsHooks(realProjectDir);
        expect(localHooks).not.toBeNull();
        expect(localHooks!["Stop"]).toBeDefined();
        expect(localHooks!["PreToolUse"]).toBeUndefined();
      }),
    );

    it.effect("draft hooks are stored but not written to settings files", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-draft-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const result = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Draft hook",
            event: "PreToolUse",
            action: cmd("exit 1"),
            file: "committed",
            draft: true,
          }),
        });

        // Should be in hooks-claude.json
        const hooksFile = yield* readHooksClaudeFile(config.stateDir);
        expect(hooksFile.projects[realProjectDir]!.managed[result.hookId]!.draft).toBe(true);

        // Should NOT be in settings.json
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).toBeNull();
      }),
    );

    it.effect("toggling draft off writes the hook to the settings file", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-undraft-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Create as draft
        const created = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Was draft",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
            draft: true,
          }),
        });

        // Not in settings yet
        expect(yield* readProjectSettingsHooks(realProjectDir)).toBeNull();

        // Toggle to non-draft
        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: created.hookId,
          hook: managedHook({
            name: "Was draft",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
            draft: false,
          }),
        });

        // Now it should be in settings
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).not.toBeNull();
        expect(settingsHooks!["PreToolUse"]).toBeDefined();
      }),
    );

    it.effect("toggling draft on removes the hook from the settings file", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-redraft-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Create as live
        const created = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Going draft",
            event: "Stop",
            action: cmd("echo bye"),
            file: "committed",
          }),
        });

        // Should be in settings
        expect(yield* readProjectSettingsHooks(realProjectDir)).not.toBeNull();

        // Toggle to draft
        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: created.hookId,
          hook: managedHook({
            name: "Going draft",
            event: "Stop",
            action: cmd("echo bye"),
            file: "committed",
            draft: true,
          }),
        });

        // Should be removed from settings
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).toBeNull();
      }),
    );
    it.effect(
      "changing file target from committed to local moves hook between settings files",
      () =>
        Effect.gen(function* () {
          const config = yield* ServerConfig;
          const fs = yield* FileSystem.FileSystem;
          const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-retarget-" });
          const realProjectDir = yield* fs.realPath(projectDir);

          yield* writeHooksClaudeFile(config.stateDir, {
            version: 1,
            global: { managed: {}, unmanaged: { committed: {}, local: {} } },
            projects: {
              [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } },
            },
          });

          // Create as committed
          const created = yield* writeClaudeHook({
            cwd: projectDir,
            level: "project",
            hook: managedHook({
              name: "Retarget me",
              event: "PreToolUse",
              matcher: "Bash",
              action: cmd("exit 1"),
              file: "committed",
            }),
          });

          // Verify it's in committed settings
          expect(yield* readProjectSettingsHooks(realProjectDir)).not.toBeNull();
          expect(yield* readProjectLocalSettingsHooks(realProjectDir)).toBeNull();

          // Update to local
          yield* writeClaudeHook({
            cwd: projectDir,
            level: "project",
            hookId: created.hookId,
            hook: managedHook({
              name: "Retarget me",
              event: "PreToolUse",
              matcher: "Bash",
              action: cmd("exit 1"),
              file: "local",
            }),
          });

          // Should vanish from committed and appear in local
          const committedHooks = yield* readProjectSettingsHooks(realProjectDir);
          expect(committedHooks).toBeNull();

          const localHooks = yield* readProjectLocalSettingsHooks(realProjectDir);
          expect(localHooks).not.toBeNull();
          expect(localHooks!["PreToolUse"]).toBeDefined();
        }),
    );

    it.effect("changing event moves hook cleanly — old action does not ghost as unmanaged", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-event-change-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Create with PreToolUse
        const created = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Event changer",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
        });

        let settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks!["PreToolUse"]).toBeDefined();

        // Update to Stop event
        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: created.hookId,
          hook: managedHook({
            name: "Event changer",
            event: "Stop",
            action: cmd("exit 1"),
            file: "committed",
          }),
        });

        // The managed hook is now under Stop, old PreToolUse is gone
        settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks!["Stop"]).toBeDefined();
        expect(settingsHooks!["PreToolUse"]).toBeUndefined();

        // Verify via getClaudeHooks — only one managed hook, no unmanaged ghosts
        const result = yield* getClaudeHooks(projectDir);
        expect(Object.keys(result.project.managed)).toHaveLength(1);
        expect(result.project.managed[created.hookId]!.event).toBe("Stop");
        expect(result.project.unmanaged.committed["PreToolUse"]).toBeUndefined();
      }),
    );

    it.effect("two managed hooks with same event+matcher merge into one settings group", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-merge-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Hook A",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
        });

        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Hook B",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("echo check"),
            file: "committed",
          }),
        });

        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).not.toBeNull();
        // ONE matcher group with TWO actions, not two separate groups
        const groups = settingsHooks!["PreToolUse"] as Array<{ hooks: unknown[] }>;
        expect(groups).toHaveLength(1);
        expect(groups[0]!.hooks).toHaveLength(2);
      }),
    );
  });

  // ── deleteClaudeHook ────────────────────────────────────────────

  describe("deleteClaudeHook", () => {
    it.effect("deletes a managed hook by hookId and removes from settings", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-delete-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Create
        const created = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            event: "Stop",
            action: cmd("echo bye"),
            file: "committed",
          }),
        });

        // Delete
        const result = yield* deleteClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: created.hookId,
        });
        expect(result.deleted).toBe(true);

        // Gone from hooks-claude.json
        const hooksFile = yield* readHooksClaudeFile(config.stateDir);
        expect(hooksFile.projects[realProjectDir]!.managed[created.hookId]).toBeUndefined();

        // Gone from settings.json (action doesn't resurface as unmanaged)
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).toBeNull();
      }),
    );

    it.effect("returns deleted: false for nonexistent hookId", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-delmiss-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const result = yield* deleteClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: "nonexistent-id",
        });
        expect(result.deleted).toBe(false);
      }),
    );

    it.effect("deletes an unmanaged hook by fingerprint", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-delumanaged-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed a settings file with a pre-existing hook
        yield* seedProjectSettings(realProjectDir, "committed", {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "echo pre-existing" }] },
          ],
        });

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const fp = fingerprintAction("PreToolUse", "Bash", cmd("echo pre-existing"));
        const result = yield* deleteClaudeHook({
          cwd: projectDir,
          level: "project",
          fingerprint: fp,
        });
        expect(result.deleted).toBe(true);

        // Settings file should no longer have the hook
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).toBeNull();
      }),
    );

    it.effect("deleting one managed hook doesn't affect others", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-delone-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const hookA = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Hook A",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
        });

        const hookB = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Hook B",
            event: "Stop",
            action: cmd("echo done"),
            file: "committed",
          }),
        });

        // Delete A only
        yield* deleteClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: hookA.hookId,
        });

        // B should still be in both hooks-claude.json and settings
        const hooksFile = yield* readHooksClaudeFile(config.stateDir);
        const managed = hooksFile.projects[realProjectDir]!.managed;
        expect(managed[hookA.hookId]).toBeUndefined();
        expect(managed[hookB.hookId]).toBeDefined();
        expect(managed[hookB.hookId]!.name).toBe("Hook B");

        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).not.toBeNull();
        expect(settingsHooks!["Stop"]).toBeDefined();
        expect(settingsHooks!["PreToolUse"]).toBeUndefined();
      }),
    );

    it.effect("deleting managed hook preserves unmanaged hooks in settings file", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-del-preserve-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed an unmanaged hook in settings
        yield* seedProjectSettings(realProjectDir, "committed", {
          PreToolUse: [
            { matcher: "Grep", hooks: [{ type: "command", command: "echo unmanaged" }] },
          ],
        });

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Create a managed hook
        const created = yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hook: managedHook({
            name: "Will be deleted",
            event: "Stop",
            action: cmd("echo bye"),
            file: "committed",
          }),
        });

        // Delete the managed hook
        yield* deleteClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: created.hookId,
        });

        // Settings file should still exist with the unmanaged hook
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).not.toBeNull();
        expect(settingsHooks!["PreToolUse"]).toBeDefined();
        expect(settingsHooks!["Stop"]).toBeUndefined();
      }),
    );
  });

  // ── pullInHook ──────────────────────────────────────────────────

  describe("pullInHook", () => {
    it.effect("adopts an unmanaged hook as a managed hook", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-pullin-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed a settings file with a pre-existing hook
        yield* seedProjectSettings(realProjectDir, "committed", {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "echo pre-existing" }] },
          ],
        });

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const fp = fingerprintAction("PreToolUse", "Bash", cmd("echo pre-existing"));
        const result = yield* pullInHook({
          cwd: projectDir,
          level: "project",
          fingerprint: fp,
          name: "Adopted hook",
          description: "Was pre-existing",
        });

        expect(result.hookId).toBeDefined();
        expect(result.hook.name).toBe("Adopted hook");
        expect(result.hook.description).toBe("Was pre-existing");
        expect(result.hook.file).toBe("committed");
        expect(result.hook.event).toBe("PreToolUse");
        expect(result.hook.matcher).toBe("Bash");
        expect(result.hook.draft).toBe(false);

        // Should now be in hooks-claude.json as managed
        const hooksFile = yield* readHooksClaudeFile(config.stateDir);
        const managed = hooksFile.projects[realProjectDir]!.managed;
        expect(managed[result.hookId]).toBeDefined();
        expect(managed[result.hookId]!.name).toBe("Adopted hook");

        // Settings file should still have the hook (now managed)
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).not.toBeNull();
        expect(settingsHooks!["PreToolUse"]).toBeDefined();
      }),
    );

    it.effect("fails when fingerprint doesn't match any unmanaged hook", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-pullfail-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const error = yield* pullInHook({
          cwd: projectDir,
          level: "project",
          fingerprint: "bogus-fingerprint",
          name: "Won't work",
        }).pipe(Effect.flip);

        expect(error._tag).toBe("ClaudeHooksError");
      }),
    );

    it.effect("pull-in then delete removes the hook entirely", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-pulldel-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        yield* seedProjectSettings(realProjectDir, "committed", {
          Stop: [{ hooks: [{ type: "command", command: "echo bye" }] }],
        });

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Pull in
        const fp = fingerprintAction("Stop", undefined, cmd("echo bye"));
        const pulled = yield* pullInHook({
          cwd: projectDir,
          level: "project",
          fingerprint: fp,
          name: "Adopted stop hook",
        });

        // Delete the now-managed hook
        const deleteResult = yield* deleteClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: pulled.hookId,
        });
        expect(deleteResult.deleted).toBe(true);

        // Gone from hooks-claude.json
        const hooksFile = yield* readHooksClaudeFile(config.stateDir);
        expect(hooksFile.projects[realProjectDir]!.managed[pulled.hookId]).toBeUndefined();

        // Gone from settings file
        const settingsHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(settingsHooks).toBeNull();
      }),
    );

    it.effect("pull-in from local settings carries over file: local", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-pullin-local-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed settings.local.json with a pre-existing hook
        yield* seedProjectSettings(realProjectDir, "local", {
          Stop: [{ hooks: [{ type: "command", command: "echo local-hook" }] }],
        });

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        const fp = fingerprintAction("Stop", undefined, cmd("echo local-hook"));
        const result = yield* pullInHook({
          cwd: projectDir,
          level: "project",
          fingerprint: fp,
          name: "Adopted local hook",
        });

        expect(result.hook.file).toBe("local");
        expect(result.hook.event).toBe("Stop");

        // Should still be in local settings (now managed)
        const localHooks = yield* readProjectLocalSettingsHooks(realProjectDir);
        expect(localHooks).not.toBeNull();
        expect(localHooks!["Stop"]).toBeDefined();

        // Committed should not have it
        const committedHooks = yield* readProjectSettingsHooks(realProjectDir);
        expect(committedHooks).toBeNull();
      }),
    );

    it.effect("pull-in one of several actions in same group leaves others unmanaged", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({
          prefix: "t3-hooks-pullin-partial-",
        });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed settings with a matcher group containing two actions
        yield* seedProjectSettings(realProjectDir, "committed", {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "echo first" },
                { type: "command", command: "echo second" },
              ],
            },
          ],
        });

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: { [realProjectDir]: { managed: {}, unmanaged: { committed: {}, local: {} } } },
        });

        // Pull in only the first action
        const fp = fingerprintAction("PreToolUse", "Bash", cmd("echo first"));
        const result = yield* pullInHook({
          cwd: projectDir,
          level: "project",
          fingerprint: fp,
          name: "Adopted first",
        });

        expect(result.hook.action).toEqual(cmd("echo first"));

        // Read back — the second action should survive as unmanaged
        const hooksResult = yield* getClaudeHooks(projectDir);
        const unmanagedCommitted = hooksResult.project.unmanaged.committed;
        expect(unmanagedCommitted["PreToolUse"]).toBeDefined();
        const remainingActions = unmanagedCommitted["PreToolUse"]![0]!.hooks;
        expect(remainingActions).toHaveLength(1);
        expect(remainingActions[0]).toEqual(cmd("echo second"));
      }),
    );
  });

  // ── getClaudeHooks ──────────────────────────────────────────────

  describe("getClaudeHooks", () => {
    it.effect("returns managed and unmanaged hooks for a project", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-get-test-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed a pre-existing hook in settings file
        yield* seedProjectSettings(realProjectDir, "committed", {
          PreToolUse: [
            { matcher: "Grep", hooks: [{ type: "command", command: "echo grep-hook" }] },
          ],
        });

        // Create a managed hook
        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: {
            [realProjectDir]: {
              managed: {
                h1: managedHook({
                  name: "Managed hook",
                  event: "Stop",
                  action: cmd("echo managed"),
                  file: "committed",
                }),
              },
              unmanaged: { committed: {}, local: {} },
            },
          },
        });
        // Sync settings so the managed hook is in the settings file
        yield* writeClaudeHook({
          cwd: projectDir,
          level: "project",
          hookId: "h1",
          hook: managedHook({
            name: "Managed hook",
            event: "Stop",
            action: cmd("echo managed"),
            file: "committed",
          }),
        });

        const result = yield* getClaudeHooks(projectDir);

        // Project managed
        expect(Object.keys(result.project.managed)).toHaveLength(1);
        expect(result.project.managed["h1"]?.name).toBe("Managed hook");

        // Project unmanaged (the grep hook wasn't created by T3)
        const unmanagedCommitted = result.project.unmanaged.committed;
        expect(unmanagedCommitted["PreToolUse"]).toBeDefined();
        expect(unmanagedCommitted["PreToolUse"]![0]!.hooks[0]!).toEqual(cmd("echo grep-hook"));

        // The managed Stop hook should NOT appear in unmanaged
        expect(unmanagedCommitted["Stop"]).toBeUndefined();
      }),
    );

    it.effect("draft hooks still claim their settings entry during reconciliation", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-draftclaim-" });
        const realProjectDir = yield* fs.realPath(projectDir);

        // Seed settings file WITH the hook that matches a managed draft
        yield* seedProjectSettings(realProjectDir, "committed", {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "exit 1" }] }],
        });

        // Create the managed hook as draft (so it won't be written to settings,
        // but the settings file already has it from before it was drafted)
        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: {
            [realProjectDir]: {
              managed: {
                h1: managedHook({
                  name: "Drafted hook",
                  event: "PreToolUse",
                  matcher: "Bash",
                  action: cmd("exit 1"),
                  file: "committed",
                  draft: true,
                }),
              },
              unmanaged: { committed: {}, local: {} },
            },
          },
        });

        const result = yield* getClaudeHooks(projectDir);

        // The hook is managed (even though draft)
        expect(result.project.managed["h1"]?.draft).toBe(true);

        // It should NOT appear as unmanaged — drafts still claim during reconciliation
        const unmanagedCommitted = result.project.unmanaged.committed;
        expect(unmanagedCommitted["PreToolUse"]).toBeUndefined();
      }),
    );
  });

  // ── Cross-project isolation ─────────────────────────────────────

  describe("project isolation", () => {
    it.effect("hooks for project A don't leak into project B settings", () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const projectA = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-proj-a-" });
        const projectB = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hooks-proj-b-" });
        const realA = yield* fs.realPath(projectA);
        const realB = yield* fs.realPath(projectB);

        yield* writeHooksClaudeFile(config.stateDir, {
          version: 1,
          global: { managed: {}, unmanaged: { committed: {}, local: {} } },
          projects: {
            [realA]: { managed: {}, unmanaged: { committed: {}, local: {} } },
            [realB]: { managed: {}, unmanaged: { committed: {}, local: {} } },
          },
        });

        // Write a hook to project A
        yield* writeClaudeHook({
          cwd: projectA,
          level: "project",
          hook: managedHook({
            name: "A's hook",
            event: "PreToolUse",
            matcher: "Bash",
            action: cmd("exit 1"),
            file: "committed",
          }),
        });

        // Project A should have the hook in its settings
        const settingsA = yield* readProjectSettingsHooks(realA);
        expect(settingsA).not.toBeNull();
        expect(settingsA!["PreToolUse"]).toBeDefined();

        // Project B should NOT have any settings file
        const settingsB = yield* readProjectSettingsHooks(realB);
        expect(settingsB).toBeNull();
      }),
    );
  });
});
