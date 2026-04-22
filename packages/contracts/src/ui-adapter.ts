/**
 * UI Adapter — Canonical types for the read-time extraction layer.
 *
 * Raw activity payloads are stored exactly as each provider adapter emits them.
 * The UI adapter normalises them at read time into these canonical shapes so
 * session-logic.ts (and eventually the server for crash cleanup) can consume
 * tool data without knowing which provider produced it.
 *
 * See: __notes/PLAN.ui-adapter.md
 */

import type { ToolLifecycleItemType } from "./providerRuntime.ts";

// ---------------------------------------------------------------------------
// Canonical tool payload — the shape session-logic.ts reads from
// ---------------------------------------------------------------------------

/** Tool input fields that session-logic.ts actually digs into. */
export type CanonicalToolInput = {
  /** File path for Edit / Write / Read / Glob / Grep etc. */
  file_path?: string;
  /** Edit: the text being replaced. */
  old_string?: string;
  /** Edit: the replacement text. */
  new_string?: string;
  /** Edit: replace all occurrences. */
  replace_all?: boolean;
  /** Write: full file content. */
  content?: string;
  /** Bash: the command string. */
  command?: string;
  /** Bash: human description of command. */
  description?: string;
  /** Agent: sub-agent type (e.g. "Explore"). */
  subagent_type?: string;
  /** Agent: sub-agent task prompt. */
  prompt?: string;
  /** WebSearch: search query. */
  query?: string;
  /** WebFetch: target URL. */
  url?: string;
  /** Glob/Grep: search pattern. */
  pattern?: string;
  /** Catch-all for provider-specific extras we don't explicitly model. */
  [key: string]: unknown;
};

/** Structured content block (sub-agent results come back as arrays of these). */
export type CanonicalContentBlock = {
  type: string;
  text?: string;
};

/** Tool result fields that session-logic.ts actually digs into. */
export type CanonicalToolResult = {
  /** Text output — either the full string or a summary. */
  content?: string | ReadonlyArray<CanonicalContentBlock>;
  /** For commands: process exit code. */
  exitCode?: number;
  /** Error message when the tool failed. */
  error?: string;
  /** Whether the provider flagged this result as an error. */
  isError?: boolean;
};

/**
 * The canonical tool data that the UI adapter extracts from a raw activity.
 *
 * This is "what Claude already does, formalised" — Claude's extraction is
 * nearly a pass-through, other providers fill in what they can.
 */
export type CanonicalToolData = {
  /** e.g. "Edit", "Bash", "Agent", "WebFetch" */
  toolName: string;
  /** Unique per invocation when available. */
  toolCallId?: string;
  /** The tool's item type classification. */
  itemType: ToolLifecycleItemType;
  /** Human-readable context: file path, command, URL, etc. */
  detail?: string;
  /** "inProgress" | "failed" | undefined */
  status?: string;
  /** Normalised input parameters. */
  input?: CanonicalToolInput;
  /** Normalised result. */
  result?: CanonicalToolResult;
};

// ---------------------------------------------------------------------------
// Canonical approval payload
// ---------------------------------------------------------------------------

/**
 * Approval data extracted from approval.requested + approval.resolved pairs.
 *
 * The UI adapter marries up the request and resolution into a single object
 * so the UI can render one line ("Edit declined", "Command approved") instead
 * of two separate raw events.
 *
 * `toolName` and `input` are optional — Claude fills them from `args`,
 * ACP can extract from `args.toolCall`, Codex/OpenCode leave them empty.
 */
export type CanonicalApprovalData = {
  /** UUID linking the request to its resolution. */
  requestId: string;
  /** Normalised kind: "command", "file-read", "file-change", "tool-call". */
  requestKind: string;
  /** Human-readable context: file path, command, etc. */
  detail?: string;
  /** Undefined while pending, filled once resolved. */
  decision?: "accept" | "acceptForSession" | "decline" | "cancel";
  /** Tool name from the approval args, when available. */
  toolName?: string;
  /** Tool input from the approval args — same shape as CanonicalToolInput. */
  input?: CanonicalToolInput;
  /** Links to the corresponding tool lifecycle via toolUseId. */
  toolUseId?: string;
};

// ---------------------------------------------------------------------------
// Tool lifecycle — the registry model
// ---------------------------------------------------------------------------

/** How a tool's lifecycle behaves. */
export type ToolLifecycleKind = "fire-and-forget" | "request-response" | "tracked";

/** Which activity kinds a provider emits for a given tool type. */
export type ToolLifecycleDeclaration = {
  lifecycle: ToolLifecycleKind;
  /**
   * The activity `kind` values this provider emits for this tool type,
   * in expected order. e.g. ["tool.started", "tool.updated", "tool.completed"]
   *
   * ACP/Cursor omits "tool.started" — their tracked tools start at "tool.updated".
   */
  events: ReadonlyArray<string>;
};

/**
 * Per-provider lifecycle declarations, keyed by ToolLifecycleItemType.
 *
 * Not every provider supports every item type — missing keys mean that
 * provider doesn't emit that tool type.
 */
export type ProviderLifecycleMap = Partial<Record<ToolLifecycleItemType, ToolLifecycleDeclaration>>;
