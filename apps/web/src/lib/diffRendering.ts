import type { DiffThemeColors } from "@t3tools/contracts";

// ── Diff chrome CSS generation ─────────────────────────────────
//
// Maps DiffThemeColors tokens to Pierre's `--diffs-*` CSS custom
// properties. Called with the resolved (merged) colors for the
// active light/dark variant.

const TOKEN_TO_CSS_VAR: Record<keyof DiffThemeColors, string> = {
  // Backgrounds
  bg: "--diffs-bg-override",
  context: "--diffs-bg-context-override",
  contextHover: "--diffs-bg-hover-override",
  contextNumber: "--diffs-bg-context-number-override",
  separator: "--diffs-bg-separator-override",
  buffer: "--diffs-bg-buffer-override",

  // Additions
  addition: "--diffs-bg-addition-override",
  additionNumber: "--diffs-bg-addition-number-override",
  additionHover: "--diffs-bg-addition-hover-override",
  additionEmphasis: "--diffs-bg-addition-emphasis-override",
  additionColor: "--diffs-addition-color-override",
  additionNumberFg: "--diffs-fg-number-addition-override",

  // Deletions
  deletion: "--diffs-bg-deletion-override",
  deletionNumber: "--diffs-bg-deletion-number-override",
  deletionHover: "--diffs-bg-deletion-hover-override",
  deletionEmphasis: "--diffs-bg-deletion-emphasis-override",
  deletionColor: "--diffs-deletion-color-override",
  deletionNumberFg: "--diffs-fg-number-deletion-override",

  // Modified
  modifiedColor: "--diffs-modified-color-override",

  // Line numbers
  numberFg: "--diffs-fg-number-override",

  // Merge conflicts
  conflictMarker: "--diffs-bg-conflict-marker-override",
  conflictMarkerNumber: "--diffs-bg-conflict-marker-number-override",
  conflictMarkerFg: "--diffs-fg-conflict-marker-override",
  conflictCurrent: "--diffs-bg-conflict-current-override",
  conflictCurrentNumber: "--diffs-bg-conflict-current-number-override",
  conflictBase: "--diffs-bg-conflict-base-override",
  conflictBaseNumber: "--diffs-bg-conflict-base-number-override",
  conflictIncoming: "--diffs-bg-conflict-incoming-override",
  conflictIncomingNumber: "--diffs-bg-conflict-incoming-number-override",

  // Selection
  selectionColor: "--diffs-selection-color-override",
  selection: "--diffs-bg-selection-override",
  selectionNumber: "--diffs-bg-selection-number-override",
};

export function buildDiffThemeCSS(colors: DiffThemeColors): string {
  // All override variables go on :host so Pierre's computed variables
  // (e.g. --diffs-addition-base, --diffs-modified-base) can read them.
  // Pierre computes those at :host level, so setting overrides on
  // child selectors doesn't work for the ones that feed into the
  // cascade (foreground colors, conflict, selection, etc.).
  const vars = (Object.keys(TOKEN_TO_CSS_VAR) as (keyof DiffThemeColors)[])
    .filter((token) => colors[token] !== undefined)
    .map((token) => `  ${TOKEN_TO_CSS_VAR[token]}: ${colors[token]};`)
    .join("\n");

  return `
:host {
${vars}
  --diffs-font-size: 12px !important;
  --diffs-line-height: 16.5px !important;
}

[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: ${colors.bg} !important;
  --diffs-light-bg: ${colors.bg} !important;
  --diffs-dark-bg: ${colors.bg} !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
  padding-top: 0px !important;
  padding-bottom: 1.5px !important;
  padding-left: 10px !important;
  padding-right: 15px !important;
  min-height: calc(1lh + (var(--diffs-gap-block, var(--diffs-gap-fallback)) * 2.3)) !important;
}

[data-header-content] {
  gap: 6px !important;
  padding: 0 !important;
}

[data-change-icon] {
  transform: scale(0.73);
  margin-top: 1.5px;
  margin-left: 2.5px;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;
}

export const DIFF_THEME_NAMES = {
  light: "pierre-light",
  dark: "pierre-dark",
} as const;

export const CUSTOM_THEME_NAMES = {
  dark: "custom-dark",
  light: "custom-light",
} as const;

export type DiffThemeName = string;

export function resolveDiffThemeName(
  theme: "light" | "dark",
  hasCustomTheme = false,
): DiffThemeName {
  if (hasCustomTheme) {
    return CUSTOM_THEME_NAMES[theme];
  }
  return theme === "dark" ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light;
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

export function fnv1a32(
  input: string,
  seed = FNV_OFFSET_BASIS_32,
  multiplier = FNV_PRIME_32,
): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

export function buildPatchCacheKey(patch: string, scope = "diff-panel"): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}
