/**
 * Shared helpers for the UI adapter layer.
 *
 * Tiny type-narrowing utilities used across provider extraction and assembly
 * files. Kept here so we don't end up with N identical copies.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
