/**
 * Shared tool-row icon and state styling helpers.
 *
 * Every assembled tool row uses these to render the state icon (spinner,
 * interrupted, failed, or rest) and derive heading text classes. Keeps the
 * styling in one place instead of duplicating it across every row component.
 */

import { CircleAlertIcon, LoaderIcon, XCircleIcon, type LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import type { AssembledToolState } from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Icon component
// ---------------------------------------------------------------------------

/**
 * Renders the state-aware icon for a tool row.
 *
 * - `starting` / `in-progress` → spinning LoaderIcon
 * - `interrupted` → CircleAlertIcon in destructive
 * - `failed` → XCircleIcon in destructive
 * - `completed` (or any other) → the provided `restIcon`
 */
export function ToolRowIcon({
  state,
  restIcon: RestIcon,
}: {
  state: AssembledToolState;
  restIcon: LucideIcon;
}) {
  const isInProgress = state === "starting" || state === "in-progress";
  const isAlert = state === "interrupted" || state === "failed";

  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center",
        isAlert ? "text-destructive/60" : "text-foreground/60",
      )}
    >
      {isInProgress ? (
        <LoaderIcon className="size-3 animate-spin [animation-duration:4s]" />
      ) : state === "interrupted" ? (
        <CircleAlertIcon className="size-3" />
      ) : state === "failed" ? (
        <XCircleIcon className="size-3" />
      ) : (
        <RestIcon className="size-3" />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Text class helpers
// ---------------------------------------------------------------------------

/** Returns the appropriate text colour class for the tool heading. */
export function toolHeadingClass(state: AssembledToolState): string {
  if (state === "interrupted" || state === "failed") return "text-destructive/60";
  return "text-muted-foreground/90";
}

/** The suffix to append after the heading text, if any. */
export function toolHeadingSuffix(state: AssembledToolState): string {
  if (state === "interrupted") return " interrupted";
  return "";
}
