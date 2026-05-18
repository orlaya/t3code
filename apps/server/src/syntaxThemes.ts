/**
 * SyntaxThemes - Watches user-configured theme files and pushes parsed
 * theme data over PubSub for websocket broadcast.
 *
 * Three file paths (stored in ServerSettings):
 *   - syntaxThemeDarkPath  → Shiki/TextMate JSON theme for dark mode
 *   - syntaxThemeLightPath → Shiki/TextMate JSON theme for light mode
 *   - diffThemePath        → Our JSONC diff chrome theme
 *
 * Unlike keybindings/serverSettings, this service does not own a file — it
 * watches files whose paths come from settings. When settings change, it
 * tears down old watchers and starts new ones for the updated paths.
 *
 * Follows the same Effect service pattern: Cache + PubSub + Semaphore +
 * FileSystem.watch for concurrency and external edit detection.
 *
 * @module SyntaxThemes
 */
import {
  type DiffTheme,
  PartialDiffTheme,
  mergePartialDiffTheme,
  SyntaxThemesConfigError,
  type ServerConfigIssue,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import { ServerSettingsService } from "./serverSettings.ts";

// ── Types ───────────────────────────────────────────────────────

export interface SyntaxThemesState {
  /** Parsed diff theme (user file merged over defaults), null when no path set. */
  readonly diffTheme: DiffTheme | null;
  /** Raw Shiki theme object for dark mode, null when no path set. */
  readonly syntaxThemeDark: unknown | null;
  /** Raw Shiki theme object for light mode, null when no path set. */
  readonly syntaxThemeLight: unknown | null;
  /** Any issues encountered loading the theme files. */
  readonly issues: readonly ServerConfigIssue[];
}

export interface SyntaxThemesChangeEvent extends SyntaxThemesState {}

export interface SyntaxThemesShape {
  /** Start the service: load initial state and begin watching. */
  readonly start: Effect.Effect<void, SyntaxThemesConfigError>;
  /** Await readiness. */
  readonly ready: Effect.Effect<void, SyntaxThemesConfigError>;
  /** Get the current resolved theme state. */
  readonly getSnapshot: Effect.Effect<SyntaxThemesState, SyntaxThemesConfigError>;
  /** Stream of theme change events. */
  readonly streamChanges: Stream.Stream<SyntaxThemesChangeEvent>;
}

export class SyntaxThemes extends Context.Service<SyntaxThemes, SyntaxThemesShape>()(
  "t3/syntaxThemes",
) {}

// ── Schema for lenient JSONC parsing ────────────────────────────

const PartialDiffThemeJson = fromLenientJson(PartialDiffTheme);
const decodePartialDiffThemeJson = Schema.decodeUnknownExit(PartialDiffThemeJson);
const LenientJsonValue = fromLenientJson(Schema.Unknown);
const decodeLenientJsonValue = Schema.decodeUnknownExit(LenientJsonValue);

// ── Implementation ──────────────────────────────────────────────

interface ThemePaths {
  readonly syntaxThemeDarkPath: string;
  readonly syntaxThemeLightPath: string;
  readonly diffThemePath: string;
}

const makeIssue = (message: string, issuePath: string): ServerConfigIssue => ({
  kind: "syntaxThemes.malformed-config" as const,
  message,
  path: issuePath,
});

const makeSyntaxThemes = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const serverSettings = yield* ServerSettingsService;

  const semaphore = yield* Semaphore.make(1);
  const changesPubSub = yield* PubSub.unbounded<SyntaxThemesChangeEvent>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, SyntaxThemesConfigError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  // Current watched paths — used to detect when settings change the paths.
  const watchedPathsRef = yield* Ref.make<ThemePaths>({
    syntaxThemeDarkPath: "",
    syntaxThemeLightPath: "",
    diffThemePath: "",
  });

  // Fiber for the file watchers — replaced when paths change.
  const watcherFiberRef = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);

  const cacheKey = "themes" as const;

  const emitChange = (state: SyntaxThemesState) =>
    PubSub.publish(changesPubSub, state).pipe(Effect.asVoid);

  /**
   * Load a Shiki/TextMate theme from a path. Returns null if the path is
   * empty. Returns the raw parsed JSON object — Pierre/Shiki validates
   * the shape, not us.
   */
  const loadShikiTheme = (filePath: string, label: string) =>
    Effect.gen(function* () {
      if (!filePath) return { theme: null as unknown | null, issues: [] as ServerConfigIssue[] };

      const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return {
          theme: null as unknown | null,
          issues: [makeIssue(`${label} file not found: ${filePath}`, filePath)],
        };
      }

      const raw = yield* fs
        .readFileString(filePath)
        .pipe(Effect.orElseSucceed(() => null as string | null));
      if (raw === null) {
        return {
          theme: null as unknown | null,
          issues: [makeIssue(`Failed to read ${label} at ${filePath}`, filePath)],
        };
      }

      const parsed = decodeLenientJsonValue(raw);
      if (parsed._tag === "Failure") {
        return {
          theme: null as unknown | null,
          issues: [makeIssue(`Failed to parse ${label} at ${filePath}`, filePath)],
        };
      }

      return { theme: parsed.value as unknown | null, issues: [] as ServerConfigIssue[] };
    });

  /**
   * Load the diff theme from a path. Returns null if the path is empty.
   * Validates against the DiffTheme schema.
   */
  const loadDiffTheme = (filePath: string) =>
    Effect.gen(function* () {
      if (!filePath) return { theme: null as DiffTheme | null, issues: [] as ServerConfigIssue[] };

      const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        return {
          theme: null as DiffTheme | null,
          issues: [makeIssue(`Diff theme file not found: ${filePath}`, filePath)],
        };
      }

      const raw = yield* fs
        .readFileString(filePath)
        .pipe(Effect.orElseSucceed(() => null as string | null));
      if (raw === null) {
        return {
          theme: null as DiffTheme | null,
          issues: [makeIssue(`Failed to read diff theme at ${filePath}`, filePath)],
        };
      }

      const decoded = decodePartialDiffThemeJson(raw);
      if (decoded._tag === "Failure") {
        yield* Effect.logError("[SyntaxThemes] decode FAILED for", { filePath, decoded });
        return {
          theme: null as DiffTheme | null,
          issues: [makeIssue(`Failed to parse diff theme at ${filePath}`, filePath)],
        };
      }

      // Merge partial user overrides over baked-in defaults so the
      // client always gets a fully populated DiffTheme.
      const merged = mergePartialDiffTheme(decoded.value);
      return { theme: merged as DiffTheme | null, issues: [] as ServerConfigIssue[] };
    });

  // ── Load all themes from current settings ───────────────────

  const loadStateFromDisk = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new SyntaxThemesConfigError({
            configPath: "<settings>",
            detail: "failed to read settings for theme paths",
            cause,
          }),
      ),
    );
    const { syntaxThemeDarkPath, syntaxThemeLightPath, diffThemePath } = settings;

    const [darkResult, lightResult, diffResult] = yield* Effect.all(
      [
        loadShikiTheme(syntaxThemeDarkPath, "Syntax theme (dark)"),
        loadShikiTheme(syntaxThemeLightPath, "Syntax theme (light)"),
        loadDiffTheme(diffThemePath),
      ],
      { concurrency: "unbounded" },
    );

    const issues = [...darkResult.issues, ...lightResult.issues, ...diffResult.issues];

    return {
      diffTheme: diffResult.theme,
      syntaxThemeDark: darkResult.theme,
      syntaxThemeLight: lightResult.theme,
      issues,
    } satisfies SyntaxThemesState;
  });

  const themesCache = yield* Cache.make<
    typeof cacheKey,
    SyntaxThemesState,
    SyntaxThemesConfigError
  >({
    capacity: 1,
    lookup: () => loadStateFromDisk,
  });

  const getStateFromCache = Cache.get(themesCache, cacheKey);

  const revalidateAndEmit = semaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(themesCache, cacheKey);
      const state = yield* getStateFromCache;
      yield* emitChange(state);
    }),
  );

  const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

  // ── File watching ─────────────────────────────────────────

  /**
   * Start watchers for all configured paths. Watches the parent directory
   * and filters to the target file (same approach as keybindings).
   */
  const startWatchers = (paths: ThemePaths) =>
    Effect.gen(function* () {
      const allPaths = [paths.syntaxThemeDarkPath, paths.syntaxThemeLightPath, paths.diffThemePath];
      const activePaths = allPaths.filter(Boolean);

      if (activePaths.length === 0) return;

      // Ensure parent directories exist before watching.
      const dirs = [...new Set(activePaths.map((p) => pathService.dirname(p)))];
      yield* Effect.all(
        dirs.map((dir) => fs.makeDirectory(dir, { recursive: true })),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.ignoreCause({ log: true }));

      // Build a merged stream of all file watch events.
      const streams = activePaths.map((filePath) => {
        const dir = pathService.dirname(filePath);
        const file = pathService.basename(filePath);
        const resolved = pathService.resolve(filePath);

        return fs.watch(dir).pipe(
          Stream.filter((event) => {
            return (
              event.path === file ||
              event.path === filePath ||
              pathService.resolve(dir, event.path) === resolved
            );
          }),
          Stream.debounce(Duration.millis(100)),
        );
      });

      let merged = streams[0]!;
      for (let i = 1; i < streams.length; i++) {
        merged = Stream.merge(merged, streams[i]!);
      }

      yield* Stream.runForEach(merged, () => revalidateAndEmitSafely).pipe(
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(watcherScope),
        Effect.asVoid,
      );
    });

  /**
   * Replace watchers when settings change paths.
   */
  const updateWatchers = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings;

    const newPaths: ThemePaths = {
      syntaxThemeDarkPath: settings.syntaxThemeDarkPath,
      syntaxThemeLightPath: settings.syntaxThemeLightPath,
      diffThemePath: settings.diffThemePath,
    };

    const currentPaths = yield* Ref.get(watchedPathsRef);

    // Only restart watchers if paths actually changed.
    if (
      currentPaths.syntaxThemeDarkPath === newPaths.syntaxThemeDarkPath &&
      currentPaths.syntaxThemeLightPath === newPaths.syntaxThemeLightPath &&
      currentPaths.diffThemePath === newPaths.diffThemePath
    ) {
      return;
    }

    yield* Ref.set(watchedPathsRef, newPaths);

    // Kill old watcher fiber.
    const oldFiber = yield* Ref.get(watcherFiberRef);
    if (oldFiber !== null) {
      yield* Fiber.interrupt(oldFiber);
    }

    // Start new watchers.
    yield* startWatchers(newPaths);

    // Revalidate immediately with new paths.
    yield* revalidateAndEmitSafely;
  }).pipe(Effect.ignoreCause({ log: true }));

  // ── Settings change listener ──────────────────────────────

  const listenForSettingsChanges = Stream.runForEach(
    serverSettings.streamChanges,
    () => updateWatchers,
  ).pipe(Effect.ignoreCause({ log: true }));

  // ── Startup ───────────────────────────────────────────────

  const start: Effect.Effect<void, SyntaxThemesConfigError> = Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(startedRef, (started) => [!started, true]);
    if (!shouldStart) {
      return yield* Deferred.await(startedDeferred);
    }

    const startup = Effect.gen(function* () {
      // Set up initial watchers based on current settings.
      yield* updateWatchers;

      // Listen for settings path changes in the background.
      yield* listenForSettingsChanges.pipe(Effect.forkIn(watcherScope), Effect.asVoid);

      // Initial load.
      yield* Cache.invalidate(themesCache, cacheKey);
      yield* getStateFromCache;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  return {
    start,
    ready: Deferred.await(startedDeferred),
    getSnapshot: getStateFromCache,
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies SyntaxThemesShape;
});

export const SyntaxThemesLive = Layer.effect(SyntaxThemes, makeSyntaxThemes);
