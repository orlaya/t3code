/**
 * Claude Hooks Broadcaster - File watchers + PubSub for hook change events.
 *
 * Two always-on global watchers plus a lifecycle-driven per-project watcher
 * pool:
 *   - `{stateDir}/hooks-claude.json` (T3 metadata, source of truth for managed)
 *   - `~/.claude/settings.json` + `~/.claude/settings.local.json` (global Claude settings)
 *   - `{cwd}/.claude/settings.json` + `{cwd}/.claude/settings.local.json` per
 *     live project cwd. The pool is driven by the `projection_projects` table
 *     via `orchestrationEngine.streamDomainEvents` — on any `project.*` event
 *     we re-query live projects (`deleted_at IS NULL`) and diff against the
 *     currently-running watcher fibers, starting or interrupting to match.
 *     The DB is the source of truth; the map only tracks which fibers exist.
 *
 * Contract with Phase 3 read-only semantics: external edits to settings files
 * never write back to `hooks-claude.json`. External edits to `hooks-claude.json`
 * trigger re-sync into the global settings files plus project-level settings
 * for every live project cwd (the watcher map's keys).
 *
 * Loop prevention relies on `syncSettingsFile`'s content-hash no-op check —
 * our own writes fire the watcher once, reconcile matches, no further write.
 *
 * @module claudeHooksBroadcaster
 */
import { ClaudeHooksError } from "@t3tools/contracts";
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Ref,
  Scope,
  Stream,
  SynchronizedRef,
} from "effect";
import { homedir } from "node:os";
import { ServerConfig } from "./config.ts";
import {
  hooksClaudeFilePath,
  normalizeProjectKey,
  readHooksClaudeFile,
  syncLevelSettingsFiles,
} from "./claudeHooksStore.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionProjectRepository } from "./persistence/Services/ProjectionProjects.ts";

/**
 * Event emitted when hook state may have changed for a given level. Consumers
 * subscribe and call `getClaudeHooks` to re-fetch the current snapshot.
 *
 * `cwd` is the *normalized* project key when `level === "project"`, or `null`
 * for global events.
 */
export interface ClaudeHooksChangeEvent {
  readonly level: "global" | "project";
  readonly cwd: string | null;
}

export interface ClaudeHooksBroadcasterShape {
  /** Start the watchers. Safe to call multiple times. */
  readonly start: Effect.Effect<void, ClaudeHooksError>;

  /** Await startup completion. */
  readonly ready: Effect.Effect<void, ClaudeHooksError>;

  /**
   * Stream of all change events (global + every project). Subscribers use
   * this as a trigger to re-fetch the all-projects snapshot — the event
   * shape is informational only.
   */
  readonly streamChanges: Stream.Stream<ClaudeHooksChangeEvent>;
}

export class ClaudeHooksBroadcaster extends Context.Service<
  ClaudeHooksBroadcaster,
  ClaudeHooksBroadcasterShape
>()("t3/claudeHooksBroadcaster") {}

const WATCHER_DEBOUNCE = Duration.millis(100);
const RECONCILE_DEBOUNCE = Duration.millis(200);

const makeClaudeHooksBroadcaster = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionProjects = yield* ProjectionProjectRepository;
  const changesPubSub = yield* PubSub.unbounded<ClaudeHooksChangeEvent>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, ClaudeHooksError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const projectWatchersRef = yield* SynchronizedRef.make(
    new Map<string, Fiber.Fiber<void, never>>(),
  );

  const emit = (event: ClaudeHooksChangeEvent) =>
    PubSub.publish(changesPubSub, event).pipe(Effect.asVoid);

  // ── Watcher: {stateDir}/hooks-claude.json ────────────────────────
  //
  // On change: re-sync the global settings files (we own the generated `hooks`
  // key) plus project-level settings for every cwd that currently has an
  // active watcher — the per-project watcher map is our source of truth for
  // "which cwds are live on disk", so we avoid spraying `.claude/` directories
  // under stale project paths. Emit events for every level present in the
  // file so unfiltered subscribers re-fetch.

  const handleHooksClaudeChange = Effect.gen(function* () {
    const hooksClaude = yield* readHooksClaudeFile(config.stateDir);

    // Sync the global level — cwd is ignored for level === "global".
    yield* syncLevelSettingsFiles(
      "global",
      hooksClaude.global.managed,
      hooksClaude.global.unmanaged,
      config.cwd,
    );
    yield* emit({ level: "global", cwd: null });

    const activeCwds = yield* SynchronizedRef.get(projectWatchersRef).pipe(
      Effect.map((watchers) => new Set(watchers.keys())),
    );

    for (const [projectKey, projectLevel] of Object.entries(hooksClaude.projects)) {
      if (activeCwds.has(projectKey)) {
        yield* syncLevelSettingsFiles(
          "project",
          projectLevel.managed,
          projectLevel.unmanaged,
          projectKey,
        );
      }
      yield* emit({ level: "project", cwd: projectKey });
    }
  });

  const startHooksClaudeWatcher = Effect.gen(function* () {
    const filePath = hooksClaudeFilePath(pathService, config.stateDir);
    const dir = pathService.dirname(filePath);
    const fileName = pathService.basename(filePath);
    const resolved = pathService.resolve(filePath);

    yield* fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ClaudeHooksError({
            filePath,
            detail: "failed to prepare stateDir for hooks-claude.json watcher",
            cause,
          }),
      ),
    );

    const handleSafely = handleHooksClaudeChange.pipe(Effect.ignoreCause({ log: true }));

    // Debounce: editors emit multiple events per save; wait for the file to
    // settle before reading. Keybindings uses the same 100ms window.
    const events = fs.watch(dir).pipe(
      Stream.filter(
        (event) =>
          event.path === fileName ||
          event.path === filePath ||
          pathService.resolve(dir, event.path) === resolved,
      ),
      Stream.debounce(WATCHER_DEBOUNCE),
    );

    yield* Stream.runForEach(events, () => handleSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  // ── Watcher: ~/.claude/settings.{json,local.json} ────────────────
  //
  // Read-only: external edits here just trigger a broadcast so clients
  // re-reconcile via getClaudeHooks. We never write back to hooks-claude.json
  // (Phase 3 contract).

  const startGlobalSettingsWatcher = Effect.gen(function* () {
    const globalClaudeDir = pathService.join(homedir(), ".claude");
    const watchedFiles = new Set(["settings.json", "settings.local.json"]);

    yield* fs.makeDirectory(globalClaudeDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ClaudeHooksError({
            filePath: globalClaudeDir,
            detail: "failed to prepare global .claude directory for watcher",
            cause,
          }),
      ),
    );

    const emitGlobalSafely = emit({ level: "global", cwd: null }).pipe(
      Effect.ignoreCause({ log: true }),
    );

    const events = fs.watch(globalClaudeDir).pipe(
      Stream.filter((event) => watchedFiles.has(event.path)),
      Stream.debounce(WATCHER_DEBOUNCE),
    );

    yield* Stream.runForEach(events, () => emitGlobalSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  // ── Per-project watchers (lifecycle-driven pool) ─────────────────
  //
  // The pool is driven by `projection_projects` — we subscribe to the
  // orchestration domain-event stream, filter for project.* events, and on
  // each firing re-query live projects (`deleted_at IS NULL`) and diff
  // against the running fibers. No reference counting; the DB is the source
  // of truth.

  const makeProjectWatcherLoop = (normalizedCwd: string) =>
    Effect.gen(function* () {
      const rootExists = yield* fs.exists(normalizedCwd).pipe(Effect.orElseSucceed(() => false));
      if (!rootExists) return;

      const projectClaudeDir = pathService.join(normalizedCwd, ".claude");
      const watchedFiles = new Set(["settings.json", "settings.local.json"]);

      // Only watch if .claude/ already exists — don't create it speculatively.
      // It gets created lazily by syncLevelSettingsFiles when there are actual
      // managed hooks to write.
      const dirExists = yield* fs.exists(projectClaudeDir).pipe(Effect.orElseSucceed(() => false));
      if (!dirExists) return;

      const emitProjectSafely = emit({ level: "project", cwd: normalizedCwd }).pipe(
        Effect.ignoreCause({ log: true }),
      );

      const events = fs.watch(projectClaudeDir).pipe(
        Stream.filter((event) => watchedFiles.has(event.path)),
        Stream.debounce(WATCHER_DEBOUNCE),
      );

      yield* Stream.runForEach(events, () => emitProjectSafely).pipe(
        Effect.ignoreCause({ log: true }),
        Effect.asVoid,
      );
    });

  /**
   * Query live projects, diff against the current watcher map, and start
   * watchers for new cwds / interrupt watchers for cwds no longer live.
   *
   * Idempotent: safe to call on every project lifecycle event.
   */
  const reconcileProjectWatchers = SynchronizedRef.updateEffect(projectWatchersRef, (current) =>
    Effect.gen(function* () {
      const rows = yield* projectionProjects.listAll().pipe(Effect.orElseSucceed(() => []));
      const desired = new Set<string>();
      for (const row of rows) {
        if (row.deletedAt !== null) continue;
        desired.add(yield* normalizeProjectKey(row.workspaceRoot));
      }

      const next = new Map(current);

      // Stop watchers for cwds that are no longer live.
      for (const [cwd, fiber] of current) {
        if (!desired.has(cwd)) {
          yield* Fiber.interrupt(fiber).pipe(Effect.ignore);
          next.delete(cwd);
        }
      }

      // Start watchers for newly-live cwds.
      for (const cwd of desired) {
        if (next.has(cwd)) continue;
        const fiber = yield* makeProjectWatcherLoop(cwd).pipe(Effect.forkIn(watcherScope));
        next.set(cwd, fiber);
      }

      return next;
    }),
  );

  const startProjectLifecycleSubscription = Effect.gen(function* () {
    const events = orchestrationEngine.streamDomainEvents.pipe(
      Stream.filter((event) => event.aggregateKind === "project"),
      Stream.debounce(RECONCILE_DEBOUNCE),
    );

    yield* Stream.runForEach(events, () =>
      reconcileProjectWatchers.pipe(Effect.ignoreCause({ log: true })),
    ).pipe(Effect.forkIn(watcherScope), Effect.asVoid);
  });

  const start = Effect.gen(function* () {
    const alreadyStarted = yield* Ref.get(startedRef);
    if (alreadyStarted) {
      return yield* Deferred.await(startedDeferred);
    }

    yield* Ref.set(startedRef, true);
    const startup = Effect.gen(function* () {
      yield* startHooksClaudeWatcher;
      yield* startGlobalSettingsWatcher;
      // Seed the project watcher pool with currently-live projects before
      // wiring up the event subscription so the map is warm by the time any
      // hooks-claude.json change tries to consult `activeCwds`.
      yield* reconcileProjectWatchers.pipe(Effect.ignoreCause({ log: true }));
      yield* startProjectLifecycleSubscription;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  const provideCapturedServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, pathService),
    );

  return {
    start: provideCapturedServices(start),
    ready: Deferred.await(startedDeferred),
    streamChanges: Stream.fromPubSub(changesPubSub),
  } satisfies ClaudeHooksBroadcasterShape;
});

export const ClaudeHooksBroadcasterLive = Layer.effect(
  ClaudeHooksBroadcaster,
  makeClaudeHooksBroadcaster,
);
