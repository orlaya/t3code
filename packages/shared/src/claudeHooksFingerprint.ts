import type { HookAction } from "@t3tools/contracts";

/**
 * Stable JSON stringify — sorts object keys recursively so equivalent values
 * always produce the same string regardless of insertion order.
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).toSorted();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
};

/**
 * Fingerprint a single (event, matcher, action) triple. Used by both server
 * (managed-vs-settings reconciliation) and web (unmanaged hook delete / pull-in
 * lookup) so both sides compare against the same string.
 *
 * Group-level `timeout` is intentionally excluded — a manual edit to a group's
 * timeout should not orphan its managed entries.
 */
export const fingerprintAction = (
  event: string,
  matcher: string | undefined,
  action: HookAction,
): string =>
  stableStringify({
    event,
    matcher: matcher ?? null,
    action,
  });
