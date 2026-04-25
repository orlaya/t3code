/**
 * Claude Hooks Store - Source of truth for hooks metadata in T3.
 *
 * Owns reading and writing `{stateDir}/hooks-claude.json` (T3's metadata
 * layer) and synchronising the generated `hooks` key into Claude's settings
 * files (`.claude/settings.json` / `.claude/settings.local.json`) while
 * preserving every other key.
 *
 * This module is Claude-specific. Future provider hooks (e.g. Codex) should
 * get their own store/adapter rather than reusing this file's shape.
 *
 * @module claudeHooksStore
 */
import {
  ClaudeHooksError,
  HooksClaudeFile,
  type HookAction,
  type HookMatcherGroup,
  type HooksClaudeLevel,
  type HooksConfig,
  type ManagedHookEntry,
  type ManagedHookFile,
  type UnmanagedHooks,
} from "@t3tools/contracts";
import { fingerprintAction, stableStringify } from "@t3tools/shared/claudeHooksFingerprint";
import { Effect, FileSystem, Path, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

export { fingerprintAction };

// ── Path resolution ────────────────────────────────────────────────

const SETTINGS_FILE_NAMES: Record<ManagedHookFile, string> = {
  committed: "settings.json",
  local: "settings.local.json",
};

export const hooksClaudeFilePath = (pathService: Path.Path, stateDir: string): string =>
  pathService.join(stateDir, "hooks-claude.json");

export const settingsFilePath = (
  pathService: Path.Path,
  level: "global" | "project",
  file: ManagedHookFile,
  cwd: string,
): string => {
  const base =
    level === "global" ? pathService.join(homedir(), ".claude") : pathService.join(cwd, ".claude");
  return pathService.join(base, SETTINGS_FILE_NAMES[file]);
};

/** Normalise a project cwd into the key used inside `hooks-claude.json` `projects`. */
/**
 * Resolve a cwd to its on-disk real path (case-corrected on case-insensitive
 * filesystems, symlinks expanded). Falls back to `path.resolve` when the path
 * doesn't exist so callers can still operate on theoretical paths.
 */
export const realpathCwd = (cwd: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const resolved = pathService.resolve(cwd);
    return yield* fs.realPath(resolved).pipe(Effect.orElseSucceed(() => resolved));
  });

/**
 * Normalize a project key to its real path so case-insensitive filesystems
 * (macOS APFS) don't produce duplicate keys for the same directory.
 * Returns an Effect because it hits the filesystem for case-correction.
 */
export const normalizeProjectKey = (cwd: string) => realpathCwd(cwd);

// ── Empty-state helpers ────────────────────────────────────────────

const emptyLevel = (): HooksClaudeLevel => ({
  managed: {},
  unmanaged: { committed: {}, local: {} },
});

const emptyFile = (): HooksClaudeFile => ({
  version: 1,
  global: emptyLevel(),
  projects: {},
});

// ── ID generation ──────────────────────────────────────────────────

/** Generate a stable unique ID for a newly-created managed hook. */
export const newHookId = (): string => randomUUID();

// ── Read hooks-claude.json ─────────────────────────────────────────

const readJsonFileIfExists = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return null as Record<string, unknown> | null;

    const raw = yield* fs
      .readFileString(filePath)
      .pipe(
        Effect.mapError(
          (cause) => new ClaudeHooksError({ filePath, detail: "failed to read file", cause }),
        ),
      );
    if (raw.trim() === "") return null as Record<string, unknown> | null;

    return yield* Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: (cause) => new ClaudeHooksError({ filePath, detail: "failed to parse JSON", cause }),
    });
  });

/**
 * Read and parse `{stateDir}/hooks-claude.json`. Returns an empty file shape
 * when the file is missing or empty. A missing `version` field is treated as
 * v1; an unrecognised version is rejected so we don't silently corrupt user
 * data.
 */
export const readHooksClaudeFile = (stateDir: string) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const filePath = hooksClaudeFilePath(pathService, stateDir);
    const parsed = yield* readJsonFileIfExists(filePath);
    if (parsed === null) return emptyFile();

    return yield* Schema.decodeUnknownEffect(HooksClaudeFile)(parsed).pipe(
      Effect.mapError(
        (cause) =>
          new ClaudeHooksError({
            filePath,
            detail: "hooks-claude.json failed schema validation",
            cause,
          }),
      ),
    );
  });

// ── Write hooks-claude.json ────────────────────────────────────────

const writeFileAtomically = (filePath: string, contents: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fs
      .makeDirectory(pathService.dirname(filePath), { recursive: true })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ClaudeHooksError({ filePath, detail: "failed to create directory", cause }),
        ),
      );
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    yield* fs.writeFileString(tempPath, contents).pipe(
      Effect.flatMap(() => fs.rename(tempPath, filePath)),
      Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))),
      Effect.mapError(
        (cause) => new ClaudeHooksError({ filePath, detail: "failed to write file", cause }),
      ),
    );
  });

/** Atomically write the T3 hooks metadata file. */
export const writeHooksClaudeFile = (stateDir: string, data: HooksClaudeFile) =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const filePath = hooksClaudeFilePath(pathService, stateDir);
    const encoded = `${JSON.stringify(data, null, 2)}\n`;
    yield* writeFileAtomically(filePath, encoded);
  });

// ── Startup migration: realpath project keys ──────────────────────

/**
 * Realpath every key in `hooks-claude.json`'s `projects` map and merge
 * duplicates that collapse together. Writes back only if any keys actually
 * changed. Idempotent — safe to run every startup.
 *
 * Corrects case/symlink drift on macOS (case-insensitive, case-preserving
 * FS) where `/Users/foo` and `/users/foo` resolve to the same directory but
 * produce two distinct keys otherwise.
 */
export const migrateHooksClaudeProjectKeys = (stateDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = hooksClaudeFilePath(pathService, stateDir);
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return;

    const file = yield* readHooksClaudeFile(stateDir);
    const entries = Object.entries(file.projects);
    if (entries.length === 0) return;

    const nextProjects: Record<string, HooksClaudeLevel> = {};
    let changed = false;

    for (const [key, level] of entries) {
      const real = yield* fs.realPath(key).pipe(Effect.orElseSucceed(() => key));
      if (real !== key) changed = true;
      const existing = nextProjects[real];
      if (existing) {
        changed = true;
        nextProjects[real] = {
          managed: { ...existing.managed, ...level.managed },
          unmanaged: existing.unmanaged,
        };
      } else {
        nextProjects[real] = level;
      }
    }

    if (!changed) return;
    yield* writeHooksClaudeFile(stateDir, { ...file, projects: nextProjects });
  });

// ── Generate SDK-native hooks ──────────────────────────────────────

/**
 * Group key used when merging matcher groups during generation.
 *
 * Hooks share a matcher group when their event, matcher pattern, AND
 * group-level timeout all match. Conflicting `groupTimeout` values create
 * separate groups rather than silently dropping one.
 */
const matcherGroupKey = (matcher: string | undefined, timeout: number | undefined): string =>
  `${matcher ?? ""}\u0000${timeout ?? ""}`;

interface MutableMatcherGroup {
  matcher?: string;
  hooks: HookAction[];
  timeout?: number;
}

/**
 * Generate the SDK-native `hooks` config from managed (non-draft) entries
 * merged with unmanaged matcher groups. Managed actions are appended into
 * existing matcher groups whose event + matcher + group timeout all match;
 * otherwise a new matcher group is appended.
 */
export const generateSettingsHooks = (
  managed: Record<string, ManagedHookEntry>,
  unmanaged: Record<string, ReadonlyArray<HookMatcherGroup>>,
): HooksConfig => {
  const result: Record<string, MutableMatcherGroup[]> = {};
  const lookup: Record<string, Map<string, number>> = {};

  const ensureEvent = (event: string): MutableMatcherGroup[] => {
    let groups = result[event];
    if (!groups) {
      groups = [];
      result[event] = groups;
      lookup[event] = new Map();
    }
    return groups;
  };

  const indexOfGroup = (event: string, key: string): number | undefined => lookup[event]?.get(key);

  // Step 1: seed with unmanaged matcher groups (preserves their order on disk).
  for (const [event, groups] of Object.entries(unmanaged)) {
    for (const group of groups) {
      const target = ensureEvent(event);
      const newGroup: MutableMatcherGroup = {
        ...(group.matcher !== undefined ? { matcher: group.matcher } : {}),
        hooks: [...group.hooks],
        ...(group.timeout !== undefined ? { timeout: group.timeout } : {}),
      };
      target.push(newGroup);
      lookup[event]!.set(matcherGroupKey(group.matcher, group.timeout), target.length - 1);
    }
  }

  // Step 2: append managed actions, merging into matching unmanaged groups.
  // Sort by ID so generated output is deterministic across runs.
  const managedIds = Object.keys(managed).toSorted();
  for (const id of managedIds) {
    const hook = managed[id]!;
    if (hook.draft) continue;
    const groups = ensureEvent(hook.event);
    const key = matcherGroupKey(hook.matcher, hook.groupTimeout);
    const existingIdx = indexOfGroup(hook.event, key);
    if (existingIdx !== undefined) {
      groups[existingIdx]!.hooks.push(hook.action);
    } else {
      const newGroup: MutableMatcherGroup = {
        ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
        hooks: [hook.action],
        ...(hook.groupTimeout !== undefined ? { timeout: hook.groupTimeout } : {}),
      };
      groups.push(newGroup);
      lookup[hook.event]!.set(key, groups.length - 1);
    }
  }

  return result as HooksConfig;
};

// ── Fingerprinting ─────────────────────────────────────────────────

/**
 * Fingerprint a single managed hook so we can match it against an action
 * inside a settings file. Identity is `event + matcher + action content` —
 * group-level timeout is intentionally excluded so manual edits to a group's
 * timeout don't orphan the managed entry.
 */
export const fingerprintManagedHook = (hook: ManagedHookEntry): string =>
  fingerprintAction(hook.event, hook.matcher, hook.action);

/**
 * Build the set of fingerprints for every managed hook (including drafts).
 * Draft hooks are included so they still "claim" their settings file entry
 * during reconciliation — otherwise toggling a hook to draft would cause
 * its action to resurface as an unmanaged/pre-existing entry.
 */
export const fingerprintManagedHooks = (managed: Record<string, ManagedHookEntry>): Set<string> => {
  const out = new Set<string>();
  for (const hook of Object.values(managed)) {
    out.add(fingerprintManagedHook(hook));
  }
  return out;
};

// ── Reconciliation ─────────────────────────────────────────────────

/**
 * Diff a settings file's hooks against a set of managed fingerprints and
 * return everything that didn't match — i.e. the unmanaged remainder. Empty
 * matcher groups (all actions claimed by managed) are dropped; events with
 * no remaining groups are omitted.
 */
export const reconcileUnmanaged = (
  settingsHooks: HooksConfig,
  managedFingerprints: ReadonlySet<string>,
): Record<string, HookMatcherGroup[]> => {
  const out: Record<string, HookMatcherGroup[]> = {};
  for (const [event, groups] of Object.entries(settingsHooks)) {
    const remaining: HookMatcherGroup[] = [];
    for (const group of groups) {
      const remainingActions: HookAction[] = [];
      for (const action of group.hooks) {
        const fp = fingerprintAction(event, group.matcher, action);
        if (!managedFingerprints.has(fp)) {
          remainingActions.push(action);
        }
      }
      if (remainingActions.length > 0) {
        remaining.push({
          ...(group.matcher !== undefined ? { matcher: group.matcher } : {}),
          hooks: remainingActions,
          ...(group.timeout !== undefined ? { timeout: group.timeout } : {}),
        });
      }
    }
    if (remaining.length > 0) {
      out[event] = remaining;
    }
  }
  return out;
};

// ── Write hooks key into settings.json (preserving other keys) ─────

/**
 * Sync the generated `hooks` key into a `.claude/settings[.local].json` file.
 *
 * Idempotent: if the effective `hooks` content already on disk matches what
 * we'd write, the file is left untouched (prevents watcher feedback loops).
 * All non-hook keys in the file are preserved verbatim.
 */
export const syncSettingsFile = (
  level: "global" | "project",
  file: ManagedHookFile,
  managed: Record<string, ManagedHookEntry>,
  unmanaged: UnmanagedHooks,
  cwd: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const filePath = settingsFilePath(pathService, level, file, cwd);

    // Only managed entries targeting *this* file contribute to its generated
    // hooks — otherwise a `file: "local"` entry would be written into both
    // `settings.json` and `settings.local.json` on level-wide syncs.
    const managedForFile: Record<string, ManagedHookEntry> = {};
    for (const [id, hook] of Object.entries(managed)) {
      if (hook.file === file) managedForFile[id] = hook;
    }
    const unmanagedForFile = file === "committed" ? unmanaged.committed : unmanaged.local;
    const generated = generateSettingsHooks(managedForFile, unmanagedForFile);
    const generatedHasHooks = Object.keys(generated).length > 0;

    // Read existing file (preserve every other key).
    const exists = yield* fs
      .exists(filePath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new ClaudeHooksError({ filePath, detail: "failed to check file existence", cause }),
        ),
      );

    let existing: Record<string, unknown> = {};
    if (exists) {
      const raw = yield* fs
        .readFileString(filePath)
        .pipe(
          Effect.mapError(
            (cause) => new ClaudeHooksError({ filePath, detail: "failed to read file", cause }),
          ),
        );
      if (raw.trim() !== "") {
        existing = yield* Effect.try({
          try: () => JSON.parse(raw) as Record<string, unknown>,
          catch: (cause) =>
            new ClaudeHooksError({ filePath, detail: "failed to parse JSON", cause }),
        });
      }
    }

    // Skip the write entirely when nothing has effectively changed. We only
    // care about the `hooks` key — all other keys are preserved as-is, so if
    // the effective hooks match, the resulting file would be byte-identical.
    const existingHooks = (existing["hooks"] ?? null) as unknown;
    const desiredHooks = generatedHasHooks ? generated : null;
    if (stableStringify(existingHooks) === stableStringify(desiredHooks)) {
      return;
    }

    if (generatedHasHooks) {
      existing["hooks"] = generated;
    } else {
      delete existing["hooks"];
    }

    // If the file ends up empty, remove it rather than leaving an empty `{}`.
    if (Object.keys(existing).length === 0) {
      if (exists) {
        yield* fs
          .remove(filePath, { force: true })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ClaudeHooksError({ filePath, detail: "failed to remove empty file", cause }),
            ),
          );
      }
      return;
    }

    const encoded = `${JSON.stringify(existing, null, 2)}\n`;
    yield* writeFileAtomically(filePath, encoded);
  });

// ── Convenience: sync both committed + local for a level ───────────

/** Sync both committed and local settings files for a given level. */
export const syncLevelSettingsFiles = (
  level: "global" | "project",
  managed: Record<string, ManagedHookEntry>,
  unmanaged: UnmanagedHooks,
  cwd: string,
) =>
  Effect.all(
    [
      syncSettingsFile(level, "committed", managed, unmanaged, cwd),
      syncSettingsFile(level, "local", managed, unmanaged, cwd),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.asVoid);

// ── Unmanaged action lookup ───────────────────────────────────────

export interface UnmanagedActionLocation {
  readonly file: ManagedHookFile;
  readonly event: string;
  readonly matcher: string | undefined;
  readonly action: HookAction;
  readonly groupTimeout: number | undefined;
}

/**
 * Find an unmanaged action by fingerprint, remove it from the tree, and
 * return both the removed action's location metadata and the new tree with
 * empty matcher groups / events dropped.
 *
 * Returns null when no action matches the fingerprint.
 */
export const takeUnmanagedActionByFingerprint = (
  unmanaged: UnmanagedHooks,
  fingerprint: string,
): { taken: UnmanagedActionLocation; unmanaged: UnmanagedHooks } | null => {
  const cloneForFile = (
    source: Record<string, ReadonlyArray<HookMatcherGroup>>,
  ): Record<string, HookMatcherGroup[]> => {
    const out: Record<string, HookMatcherGroup[]> = {};
    for (const [event, groups] of Object.entries(source)) out[event] = [...groups];
    return out;
  };

  for (const file of ["committed", "local"] as const) {
    const events = unmanaged[file];
    for (const [event, groups] of Object.entries(events)) {
      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi]!;
        for (let hi = 0; hi < group.hooks.length; hi++) {
          const action = group.hooks[hi]!;
          if (fingerprintAction(event, group.matcher, action) !== fingerprint) continue;

          const nextFile = cloneForFile(events);
          const nextGroups = [...nextFile[event]!];
          const nextActions = [...group.hooks];
          nextActions.splice(hi, 1);
          if (nextActions.length > 0) {
            nextGroups[gi] = {
              ...(group.matcher !== undefined ? { matcher: group.matcher } : {}),
              hooks: nextActions,
              ...(group.timeout !== undefined ? { timeout: group.timeout } : {}),
            };
          } else {
            nextGroups.splice(gi, 1);
          }
          if (nextGroups.length > 0) {
            nextFile[event] = nextGroups;
          } else {
            delete nextFile[event];
          }

          const newUnmanaged: UnmanagedHooks = {
            committed: file === "committed" ? nextFile : unmanaged.committed,
            local: file === "local" ? nextFile : unmanaged.local,
          };

          return {
            taken: {
              file,
              event,
              matcher: group.matcher,
              action,
              groupTimeout: group.timeout,
            },
            unmanaged: newUnmanaged,
          };
        }
      }
    }
  }
  return null;
};
