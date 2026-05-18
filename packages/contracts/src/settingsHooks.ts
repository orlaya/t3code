import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// ── Custom Slash Commands ────────────────────────────────────

export const CustomSlashCommandScope = Schema.Union([
  Schema.Literal("global"),
  Schema.Array(TrimmedNonEmptyString),
]);
export type CustomSlashCommandScope = typeof CustomSlashCommandScope.Type;

export const CustomSlashCommand = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  promptMessage: Schema.optional(Schema.String),
  promptFile: Schema.optional(TrimmedNonEmptyString),
  /** Where user-typed extra text is placed relative to the canned prompt. */
  extraTextPosition: Schema.Literals(["before", "after"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("after" as const)),
  ),
  scope: CustomSlashCommandScope.pipe(
    Schema.withDecodingDefault(Effect.succeed("global" as const)),
  ),
});
export type CustomSlashCommand = typeof CustomSlashCommand.Type;

// ── Claude Hook Schemas (SDK-native format) ───────────────────────────

// All 28 SDK hook events
export const HookEvent = Schema.Literals([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
  "PermissionDenied",
  "Setup",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "InstructionsLoaded",
  "CwdChanged",
  "FileChanged",
]);
export type HookEvent = typeof HookEvent.Type;

// Common optional fields shared by all hook action types
const commonHookFields = {
  timeout: Schema.optional(Schema.Number),
  statusMessage: Schema.optional(TrimmedNonEmptyString),
  once: Schema.optional(Schema.Boolean),
  if: Schema.optional(TrimmedNonEmptyString),
};

// SDK-native action types (what lives inside a matcher group's hooks[] array)

export const CommandHookAction = Schema.Struct({
  type: Schema.Literal("command"),
  command: TrimmedNonEmptyString,
  shell: Schema.optional(Schema.Literals(["bash", "powershell"])),
  async: Schema.optional(Schema.Boolean),
  asyncRewake: Schema.optional(Schema.Boolean),
  ...commonHookFields,
});

export const PromptHookAction = Schema.Struct({
  type: Schema.Literal("prompt"),
  prompt: Schema.String,
  model: Schema.optional(TrimmedNonEmptyString),
  ...commonHookFields,
});

export const AgentHookAction = Schema.Struct({
  type: Schema.Literal("agent"),
  prompt: Schema.String,
  model: Schema.optional(TrimmedNonEmptyString),
  ...commonHookFields,
});

export const HttpHookAction = Schema.Struct({
  type: Schema.Literal("http"),
  url: TrimmedNonEmptyString,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  ...commonHookFields,
});

export const HookAction = Schema.Union([
  CommandHookAction,
  PromptHookAction,
  AgentHookAction,
  HttpHookAction,
]);
export type HookAction = typeof HookAction.Type;

// A matcher group: optional matcher pattern + array of hook actions
export const HookMatcherGroup = Schema.Struct({
  matcher: Schema.optional(TrimmedNonEmptyString),
  hooks: Schema.Array(HookAction),
  timeout: Schema.optional(Schema.Number),
});
export type HookMatcherGroup = typeof HookMatcherGroup.Type;

// The top-level hooks config shape: Record<EventName, MatcherGroup[]>
// This is what lives under the "hooks" key in .claude/settings.json
export const HooksConfig = Schema.Record(Schema.String, Schema.Array(HookMatcherGroup));
export type HooksConfig = typeof HooksConfig.Type;

// ── Managed Hook (T3 metadata layer) ─────────────────────────────────

// Which settings file a managed hook targets when written out
export const ManagedHookFile = Schema.Literals(["committed", "local"]);
export type ManagedHookFile = typeof ManagedHookFile.Type;

/** A single managed hook owned by T3. Embeds full SDK-native hook payload + T3 metadata. */
export const ManagedHookEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  draft: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  file: ManagedHookFile,
  event: HookEvent,
  matcher: Schema.optional(TrimmedNonEmptyString),
  action: HookAction,
  // Group-level timeout (on the matcher group, not the action)
  groupTimeout: Schema.optional(Schema.Number),
});
export type ManagedHookEntry = typeof ManagedHookEntry.Type;

/**
 * Unmanaged hooks per file target — raw SDK matcher groups T3 didn't create.
 *
 * Event-keyed to mirror Claude's on-disk shape (`Record<EventName, MatcherGroup[]>`),
 * so unmanaged entries can be written straight back into `.claude/settings.json`
 * without losing the event they belong to.
 */
export const UnmanagedHooks = Schema.Struct({
  committed: Schema.Record(Schema.String, Schema.Array(HookMatcherGroup)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  local: Schema.Record(Schema.String, Schema.Array(HookMatcherGroup)).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type UnmanagedHooks = typeof UnmanagedHooks.Type;

/** Per-level (global or per-project) hook data inside hooks-claude.json. */
export const HooksClaudeLevel = Schema.Struct({
  managed: Schema.Record(Schema.String, ManagedHookEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  unmanaged: UnmanagedHooks.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({ committed: {}, local: {} } as typeof UnmanagedHooks.Type),
    ),
  ),
});
export type HooksClaudeLevel = typeof HooksClaudeLevel.Type;

/** The full shape of {stateDir}/hooks-claude.json. */
export const HooksClaudeFile = Schema.Struct({
  version: Schema.Literal(1).pipe(Schema.withDecodingDefault(Effect.succeed(1 as const))),
  global: HooksClaudeLevel.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        managed: {},
        unmanaged: { committed: {}, local: {} },
      } as typeof HooksClaudeLevel.Type),
    ),
  ),
  projects: Schema.Record(Schema.String, HooksClaudeLevel).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type HooksClaudeFile = typeof HooksClaudeFile.Type;

// ── Claude Hooks RPC types ─────────────────────────────────────────

export const HooksLevel = Schema.Literals(["global", "project"]);
export type HooksLevel = typeof HooksLevel.Type;

// ── Diagnostics ───────────────────────────────────────────────────

export const HookDiagnosticSeverity = Schema.Literals(["error", "warning"]);
export type HookDiagnosticSeverity = typeof HookDiagnosticSeverity.Type;

/** A single diagnostic message about a hooks file or a specific hook within it. */
export const HookDiagnostic = Schema.Struct({
  severity: HookDiagnosticSeverity,
  message: Schema.String,
  /** When set, identifies the specific hook: event name. */
  event: Schema.optional(Schema.String),
  /** When set, identifies the matcher group index within the event. */
  matcherIndex: Schema.optional(Schema.Number),
  /** When set, identifies the hook action index within the matcher group. */
  hookIndex: Schema.optional(Schema.Number),
});
export type HookDiagnostic = typeof HookDiagnostic.Type;

// ── Get ─────────────────────────────────────────────────────────────

export const ClaudeHooksGetInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type ClaudeHooksGetInput = typeof ClaudeHooksGetInput.Type;

/** Per-level result: managed hooks (keyed by ID) + unmanaged + diagnostics. */
const ClaudeHooksLevelResult = Schema.Struct({
  managed: Schema.Record(Schema.String, ManagedHookEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  unmanaged: UnmanagedHooks.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({ committed: {}, local: {} } as typeof UnmanagedHooks.Type),
    ),
  ),
  diagnostics: Schema.Array(HookDiagnostic).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});

export const ClaudeHooksGetResult = Schema.Struct({
  global: ClaudeHooksLevelResult,
  project: ClaudeHooksLevelResult,
});
export type ClaudeHooksGetResult = typeof ClaudeHooksGetResult.Type;

/**
 * Per-project entry in the all-projects result. Carries the project's
 * normalized cwd (used as the stable identifier) and title (for display)
 * alongside the level data.
 */
export const ClaudeHooksProjectEntry = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  title: Schema.String,
  managed: Schema.Record(Schema.String, ManagedHookEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  unmanaged: UnmanagedHooks.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({ committed: {}, local: {} } as typeof UnmanagedHooks.Type),
    ),
  ),
  diagnostics: Schema.Array(HookDiagnostic).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ClaudeHooksProjectEntry = typeof ClaudeHooksProjectEntry.Type;

/**
 * All-projects snapshot: global hooks plus every live (non-soft-deleted)
 * project's hooks. Used by the main settings listing page, which renders
 * a merged view across all projects with a filter dropdown.
 */
export const ClaudeHooksAllProjectsResult = Schema.Struct({
  global: ClaudeHooksLevelResult,
  projects: Schema.Array(ClaudeHooksProjectEntry),
});
export type ClaudeHooksAllProjectsResult = typeof ClaudeHooksAllProjectsResult.Type;

// ── Write (create or update a managed hook) ─────────────────────────

export const ClaudeHooksWriteInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
  /** Omit for create, provide for update. */
  hookId: Schema.optional(TrimmedNonEmptyString),
  level: HooksLevel,
  hook: ManagedHookEntry,
});
export type ClaudeHooksWriteInput = typeof ClaudeHooksWriteInput.Type;

export const ClaudeHooksWriteResult = Schema.Struct({
  hookId: TrimmedNonEmptyString,
  hook: ManagedHookEntry,
});
export type ClaudeHooksWriteResult = typeof ClaudeHooksWriteResult.Type;

// ── Delete ──────────────────────────────────────────────────────────

export const ClaudeHooksDeleteInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
  level: HooksLevel,
  /** For managed hooks: the hook ID. */
  hookId: Schema.optional(TrimmedNonEmptyString),
  /** For unmanaged hooks: fingerprint to identify which one. */
  fingerprint: Schema.optional(TrimmedNonEmptyString),
});
export type ClaudeHooksDeleteInput = typeof ClaudeHooksDeleteInput.Type;

export const ClaudeHooksDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type ClaudeHooksDeleteResult = typeof ClaudeHooksDeleteResult.Type;

// ── Pull-in (adopt an unmanaged hook as managed) ────────────────────

export const ClaudeHooksPullInInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
  level: HooksLevel,
  /** Fingerprint of the unmanaged hook to pull in. */
  fingerprint: TrimmedNonEmptyString,
  /** Name to assign to the newly managed hook. */
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});
export type ClaudeHooksPullInInput = typeof ClaudeHooksPullInInput.Type;

export const ClaudeHooksPullInResult = Schema.Struct({
  hookId: TrimmedNonEmptyString,
  hook: ManagedHookEntry,
});
export type ClaudeHooksPullInResult = typeof ClaudeHooksPullInResult.Type;

export class ClaudeHooksError extends Schema.TaggedErrorClass<ClaudeHooksError>()(
  "ClaudeHooksError",
  {
    filePath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Claude hooks error at ${this.filePath}: ${this.detail}`;
  }
}

// ── Subscribe (streamed changes) ────────────────────────────────────

export const ClaudeHooksSubscribeInput = Schema.Struct({});
export type ClaudeHooksSubscribeInput = typeof ClaudeHooksSubscribeInput.Type;

export const ClaudeHooksStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  payload: ClaudeHooksAllProjectsResult,
});
export type ClaudeHooksStreamSnapshotEvent = typeof ClaudeHooksStreamSnapshotEvent.Type;

export const ClaudeHooksStreamUpdatedEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("updated"),
  payload: ClaudeHooksAllProjectsResult,
});
export type ClaudeHooksStreamUpdatedEvent = typeof ClaudeHooksStreamUpdatedEvent.Type;

export const ClaudeHooksStreamEvent = Schema.Union([
  ClaudeHooksStreamSnapshotEvent,
  ClaudeHooksStreamUpdatedEvent,
]);
export type ClaudeHooksStreamEvent = typeof ClaudeHooksStreamEvent.Type;
