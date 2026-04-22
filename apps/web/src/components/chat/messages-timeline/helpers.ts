/**
 * Pure display helpers shared across messages-timeline row components.
 */

import { CheckIcon, CircleAlertIcon, type LucideIcon, SearchIcon, ZapIcon } from "lucide-react";
import type { WorkLogEntry } from "../../../session-logic/index";
import { splitPathAndPosition } from "../../../terminal-links";

export function workToneIcon(tone: WorkLogEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-foreground/60",
    };
  }
  // thinking = sub agents only in claude
  if (tone === "thinking") {
    return {
      icon: SearchIcon,
      className: "text-foreground/60",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/60",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/60",
  };
}

export function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/90";
  if (tone === "thinking") return "text-muted-foreground/90";
  return "text-muted-foreground/90";
}

/** Return the first absolute file path from a work entry, if one exists. */
export function workEntryPrimaryFilePath(
  workEntry: Pick<WorkLogEntry, "changedFiles" | "detail">,
  workspaceRoot: string | undefined,
): string | null {
  // Prefer changedFiles (already extracted absolute paths)
  const first = workEntry.changedFiles?.[0];
  if (first) {
    if (first.startsWith("/") || /^[A-Za-z]:[\\/]/.test(first)) return first;
    if (workspaceRoot) return `${workspaceRoot}/${first}`;
  }
  // Fall back to detail — Read/Edit entries store the file path there.
  // Only trust it when it's already an absolute path; detail is arbitrary
  // text (could be a bash command, a description, etc.) so no guessing.
  const detail = workEntry.detail?.trim();
  if (detail?.startsWith("/") || /^[A-Za-z]:[\\/]/.test(detail ?? "")) {
    // Normalise range suffixes produced by tool summaries (e.g. path:0-100 or
    // path:50+) into the standard path:line format that editors understand.
    const rangeMatch = detail!.match(/:(\d+)[-+](\d*)$/);
    if (rangeMatch?.[1]) {
      const path = detail!.slice(0, -rangeMatch[0].length);
      const startLine = rangeMatch[1];
      return `${path}:${startLine}`;
    }
    const { path, line } = splitPathAndPosition(detail!);
    return line ? `${path}:${line}` : path;
  }
  return null;
}
