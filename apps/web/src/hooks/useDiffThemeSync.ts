import {
  registerCustomTheme,
  ResolvedThemes,
  AttachedThemes,
  getSharedHighlighter,
} from "@pierre/diffs";
import { useEffect, useRef } from "react";
import { useTheme } from "./useTheme";
import { useSyntaxThemes } from "../rpc/serverState";
import { CUSTOM_THEME_NAMES, resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";

// ── Module-level custom theme state ────────────────────────────
//
// Pierre's registerCustomTheme only allows one registration per name.
// We register once with a loader that reads from a mutable ref, then
// update the ref when the server pushes new theme data. Pierre
// re-resolves the loader on the next highlight pass after we evict
// the stale cache entry.

const customThemeRefs: Record<"dark" | "light", { current: unknown }> = {
  dark: { current: null },
  light: { current: null },
};

let customThemesRegistered = false;

function makeCustomThemeLoader(mode: "dark" | "light") {
  const name = CUSTOM_THEME_NAMES[mode];
  return () => {
    const raw = customThemeRefs[mode].current as Record<string, unknown> | null;
    return Promise.resolve({ ...raw, name });
  };
}

export function ensureCustomThemesRegistered(): void {
  if (customThemesRegistered) return;
  customThemesRegistered = true;

  registerCustomTheme(CUSTOM_THEME_NAMES.dark, makeCustomThemeLoader("dark"));
  registerCustomTheme(CUSTOM_THEME_NAMES.light, makeCustomThemeLoader("light"));
}

function evictCustomThemeCache(name: string): void {
  ResolvedThemes.delete(name);
  AttachedThemes.delete(name);
}

// ── Hook ───────────────────────────────────────────────────────

/**
 * Keeps custom syntax themes in sync with Pierre's highlighter singleton.
 * Returns the resolved diff theme name for the current light/dark mode.
 *
 * Safe to call from multiple components -- registration is idempotent
 * and whichever component renders first sets up the loaders.
 */
export function useDiffThemeSync(): {
  diffThemeName: DiffThemeName;
  hasCustomTheme: boolean;
} {
  const { resolvedTheme } = useTheme();
  const syntaxThemes = useSyntaxThemes();
  const hasCustomDark = syntaxThemes?.syntaxThemeDark != null;
  const hasCustomLight = syntaxThemes?.syntaxThemeLight != null;
  const hasCustomTheme = resolvedTheme === "dark" ? hasCustomDark : hasCustomLight;

  // Register loaders + populate refs synchronously during render,
  // before any child tries to resolve a custom theme through Pierre.
  if (hasCustomDark || hasCustomLight) {
    ensureCustomThemesRegistered();
  }
  if (hasCustomDark) {
    customThemeRefs.dark.current = syntaxThemes.syntaxThemeDark;
  }
  if (hasCustomLight) {
    customThemeRefs.light.current = syntaxThemes.syntaxThemeLight;
  }

  // When server-pushed theme data changes, evict Pierre's resolved
  // caches so the loader re-runs with fresh data on next highlight.
  const prevSyntaxThemesRef = useRef(syntaxThemes);
  useEffect(() => {
    if (syntaxThemes === prevSyntaxThemesRef.current) return;
    prevSyntaxThemesRef.current = syntaxThemes;

    customThemeRefs.dark.current = hasCustomDark ? syntaxThemes!.syntaxThemeDark : null;
    customThemeRefs.light.current = hasCustomLight ? syntaxThemes!.syntaxThemeLight : null;

    evictCustomThemeCache(CUSTOM_THEME_NAMES.dark);
    evictCustomThemeCache(CUSTOM_THEME_NAMES.light);

    // Pre-load custom themes into the shared highlighter singleton so
    // downstream consumers (ChatMarkdown, DiffPanel, etc.) can use
    // them immediately without triggering their own resolution.
    const themesToLoad: string[] = [];
    if (hasCustomDark) themesToLoad.push(CUSTOM_THEME_NAMES.dark);
    if (hasCustomLight) themesToLoad.push(CUSTOM_THEME_NAMES.light);
    if (themesToLoad.length > 0) {
      void getSharedHighlighter({ themes: themesToLoad, langs: [] }).catch(() => undefined);
    }
  }, [syntaxThemes, hasCustomDark, hasCustomLight]);

  const diffThemeName = resolveDiffThemeName(resolvedTheme, hasCustomTheme);

  return { diffThemeName, hasCustomTheme };
}
