import {
  registerCustomTheme,
  ResolvedThemes,
  AttachedThemes,
  getSharedHighlighter,
} from "@pierre/diffs";
import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTheme } from "../hooks/useTheme";
import { CUSTOM_THEME_NAMES, resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { useSyntaxThemes } from "../rpc/serverState";

// ── Custom theme registration ───────────────────────────────────
//
// Pierre's registerCustomTheme only allows one registration per name.
// We register once with a loader that reads from a mutable ref, then
// update the ref when the server pushes new theme data. The worker pool
// re-resolves the loader on the next setRenderOptions call.

// Theme data arrives as raw JSON from the server (Schema.Unknown in contracts).
// registerCustomTheme accepts ThemeRegistration | ThemeRegistrationResolved.
const customThemeRefs: Record<"dark" | "light", { current: unknown }> = {
  dark: { current: null },
  light: { current: null },
};

let customThemesRegistered = false;

function makeCustomThemeLoader(mode: "dark" | "light") {
  const name = CUSTOM_THEME_NAMES[mode];
  return () => {
    const raw = customThemeRefs[mode].current as Record<string, unknown> | null;
    // Pierre's resolveTheme asserts theme.name === registered name.
    // Override whatever name the VS Code theme file has.
    return Promise.resolve({ ...raw, name });
  };
}

function ensureCustomThemesRegistered(): void {
  if (customThemesRegistered) return;
  customThemesRegistered = true;

  registerCustomTheme(CUSTOM_THEME_NAMES.dark, makeCustomThemeLoader("dark"));
  registerCustomTheme(CUSTOM_THEME_NAMES.light, makeCustomThemeLoader("light"));
}

// ── Components ──────────────────────────────────────────────────

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    const current = workerPool.getDiffRenderOptions();
    if (current.theme === themeName) {
      return;
    }

    void workerPool
      .setRenderOptions({
        ...current,
        theme: themeName,
      })
      .catch(() => undefined);
  }, [themeName, workerPool]);

  return null;
}

/**
 * Evict a custom theme from Pierre's resolved/attached caches so the
 * next `getSharedHighlighter` or `setRenderOptions` call re-resolves it
 * through the loader (which reads the updated ref).
 */
function evictCustomThemeCache(name: string): void {
  ResolvedThemes.delete(name);
  AttachedThemes.delete(name);
}

/**
 * Syncs custom Shiki themes from server state into Pierre's theme registry.
 * Updates the mutable refs and evicts stale caches so Pierre re-resolves
 * themes through the loader on the next render pass.
 */
function CustomThemeSync() {
  const syntaxThemes = useSyntaxThemes();
  const prevRef = useRef(syntaxThemes);

  useEffect(() => {
    if (syntaxThemes === prevRef.current) return;
    prevRef.current = syntaxThemes;

    const hasDark = syntaxThemes?.syntaxThemeDark != null;
    const hasLight = syntaxThemes?.syntaxThemeLight != null;

    if (hasDark || hasLight) {
      ensureCustomThemesRegistered();
    }

    customThemeRefs.dark.current = hasDark ? syntaxThemes.syntaxThemeDark : null;
    customThemeRefs.light.current = hasLight ? syntaxThemes.syntaxThemeLight : null;

    // Evict stale cache so Pierre re-resolves through the loader
    evictCustomThemeCache(CUSTOM_THEME_NAMES.dark);
    evictCustomThemeCache(CUSTOM_THEME_NAMES.light);

    // Pre-load custom themes into the shared highlighter singleton so
    // ChatMarkdown's codeToHtml can use them without its own cache knowing.
    const themesToLoad: string[] = [];
    if (hasDark) themesToLoad.push(CUSTOM_THEME_NAMES.dark);
    if (hasLight) themesToLoad.push(CUSTOM_THEME_NAMES.light);
    if (themesToLoad.length > 0) {
      void getSharedHighlighter({ themes: themesToLoad, langs: [] }).catch(() => undefined);
    }
  }, [syntaxThemes]);

  return null;
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const syntaxThemes = useSyntaxThemes();
  const hasCustomTheme =
    resolvedTheme === "dark"
      ? syntaxThemes?.syntaxThemeDark != null
      : syntaxThemes?.syntaxThemeLight != null;

  // Register loaders and populate refs BEFORE the render passes the theme
  // name to WorkerPoolContextProvider — Pierre's initialize() calls
  // resolveTheme synchronously and will throw if the loader isn't registered.
  if (hasCustomTheme) {
    ensureCustomThemesRegistered();
    if (syntaxThemes?.syntaxThemeDark != null) {
      customThemeRefs.dark.current = syntaxThemes.syntaxThemeDark;
    }
    if (syntaxThemes?.syntaxThemeLight != null) {
      customThemeRefs.light.current = syntaxThemes.syntaxThemeLight;
    }
  }

  const diffThemeName = useMemo(
    () => resolveDiffThemeName(resolvedTheme, hasCustomTheme),
    [resolvedTheme, hasCustomTheme],
  );

  const workerPoolSize = useMemo(() => {
    const cores =
      typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
    return Math.max(2, Math.min(6, Math.floor(cores / 2)));
  }, []);

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new DiffsWorker(),
        poolSize: workerPoolSize,
        totalASTLRUCacheSize: 240,
      }}
      highlighterOptions={{
        theme: diffThemeName,
        tokenizeMaxLineLength: 1_000,
      }}
    >
      <CustomThemeSync />
      <DiffWorkerThemeSync themeName={diffThemeName} />
      {children}
    </WorkerPoolContextProvider>
  );
}
