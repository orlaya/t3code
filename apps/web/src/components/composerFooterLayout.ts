export const COMPOSER_FOOTER_ULTRA_COMPACT_BREAKPOINT_PX = 460;
export const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
export const COMPOSER_FOOTER_SEMI_COMPACT_BREAKPOINT_PX = 780;
export const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
export const COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX =
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  const breakpoint = options?.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

/** Triggers at 780px — hides toggle icons, shortens model name. */
export function shouldUseSemiCompactComposerFooter(width: number | null): boolean {
  return width !== null && width < COMPOSER_FOOTER_SEMI_COMPACT_BREAKPOINT_PX;
}

/** Triggers at 470px — shortens runtime mode labels (Full/Edits/Ask). */
export function shouldUseUltraCompactComposerFooter(width: number | null): boolean {
  return width !== null && width < COMPOSER_FOOTER_ULTRA_COMPACT_BREAKPOINT_PX;
}

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX;
}
