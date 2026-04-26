/**
 * Shared payload helpers used across assembly groupers.
 */

import { isRecord } from "../../helpers";

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

export function extractCommandString(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.command === "string" ? input.command : undefined;
}

export function extractItemType(payload: unknown): string {
  if (!isRecord(payload)) return "unknown";
  return typeof payload.itemType === "string" ? payload.itemType : "unknown";
}

export function extractToolName(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  return typeof data.toolName === "string" ? data.toolName : undefined;
}

export function extractFilePath(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.file_path === "string" ? input.file_path : undefined;
}

export function extractPattern(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.pattern === "string" ? input.pattern : undefined;
}

export function extractSearchPath(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.path === "string" ? input.path : undefined;
}

export function extractQuery(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.query === "string" ? input.query : undefined;
}

export function extractUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.url === "string" ? input.url : undefined;
}

export function extractDescription(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return undefined;
  const input = isRecord(data.input) ? data.input : null;
  return typeof input?.description === "string" ? input.description : undefined;
}

// ---------------------------------------------------------------------------
// Started queue helpers
// ---------------------------------------------------------------------------

/**
 * Find and remove the first queue entry whose turnId matches the given
 * activity's turnId. Returns the matched entry, or undefined if none match.
 *
 * This prevents cross-turn contamination: if Turn A was interrupted and left
 * an orphaned tool.started in the queue, Turn B's tool.updated won't steal it.
 */
export function shiftMatchingTurnId<T extends { turnId: string | null }>(
  queue: T[],
  activityTurnId: string | null,
): T | undefined {
  const idx = queue.findIndex((entry) => entry.turnId === activityTurnId);
  if (idx === -1) return undefined;
  return queue.splice(idx, 1)[0];
}

// ---------------------------------------------------------------------------
// Hook prefix parsing
// ---------------------------------------------------------------------------

const HOOK_PREFIX_RE = /^::hook::([^:]+)::(ok|error)::\s*/;

/**
 * Check if result content starts with a `::hook::{name}::{status}::` prefix.
 * Returns the parsed hook metadata, or null if no prefix found.
 */
export function parseHookPrefix(content: string): { name: string; status: "ok" | "error" } | null {
  const match = HOOK_PREFIX_RE.exec(content);
  if (!match) return null;
  return { name: match[1]!, status: match[2]! as "ok" | "error" };
}

// ---------------------------------------------------------------------------
// Result content extraction
// ---------------------------------------------------------------------------

export function extractResultContent(
  result: { content?: string | ReadonlyArray<{ type: string; text?: string }> } | undefined,
): string | undefined {
  if (!result) return undefined;
  const content = result.content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  // Sub-agent results come as content block arrays: [{ type: "text", text: "..." }]
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        block.type === "text" &&
        typeof block.text === "string"
      ) {
        texts.push(block.text);
      }
    }
    const joined = texts.join("\n").trim();
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}
