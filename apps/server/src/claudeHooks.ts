/**
 * Claude Hooks RPC handlers.
 *
 * Orchestrates `getClaudeHooks` / `writeClaudeHook` / `deleteClaudeHook` /
 * `pullInHook` on top of `claudeHooksStore.ts`. `hooks-claude.json` is the
 * source of truth for managed entries; `.claude/settings[.local].json` is a
 * generated artefact (for the `hooks` key) plus the source of truth for
 * unmanaged entries.
 *
 * @module claudeHooks
 */
import { Effect, FileSystem, Path } from "effect";
import {
  ClaudeHooksError,
  type ClaudeHooksAllProjectsResult,
  type ClaudeHooksDeleteInput,
  type ClaudeHooksDeleteResult,
  type ClaudeHooksGetResult,
  type ClaudeHooksProjectEntry,
  type ClaudeHooksPullInInput,
  type ClaudeHooksPullInResult,
  type ClaudeHooksWriteInput,
  type ClaudeHooksWriteResult,
  type HookDiagnostic,
  type HookEvent,
  type HooksClaudeFile,
  type HooksClaudeLevel,
  type HooksConfig,
  type ManagedHookEntry,
  type UnmanagedHooks,
} from "@t3tools/contracts";
import { ServerConfig } from "./config.ts";
import {
  fingerprintManagedHook,
  fingerprintManagedHooks,
  newHookId,
  normalizeProjectKey,
  readHooksClaudeFile,
  realpathCwd,
  reconcileUnmanaged,
  settingsFilePath,
  syncLevelSettingsFiles,
  takeUnmanagedActionByFingerprint,
  writeHooksClaudeFile,
} from "./claudeHooksStore.ts";
import { ProjectionProjectRepository } from "./persistence/Services/ProjectionProjects.ts";

// ── Validation constants ──────────────────────────────────────────

const KNOWN_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
  "PermissionDenied",
  "Setup",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "InstructionsLoaded",
  "CwdChanged",
  "FileChanged",
]);

const TOOL_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
]);

const KNOWN_ACTION_TYPES = new Set(["command", "prompt", "agent", "http"]);

/** Pattern that looks like permission rule syntax: ToolName(pattern) */
const PERMISSION_RULE_RE = /^\w+\(.*\)$/;

// ── Validation ────────────────────────────────────────────────────

interface FileResult {
  hooks: HooksConfig;
  diagnostics: HookDiagnostic[];
}

/**
 * Validate the structural and semantic correctness of a parsed hooks object.
 * Pushes diagnostics but never throws — always returns whatever hooks it can.
 */
function validateHooks(hooks: Record<string, unknown>): FileResult {
  const diagnostics: HookDiagnostic[] = [];
  const validHooks: Record<string, unknown> = {};

  for (const [event, matcherGroups] of Object.entries(hooks)) {
    // Unknown event name
    if (!KNOWN_EVENTS.has(event)) {
      diagnostics.push({
        severity: "warning",
        message: `Unknown event "${event}" — Claude Code will ignore it.`,
        event,
      });
    }

    // matcher groups must be an array
    if (!Array.isArray(matcherGroups)) {
      diagnostics.push({
        severity: "error",
        message: `Event "${event}" value must be an array of matcher groups, got ${typeof matcherGroups}.`,
        event,
      });
      continue;
    }

    const validGroups: Array<Record<string, unknown>> = [];

    for (let mi = 0; mi < matcherGroups.length; mi++) {
      const group = matcherGroups[mi] as Record<string, unknown> | null;
      if (!group || typeof group !== "object") {
        diagnostics.push({
          severity: "error",
          message: `Matcher group must be an object, got ${typeof group}.`,
          event,
          matcherIndex: mi,
        });
        continue;
      }

      // Matcher with permission-rule syntax (should be in `if` instead)
      const matcher = group["matcher"];
      if (typeof matcher === "string" && PERMISSION_RULE_RE.test(matcher)) {
        diagnostics.push({
          severity: "warning",
          message: `Matcher "${matcher}" looks like permission rule syntax — the pattern inside parentheses will be ignored. Use the "if" field on individual hooks instead.`,
          event,
          matcherIndex: mi,
        });
      }

      // hooks array
      const hooksArray = group["hooks"];
      if (!Array.isArray(hooksArray)) {
        diagnostics.push({
          severity: "error",
          message: `Matcher group is missing a "hooks" array.`,
          event,
          matcherIndex: mi,
        });
        continue;
      }

      for (let hi = 0; hi < hooksArray.length; hi++) {
        const hook = hooksArray[hi] as Record<string, unknown> | null;
        if (!hook || typeof hook !== "object") {
          diagnostics.push({
            severity: "error",
            message: `Hook must be an object, got ${typeof hook}.`,
            event,
            matcherIndex: mi,
            hookIndex: hi,
          });
          continue;
        }

        const actionType = hook["type"];
        if (typeof actionType !== "string" || !KNOWN_ACTION_TYPES.has(actionType)) {
          diagnostics.push({
            severity: "error",
            message: `Unknown action type "${String(actionType)}" — must be command, prompt, agent, or http.`,
            event,
            matcherIndex: mi,
            hookIndex: hi,
          });
          continue;
        }

        // Missing required field for the action type
        if (actionType === "command" && !hook["command"]) {
          diagnostics.push({
            severity: "error",
            message: `Command action is missing the "command" field.`,
            event,
            matcherIndex: mi,
            hookIndex: hi,
          });
        }
        if ((actionType === "prompt" || actionType === "agent") && !hook["prompt"]) {
          diagnostics.push({
            severity: "error",
            message: `${actionType === "prompt" ? "Prompt" : "Agent"} action is missing the "prompt" field.`,
            event,
            matcherIndex: mi,
            hookIndex: hi,
          });
        }
        if (actionType === "http" && !hook["url"]) {
          diagnostics.push({
            severity: "error",
            message: `HTTP action is missing the "url" field.`,
            event,
            matcherIndex: mi,
            hookIndex: hi,
          });
        }

        // `if` on non-tool events prevents the hook from running entirely
        if (hook["if"] && !TOOL_EVENTS.has(event)) {
          diagnostics.push({
            severity: "warning",
            message: `The "if" field only works on tool events — this hook will never run.`,
            event,
            matcherIndex: mi,
            hookIndex: hi,
          });
        }
      }

      validGroups.push(group);
    }

    if (validGroups.length > 0) {
      validHooks[event] = validGroups;
    }
  }

  return { hooks: validHooks as HooksConfig, diagnostics };
}

// ── Read ───────────────────────────────────────────────────────────

/**
 * Read and validate the `hooks` key from a `.claude/settings[.draft].json` file.
 * Never fails — returns empty hooks + diagnostics on error.
 */
const readHooksFromFile = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return { hooks: {} as HooksConfig, diagnostics: [] } satisfies FileResult;

    const readResult = yield* fs
      .readFileString(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null as string | null)));

    if (readResult === null) {
      return {
        hooks: {} as HooksConfig,
        diagnostics: [{ severity: "error" as const, message: "Failed to read file." }],
      } satisfies FileResult;
    }

    const parseResult = yield* Effect.try({
      try: () => JSON.parse(readResult) as Record<string, unknown>,
      catch: () => "parse-error" as const,
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    if (parseResult === null) {
      return {
        hooks: {} as HooksConfig,
        diagnostics: [
          {
            severity: "error" as const,
            message:
              "Malformed JSON — Claude Code is silently ignoring this entire file. Fix the JSON syntax to restore your hooks.",
          },
        ],
      } satisfies FileResult;
    }

    const hooks = parseResult["hooks"];
    if (
      hooks === undefined ||
      hooks === null ||
      typeof hooks !== "object" ||
      Array.isArray(hooks)
    ) {
      return { hooks: {} as HooksConfig, diagnostics: [] } satisfies FileResult;
    }

    return validateHooks(hooks as Record<string, unknown>);
  });

// ── RPC handlers ───────────────────────────────────────────────────

const emptyLevel = (): HooksClaudeLevel => ({
  managed: {},
  unmanaged: { committed: {}, local: {} },
});

/**
 * Read managed hooks from `hooks-claude.json` and reconcile each settings
 * file's live `hooks` key against our managed fingerprints to derive the
 * *current* unmanaged remainder.
 *
 * Pure read: the stored `unmanaged` in `hooks-claude.json` is ignored here —
 * settings.json is the source of truth. We only write back to
 * `hooks-claude.json` on explicit user actions (write/delete/pullIn).
 */
export const getClaudeHooks = (cwd: string | undefined) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const config = yield* ServerConfig;
    const realCwd = yield* realpathCwd(cwd || config.cwd);

    const hooksClaude = yield* readHooksClaudeFile(config.stateDir);
    const projectKey = yield* normalizeProjectKey(realCwd);
    const globalLevel = hooksClaude.global;
    const projectLevel = hooksClaude.projects[projectKey] ?? emptyLevel();

    const [globalCommittedFile, globalLocalFile, projectCommittedFile, projectLocalFile] =
      yield* Effect.all(
        [
          readHooksFromFile(settingsFilePath(pathService, "global", "committed", realCwd)),
          readHooksFromFile(settingsFilePath(pathService, "global", "local", realCwd)),
          readHooksFromFile(settingsFilePath(pathService, "project", "committed", realCwd)),
          readHooksFromFile(settingsFilePath(pathService, "project", "local", realCwd)),
        ],
        { concurrency: "unbounded" },
      );

    const globalFingerprints = fingerprintManagedHooks(globalLevel.managed);
    const projectFingerprints = fingerprintManagedHooks(projectLevel.managed);

    return {
      global: {
        managed: globalLevel.managed,
        unmanaged: {
          committed: reconcileUnmanaged(globalCommittedFile.hooks, globalFingerprints),
          local: reconcileUnmanaged(globalLocalFile.hooks, globalFingerprints),
        },
        diagnostics: [...globalCommittedFile.diagnostics, ...globalLocalFile.diagnostics],
      },
      project: {
        managed: projectLevel.managed,
        unmanaged: {
          committed: reconcileUnmanaged(projectCommittedFile.hooks, projectFingerprints),
          local: reconcileUnmanaged(projectLocalFile.hooks, projectFingerprints),
        },
        diagnostics: [...projectCommittedFile.diagnostics, ...projectLocalFile.diagnostics],
      },
    } satisfies ClaudeHooksGetResult;
  });

/**
 * Read + reconcile a single level (global or project) against its on-disk
 * settings files. Shared helper for the all-projects fetch path.
 */
const readLevelResult = (level: "global" | "project", levelData: HooksClaudeLevel, cwd: string) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const [committedFile, localFile] = yield* Effect.all(
      [
        readHooksFromFile(settingsFilePath(pathService, level, "committed", cwd)),
        readHooksFromFile(settingsFilePath(pathService, level, "local", cwd)),
      ],
      { concurrency: "unbounded" },
    );
    const fingerprints = fingerprintManagedHooks(levelData.managed);
    return {
      managed: levelData.managed,
      unmanaged: {
        committed: reconcileUnmanaged(committedFile.hooks, fingerprints),
        local: reconcileUnmanaged(localFile.hooks, fingerprints),
      },
      diagnostics: [...committedFile.diagnostics, ...localFile.diagnostics],
    };
  });

/**
 * Fetch hooks across all live projects plus global. Projects whose
 * `projection_projects` row is soft-deleted are excluded; orphaned project
 * keys in `hooks-claude.json` (no matching row at all) are also excluded.
 * Consumers can still see them by reading the file directly.
 */
export const getAllClaudeHooks = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const projectionProjects = yield* ProjectionProjectRepository;

  const hooksClaude = yield* readHooksClaudeFile(config.stateDir);

  // Global settings are filesystem-absolute (`~/.claude/...`), so the cwd
  // passed to `readLevelResult` is a no-op for global.
  const global = yield* readLevelResult("global", hooksClaude.global, config.cwd);

  const rows = yield* projectionProjects.listAll().pipe(Effect.orElseSucceed(() => []));
  const liveRows = rows.filter((row) => row.deletedAt === null);

  const projects = yield* Effect.all(
    liveRows.map((row) =>
      Effect.gen(function* () {
        const projectKey = yield* normalizeProjectKey(row.workspaceRoot);
        const levelData = hooksClaude.projects[projectKey] ?? emptyLevel();
        const result = yield* readLevelResult("project", levelData, projectKey);
        return {
          cwd: projectKey,
          title: row.title,
          managed: result.managed,
          unmanaged: result.unmanaged,
          diagnostics: result.diagnostics,
        } satisfies ClaudeHooksProjectEntry;
      }),
    ),
    { concurrency: "unbounded" },
  );

  return { global, projects } satisfies ClaudeHooksAllProjectsResult;
});

// ── Write-path shared helpers ─────────────────────────────────────

interface WriteContext {
  readonly stateDir: string;
  readonly hooksClaude: HooksClaudeFile;
  readonly projectKey: string;
  readonly realCwd: string;
  readonly levelData: HooksClaudeLevel;
  readonly committedFile: FileResult;
  readonly localFile: FileResult;
}

/**
 * Load everything a write-path handler needs: the hooks-claude snapshot, the
 * normalised project key, the level's stored data, and both settings files
 * for the level (so unmanaged can be re-derived from disk).
 */
const loadWriteContext = (cwd: string | undefined, level: "global" | "project") =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const config = yield* ServerConfig;
    const realCwd = yield* realpathCwd(cwd || config.cwd);

    const hooksClaude = yield* readHooksClaudeFile(config.stateDir);
    const projectKey = yield* normalizeProjectKey(realCwd);
    const levelData =
      level === "global" ? hooksClaude.global : (hooksClaude.projects[projectKey] ?? emptyLevel());

    const [committedFile, localFile] = yield* Effect.all(
      [
        readHooksFromFile(settingsFilePath(pathService, level, "committed", realCwd)),
        readHooksFromFile(settingsFilePath(pathService, level, "local", realCwd)),
      ],
      { concurrency: "unbounded" },
    );

    return {
      stateDir: config.stateDir,
      hooksClaude,
      projectKey,
      realCwd,
      levelData,
      committedFile,
      localFile,
    } satisfies WriteContext;
  });

/** Reconcile unmanaged fresh from the on-disk settings files given a managed map. */
const freshUnmanaged = (
  committedHooks: HooksConfig,
  localHooks: HooksConfig,
  managed: Record<string, ManagedHookEntry>,
): UnmanagedHooks => {
  const fp = fingerprintManagedHooks(managed);
  return {
    committed: reconcileUnmanaged(committedHooks, fp),
    local: reconcileUnmanaged(localHooks, fp),
  };
};

/**
 * Commit a new level snapshot to `hooks-claude.json` and sync the level's
 * two settings files. Every explicit write path goes through here so the
 * stored unmanaged never drifts further than one user action.
 */
const persistAndSync = (
  stateDir: string,
  hooksClaude: HooksClaudeFile,
  level: "global" | "project",
  projectKey: string,
  newLevel: HooksClaudeLevel,
  cwd: string,
) =>
  Effect.gen(function* () {
    const updated: HooksClaudeFile =
      level === "global"
        ? { ...hooksClaude, global: newLevel }
        : {
            ...hooksClaude,
            projects: { ...hooksClaude.projects, [projectKey]: newLevel },
          };
    yield* writeHooksClaudeFile(stateDir, updated);
    yield* syncLevelSettingsFiles(level, newLevel.managed, newLevel.unmanaged, cwd);
  });

// ── Write (create or update a managed hook) ───────────────────────

export const writeClaudeHook = (input: ClaudeHooksWriteInput) =>
  Effect.gen(function* () {
    const ctx = yield* loadWriteContext(input.cwd, input.level);
    const hookId = input.hookId ?? newHookId();
    const oldHook = input.hookId !== undefined ? ctx.levelData.managed[input.hookId] : undefined;
    const newManaged: Record<string, ManagedHookEntry> = {
      ...ctx.levelData.managed,
      [hookId]: input.hook,
    };
    let unmanaged = freshUnmanaged(ctx.committedFile.hooks, ctx.localFile.hooks, newManaged);
    // When updating an existing hook whose event/matcher/action changed, the
    // old action in the settings file won't be claimed by the new fingerprint
    // and would ghost as unmanaged. Strip the old fingerprint so it doesn't
    // resurface — same pattern deleteClaudeHook uses.
    if (oldHook !== undefined) {
      const oldFp = fingerprintManagedHook(oldHook);
      const newFp = fingerprintManagedHook(input.hook);
      if (oldFp !== newFp) {
        const taken = takeUnmanagedActionByFingerprint(unmanaged, oldFp);
        if (taken !== null) {
          unmanaged = taken.unmanaged;
        }
      }
    }
    yield* persistAndSync(
      ctx.stateDir,
      ctx.hooksClaude,
      input.level,
      ctx.projectKey,
      { managed: newManaged, unmanaged },
      ctx.realCwd,
    );
    return { hookId, hook: input.hook } satisfies ClaudeHooksWriteResult;
  });

// ── Delete (managed by hookId, or unmanaged by fingerprint) ───────

export const deleteClaudeHook = (input: ClaudeHooksDeleteInput) =>
  Effect.gen(function* () {
    const ctx = yield* loadWriteContext(input.cwd, input.level);

    if (input.hookId !== undefined) {
      const existed = input.hookId in ctx.levelData.managed;
      if (!existed) return { deleted: false } satisfies ClaudeHooksDeleteResult;
      const removedHook = ctx.levelData.managed[input.hookId]!;
      const { [input.hookId]: _removed, ...newManaged } = ctx.levelData.managed;
      let unmanaged = freshUnmanaged(ctx.committedFile.hooks, ctx.localFile.hooks, newManaged);
      // Also strip the underlying action from the settings file so it doesn't
      // resurface as an unmanaged/pre-existing hook.
      const fp = fingerprintManagedHook(removedHook);
      const taken = takeUnmanagedActionByFingerprint(unmanaged, fp);
      if (taken !== null) {
        unmanaged = taken.unmanaged;
      }
      yield* persistAndSync(
        ctx.stateDir,
        ctx.hooksClaude,
        input.level,
        ctx.projectKey,
        { managed: newManaged, unmanaged },
        ctx.realCwd,
      );
      return { deleted: true } satisfies ClaudeHooksDeleteResult;
    }

    if (input.fingerprint !== undefined) {
      // Reconcile fresh, then pop the matching action from unmanaged.
      const base = freshUnmanaged(
        ctx.committedFile.hooks,
        ctx.localFile.hooks,
        ctx.levelData.managed,
      );
      const taken = takeUnmanagedActionByFingerprint(base, input.fingerprint);
      if (taken === null) return { deleted: false } satisfies ClaudeHooksDeleteResult;
      yield* persistAndSync(
        ctx.stateDir,
        ctx.hooksClaude,
        input.level,
        ctx.projectKey,
        { managed: ctx.levelData.managed, unmanaged: taken.unmanaged },
        ctx.realCwd,
      );
      return { deleted: true } satisfies ClaudeHooksDeleteResult;
    }

    return { deleted: false } satisfies ClaudeHooksDeleteResult;
  });

// ── Pull-in (adopt an unmanaged action as a managed hook) ─────────

export const pullInHook = (input: ClaudeHooksPullInInput) =>
  Effect.gen(function* () {
    const ctx = yield* loadWriteContext(input.cwd, input.level);

    const base = freshUnmanaged(
      ctx.committedFile.hooks,
      ctx.localFile.hooks,
      ctx.levelData.managed,
    );
    const taken = takeUnmanagedActionByFingerprint(base, input.fingerprint);
    if (taken === null) {
      return yield* new ClaudeHooksError({
        filePath: "(unmanaged)",
        detail: `no unmanaged action matched fingerprint ${input.fingerprint}`,
      });
    }

    const hookId = newHookId();
    const hook: ManagedHookEntry = {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      draft: false,
      file: taken.taken.file,
      event: taken.taken.event as HookEvent,
      ...(taken.taken.matcher !== undefined ? { matcher: taken.taken.matcher } : {}),
      action: taken.taken.action,
      ...(taken.taken.groupTimeout !== undefined ? { groupTimeout: taken.taken.groupTimeout } : {}),
    };

    const newManaged: Record<string, ManagedHookEntry> = {
      ...ctx.levelData.managed,
      [hookId]: hook,
    };

    yield* persistAndSync(
      ctx.stateDir,
      ctx.hooksClaude,
      input.level,
      ctx.projectKey,
      { managed: newManaged, unmanaged: taken.unmanaged },
      ctx.realCwd,
    );

    return { hookId, hook } satisfies ClaudeHooksPullInResult;
  });
