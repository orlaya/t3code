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
// Canonical display semantics
// ---------------------------------------------------------------------------

/**
 * Provider-neutral display categories used by the web UI.
 *
 * These are deliberately broader than provider-native tool names so the UI can
 * render stable headings/icons/previews regardless of whether a provider calls
 * something "Bash", "Command", "Read", or "ApplyPatch".
 */
export type CanonicalDisplayKind =
  | "command"
  | "edit"
  | "write"
  | "file-read"
  | "file-search"
  | "web-search"
  | "web-fetch"
  | "tool-call"
  | "sub-agent"
  | "mcp-tool"
  | "image"
  | "approval-command"
  | "approval-file-read"
  | "approval-edit";

/**
 * The lifecycle shape the UI should expect for a display item.
 */
export type CanonicalLifecycleShape =
  | "started-updated-completed"
  | "updated-completed"
  | "result-only"
  | "request-response";

/**
 * Optional capabilities exposed by a display kind. These let the UI know
 * which affordances are worth rendering without hardcoding them per provider.
 */
export type CanonicalDisplayCapabilities = {
  hasProgressState?: boolean;
  hasResultText?: boolean;
  hasCommandPreview?: boolean;
  hasFilePathPreview?: boolean;
  hasInlineDiffs?: boolean;
  hasApprovalDecision?: boolean;
};

// ---------------------------------------------------------------------------
// Canonical inline diff payload
// ---------------------------------------------------------------------------

/**
 * Provider-neutral inline diff extracted from a tool payload.
 *
 * `source: "patch"` preserves richer provider-native patch data when available
 * (for example Codex fileChange hunks with line anchors). `source:
 * "before_after"` captures semantic edit intent when a provider only exposes
 * old/new string pairs (for example Claude Edit / Write).
 */
export type CanonicalInlineDiff = {
  /** Absolute file path when available. */
  filePath: string;
  /** Unique per invocation when available. */
  toolCallId?: string;
  /** e.g. "Edit", "Write", "ApplyPatch" */
  toolName: string;
  /** High-level change type. */
  changeKind: "add" | "update" | "delete" | "move";
  /** Which diff representation this entry carries. */
  source: "patch" | "before_after";
  /** Prebuilt unified patch for renderers that can consume patch text directly. */
  unifiedPatch?: string;
  /** Old content/value for before/after diffs. */
  oldString?: string;
  /** New content/value for before/after diffs. */
  newString?: string;
  /** Destination path for move/rename operations, when available. */
  movePath?: string;
  /** Best-effort anchor line for editor open support. */
  anchorLine?: number;
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
// Assembled tool invocations — the shape the work log consumes
// ---------------------------------------------------------------------------

/**
 * The state of an assembled tool invocation.
 *
 * Providers resolve this from the lifecycle events they receive — the work log
 * never has to figure out whether an invocation is still running.
 */
export type AssembledToolState =
  | "starting"
  | "in-progress"
  | "completed"
  | "failed"
  | "interrupted";

/**
 * Shared fields present on every assembled tool invocation regardless of kind.
 */
interface AssembledToolBase {
  /** Stable identifier for this invocation (used as React key, etc). */
  id: string;
  createdAt: string;
  /** Unique per invocation — backfilled from completed event when needed. */
  toolCallId?: string;
  /** The turn this tool belongs to — used to determine if the tool is orphaned. */
  turnId: string | null;
  state: AssembledToolState;
  heading: string;
}

/**
 * A terminal command invocation (Bash, shell commands).
 */
export interface AssembledCommand extends AssembledToolBase {
  kind: "command";
  /** Display-ready command string (shell wrappers unwrapped). */
  command: string;
  /** Original command before unwrapping, when it differs from `command`. */
  rawCommand?: string;
  /** Command output when completed. */
  resultContent?: string;
}

/**
 * A file edit invocation (Edit, ApplyPatch, sed-via-bash, etc).
 */
export interface AssembledEdit extends AssembledToolBase {
  kind: "edit";
  filePath: string;
  inlineDiffs: ReadonlyArray<CanonicalInlineDiff>;
  /** Error reason when the edit failed (e.g. "String to replace not found"). */
  errorMessage?: string;
}

/**
 * A file write / create invocation.
 */
export interface AssembledWrite extends AssembledToolBase {
  kind: "write";
  filePath: string;
  /** Full file content when available. */
  content?: string;
  /** Error reason when the write failed. */
  errorMessage?: string;
}

/**
 * A file read invocation (Read tool).
 */
export interface AssembledFileRead extends AssembledToolBase {
  kind: "file-read";
  filePath: string;
  resultContent?: string;
}

/**
 * A file search invocation (Grep, Glob, rg-via-bash, etc).
 */
export interface AssembledFileSearch extends AssembledToolBase {
  kind: "file-search";
  /** Provider-native tool name — "Grep", "Glob", etc. Used for heading/clickability. */
  toolName: string;
  /** The search pattern or query. */
  pattern?: string;
  /** File path / directory scope when available. */
  filePath?: string;
  resultContent?: string;
}

/**
 * A web search invocation (e.g. WebSearch tool).
 */
export interface AssembledWebSearch extends AssembledToolBase {
  kind: "web-search";
  /** Search query string. */
  query?: string;
  resultContent?: string;
}

/**
 * A web page fetch invocation (e.g. WebFetch tool).
 */
export interface AssembledWebFetch extends AssembledToolBase {
  kind: "web-fetch";
  /** The URL being fetched. */
  url?: string;
  resultContent?: string;
}

/**
 * A sub-agent invocation.
 */
export interface AssembledSubAgent extends AssembledToolBase {
  kind: "sub-agent";
  brief: {
    prompt: string;
    description: string;
    agentType?: string;
  };
  /** Links to task.started/task.progress/task.completed activities for this sub-agent. */
  taskId?: string;
  resultContent?: string;
}

/**
 * An MCP tool invocation.
 */
export interface AssembledMcpTool extends AssembledToolBase {
  kind: "mcp-tool";
  toolName: string;
  detail?: string;
  resultContent?: string;
}

/**
 * A generic / unrecognised tool invocation.
 */
export interface AssembledToolCall extends AssembledToolBase {
  kind: "tool-call";
  toolName: string;
  detail?: string;
  resultContent?: string;
}

/**
 * Discriminated union of all assembled tool invocation shapes.
 *
 * This is the contract between provider assembly (which groups raw lifecycle
 * events into one object per invocation) and the work log (which renders them).
 * Each variant carries exactly the fields that display kind needs — no optional
 * bags, no heuristic field sniffing.
 */
export type AssembledToolInvocation =
  | AssembledCommand
  | AssembledEdit
  | AssembledWrite
  | AssembledFileRead
  | AssembledFileSearch
  | AssembledWebSearch
  | AssembledWebFetch
  | AssembledSubAgent
  | AssembledMcpTool
  | AssembledToolCall;

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
