/**
 * Helpers for formatting dynamic tool-call details (WebFetch, WebSearch, etc.)
 * into human-readable text instead of raw JSON.
 *
 * Used by both ComposerPendingApprovalPanel (approval dialog)
 * and SimpleWorkEntryRow (work log sidebar).
 */

export interface ToolCallParsed {
  /** URL for fetch-type tools. */
  url: string | null;
  /** Prompt/query — the human-readable intent of the tool call. */
  prompt: string | null;
}

/**
 * Try to extract structured fields from a tool-call detail string or
 * a structured input object. Returns null if nothing useful was found.
 *
 * Handles known shapes:
 *  - WebFetch:  { url, prompt }
 *  - WebSearch: { query }
 */
export function parseToolCallDetail(
  detail: string | undefined,
  input?: Record<string, unknown> | undefined,
): ToolCallParsed | null {
  // Prefer structured input if available (approval panel path)
  if (input) {
    const result = extractFields(input);
    if (result) return result;
  }

  // Fall back to parsing the detail JSON string (work log path)
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail);
    if (typeof parsed !== "object" || parsed === null) return null;
    return extractFields(parsed as Record<string, unknown>);
  } catch {
    // not JSON, nothing to extract
  }

  return null;
}

function extractFields(obj: Record<string, unknown>): ToolCallParsed | null {
  const url = typeof obj.url === "string" ? obj.url : null;
  const prompt =
    typeof obj.prompt === "string"
      ? obj.prompt
      : typeof obj.query === "string"
        ? obj.query
        : null;
  if (url || prompt) return { url, prompt };
  return null;
}

/**
 * Format a tool-call detail into a compact plain-text preview
 * suitable for the work log sidebar (single truncated line).
 */
export function formatToolCallPreview(
  detail: string | undefined,
  input?: Record<string, unknown> | undefined,
): string | null {
  const parsed = parseToolCallDetail(detail, input);
  if (!parsed) return null;

  if (parsed.url && parsed.prompt) {
    return `${parsed.url} — ${parsed.prompt}`;
  }
  return parsed.url ?? parsed.prompt;
}
