/**
 * Search param parsers for hooks route files.
 *
 * Extracted so they can be tested without mounting route components.
 */
import type { HooksLevel } from "@t3tools/contracts";

export interface EditHookSearch {
  /** Level hint from the caller — skips scanning the other level. */
  level: HooksLevel;
  /** Owning project cwd. Empty string for global hooks. */
  cwd: string;
}

export function parseEditHookSearch(search: Record<string, unknown>): EditHookSearch {
  const level = search["level"] === "global" ? "global" : "project";
  const cwd = typeof search["cwd"] === "string" ? search["cwd"] : "";
  return { level, cwd };
}

export interface AdoptSearch {
  level: HooksLevel;
  fingerprint: string;
  /** Owning project cwd. Empty string for global hooks. */
  cwd: string;
}

export function parseAdoptSearch(search: Record<string, unknown>): AdoptSearch {
  const level = search["level"] === "global" ? "global" : "project";
  const fingerprint = typeof search["fingerprint"] === "string" ? search["fingerprint"] : "";
  const cwd = typeof search["cwd"] === "string" ? search["cwd"] : "";
  return { level, fingerprint, cwd };
}
