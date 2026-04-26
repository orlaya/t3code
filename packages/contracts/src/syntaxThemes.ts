import { Schema } from "effect";

// ── Diff Theme ──────────────────────────────────────────────────
//
// Controls the diff chrome: line tints, hover colors, separator
// backgrounds, gutter styling, emphasis highlights, etc.
// Each token maps to a `--diffs-*-override` CSS custom property
// that Pierre exposes.
//
// All values are CSS color strings (hex, rgb, color-mix, etc.).
// The defaults below match the `color-mix()` expressions currently
// hardcoded in DiffPanel.tsx — they blend the app's design tokens
// so Pierre's diff rendering integrates with the host theme.

/**
 * Diff theme colors — maps to Pierre's `--diffs-*-override` CSS
 * custom properties. The first 13 tokens have app defaults (color-mix
 * expressions that blend with the host theme). The rest are optional —
 * when absent, Pierre uses its own built-in defaults.
 *
 * Tokens are grouped by what they control:
 *
 * ── Backgrounds ────────────────────────────────────────
 *   bg              → container background
 *   context         → unchanged lines
 *   contextHover    → unchanged lines on hover
 *   contextNumber   → unchanged line number gutter
 *   separator       → hunk separator rows
 *   buffer          → virtualizer buffer padding
 *
 * ── Additions ──────────────────────────────────────────
 *   addition            → added line background
 *   additionNumber      → added line number gutter
 *   additionHover       → added lines on hover
 *   additionEmphasis    → word-level highlight in additions
 *   additionColor       → foreground accent (gutter swatch, badge)
 *   additionNumberFg    → added line number text color
 *
 * ── Deletions ──────────────────────────────────────────
 *   deletion            → deleted line background
 *   deletionNumber      → deleted line number gutter
 *   deletionHover       → deleted lines on hover
 *   deletionEmphasis    → word-level highlight in deletions
 *   deletionColor       → foreground accent (gutter swatch, badge)
 *   deletionNumberFg    → deleted line number text color
 *
 * ── Modified ───────────────────────────────────────────
 *   modifiedColor       → foreground accent for modified hunks
 *
 * ── Line numbers ───────────────────────────────────────
 *   numberFg            → default line number text color
 *
 * ── Merge conflicts ───────────────────────────────────
 *   conflictMarker          → conflict marker line background
 *   conflictMarkerNumber    → conflict marker gutter
 *   conflictMarkerFg        → conflict marker text color
 *   conflictCurrent         → "current" side background
 *   conflictCurrentNumber   → "current" side gutter
 *   conflictBase            → base side background
 *   conflictBaseNumber      → base side gutter
 *   conflictIncoming        → incoming side background
 *   conflictIncomingNumber  → incoming side gutter
 *
 * ── Selection ──────────────────────────────────────────
 *   selectionColor      → selection accent color
 *   selection           → selected line background
 *   selectionNumber     → selected line gutter
 */
export const DiffThemeColors = Schema.Struct({
  // ── Backgrounds ──
  bg: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
  contextHover: Schema.optional(Schema.String),
  contextNumber: Schema.optional(Schema.String),
  separator: Schema.optional(Schema.String),
  buffer: Schema.optional(Schema.String),

  // ── Additions ──
  addition: Schema.optional(Schema.String),
  additionNumber: Schema.optional(Schema.String),
  additionHover: Schema.optional(Schema.String),
  additionEmphasis: Schema.optional(Schema.String),
  additionColor: Schema.optional(Schema.String),
  additionNumberFg: Schema.optional(Schema.String),

  // ── Deletions ──
  deletion: Schema.optional(Schema.String),
  deletionNumber: Schema.optional(Schema.String),
  deletionHover: Schema.optional(Schema.String),
  deletionEmphasis: Schema.optional(Schema.String),
  deletionColor: Schema.optional(Schema.String),
  deletionNumberFg: Schema.optional(Schema.String),

  // ── Modified ──
  modifiedColor: Schema.optional(Schema.String),

  // ── Line numbers ──
  numberFg: Schema.optional(Schema.String),

  // ── Merge conflicts ──
  conflictMarker: Schema.optional(Schema.String),
  conflictMarkerNumber: Schema.optional(Schema.String),
  conflictMarkerFg: Schema.optional(Schema.String),
  conflictCurrent: Schema.optional(Schema.String),
  conflictCurrentNumber: Schema.optional(Schema.String),
  conflictBase: Schema.optional(Schema.String),
  conflictBaseNumber: Schema.optional(Schema.String),
  conflictIncoming: Schema.optional(Schema.String),
  conflictIncomingNumber: Schema.optional(Schema.String),

  // ── Selection ──
  selectionColor: Schema.optional(Schema.String),
  selection: Schema.optional(Schema.String),
  selectionNumber: Schema.optional(Schema.String),
});
export type DiffThemeColors = typeof DiffThemeColors.Type;

/** Diff theme — light and dark variants. */
export const DiffTheme = Schema.Struct({
  light: DiffThemeColors,
  dark: DiffThemeColors,
});
export type DiffTheme = typeof DiffTheme.Type;

/**
 * Diff theme file shape — user-authored JSONC. Both variants optional,
 * all tokens optional. Missing values filled from DEFAULT_DIFF_THEME
 * during merge on the server.
 */
export const PartialDiffTheme = Schema.Struct({
  light: Schema.optional(DiffThemeColors),
  dark: Schema.optional(DiffThemeColors),
});
export type PartialDiffTheme = typeof PartialDiffTheme.Type;

// ── App defaults ────────────────────────────────────────────────
//
// These are the baked-in fallback colors used when no custom diff
// theme file is configured. They use CSS `color-mix()` against the
// app's design tokens (--background, --foreground, --success,
// --destructive, --card) so they adapt to the active app theme.
//
// When a user provides a diff theme file, those values replace
// these. When the path is cleared, we fall back here.

const DEFAULT_DIFF_THEME_LIGHT: DiffThemeColors = {
  bg: "color-mix(in srgb, var(--card) 90%, var(--background))",
  context: "color-mix(in srgb, var(--background) 97%, var(--foreground))",
  contextHover: "color-mix(in srgb, var(--background) 94%, var(--foreground))",
  separator: "color-mix(in srgb, var(--background) 95%, var(--foreground))",
  buffer: "color-mix(in srgb, var(--background) 90%, var(--foreground))",
  addition: "color-mix(in srgb, var(--background) 92%, var(--success))",
  additionNumber: "color-mix(in srgb, var(--background) 88%, var(--success))",
  additionHover: "color-mix(in srgb, var(--background) 85%, var(--success))",
  additionEmphasis: "color-mix(in srgb, var(--background) 80%, var(--success))",
  deletion: "color-mix(in srgb, var(--background) 92%, var(--destructive))",
  deletionNumber: "color-mix(in srgb, var(--background) 88%, var(--destructive))",
  deletionHover: "color-mix(in srgb, var(--background) 85%, var(--destructive))",
  deletionEmphasis: "color-mix(in srgb, var(--background) 80%, var(--destructive))",
};

const DEFAULT_DIFF_THEME_DARK: DiffThemeColors = {
  ...DEFAULT_DIFF_THEME_LIGHT,
};

export const DEFAULT_DIFF_THEME: DiffTheme = {
  light: DEFAULT_DIFF_THEME_LIGHT,
  dark: DEFAULT_DIFF_THEME_DARK,
};

// ── Merge ──────────────────────────────────────────────────────
//
// Merge a partial user theme over the baked-in defaults so the
// consumer always gets a fully populated DiffTheme.

function mergeColors(
  defaults: DiffThemeColors,
  overrides: DiffThemeColors | undefined,
): DiffThemeColors {
  if (!overrides) return defaults;
  const merged = { ...defaults };
  for (const key of Object.keys(overrides) as (keyof DiffThemeColors)[]) {
    const val = overrides[key];
    if (val !== undefined) merged[key] = val;
  }
  return merged;
}

export function mergePartialDiffTheme(partial: PartialDiffTheme): DiffTheme {
  return {
    light: mergeColors(DEFAULT_DIFF_THEME.light, partial.light),
    dark: mergeColors(DEFAULT_DIFF_THEME.dark, partial.dark),
  };
}

// ── Error ───────────────────────────────────────────────────────

export class SyntaxThemesConfigError extends Schema.TaggedErrorClass<SyntaxThemesConfigError>()(
  "SyntaxThemesConfigError",
  {
    configPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Syntax themes config error at ${this.configPath}: ${this.detail}`;
  }
}
