/**
 * Shared payload helpers for Codex assembly.
 *
 * Codex payloads nest tool data under `data.item` with `item.type` as the
 * discriminator (e.g. "commandExecution", "fileChange"). These helpers dig
 * into that structure.
 */

import { isRecord } from "../../helpers";

export function extractItemType(payload: unknown): string {
  if (!isRecord(payload)) return "unknown";
  return typeof payload.itemType === "string" ? payload.itemType : "unknown";
}

export function extractProviderItemId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return typeof payload.providerItemId === "string" ? payload.providerItemId : undefined;
}

function getItem(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : null;
  return data && isRecord(data.item) ? data.item : null;
}

export function extractCommandString(payload: unknown): string | undefined {
  const item = getItem(payload);
  return item && typeof item.command === "string" ? item.command : undefined;
}

export function extractToolCallId(payload: unknown): string | undefined {
  const providerItemId = extractProviderItemId(payload);
  if (providerItemId) return providerItemId;
  const item = getItem(payload);
  return item && typeof item.id === "string" ? item.id : undefined;
}

export function extractStatus(payload: unknown): string | undefined {
  const item = getItem(payload);
  return item && typeof item.status === "string" ? item.status : undefined;
}

export function extractDetail(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return typeof payload.detail === "string" ? payload.detail : undefined;
}

export function extractAggregatedOutput(payload: unknown): string | undefined {
  const item = getItem(payload);
  return item && typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : undefined;
}

export function extractExitCode(payload: unknown): number | undefined {
  const item = getItem(payload);
  if (!item || typeof item.exitCode !== "number") return undefined;
  return Number.isFinite(item.exitCode) ? item.exitCode : undefined;
}

export interface CodexFileChange {
  path: string;
  changeKind: "add" | "update" | "delete" | "move";
  diff?: string;
  movePath?: string;
}

export function extractFileChanges(payload: unknown): CodexFileChange[] {
  const item = getItem(payload);
  if (!item || item.type !== "fileChange") return [];

  const changes = Array.isArray(item.changes) ? item.changes : [];
  const result: CodexFileChange[] = [];

  for (const entry of changes) {
    if (!isRecord(entry)) continue;
    const path = typeof entry.path === "string" ? entry.path : undefined;
    if (!path) continue;

    const kind = isRecord(entry.kind) ? entry.kind : undefined;
    let changeKind: CodexFileChange["changeKind"] = "update";
    if (kind) {
      switch (kind.type) {
        case "add":
          changeKind = "add";
          break;
        case "delete":
          changeKind = "delete";
          break;
        case "move":
          changeKind = "move";
          break;
        default:
          changeKind = "update";
      }
    }

    const diff = typeof entry.diff === "string" ? entry.diff : undefined;
    const movePath =
      kind && (typeof kind.move_path === "string" || typeof kind.movePath === "string")
        ? ((kind.move_path ?? kind.movePath) as string)
        : undefined;

    const change: CodexFileChange = { path, changeKind };
    if (diff) change.diff = diff;
    if (movePath) change.movePath = movePath;
    result.push(change);
  }

  return result;
}
