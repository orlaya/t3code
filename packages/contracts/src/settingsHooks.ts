import { Effect, Schema } from "effect";
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
  highlightResponse: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  scope: CustomSlashCommandScope.pipe(
    Schema.withDecodingDefault(Effect.succeed("global" as const)),
  ),
});
export type CustomSlashCommand = typeof CustomSlashCommand.Type;

// ── Claudes Custom Hooks ────────────────────────────────────────────

export const HookEvent = Schema.Literals([
  "PreToolUse",
  "PostToolUse",
  "PostCompact",
  "SessionStart",
  "UserPromptSubmit",
  "FileChanged",
]);
export type HookEvent = typeof HookEvent.Type;

export const HookStatus = Schema.Literals(["active", "draft"]);
export type HookStatus = typeof HookStatus.Type;

// SDK-native action types

export const CommandHookAction = Schema.Struct({
  type: Schema.Literal("command"),
  command: TrimmedNonEmptyString,
  shell: Schema.optional(Schema.Literals(["bash", "powershell"])),
  async: Schema.optional(Schema.Boolean),
  asyncRewake: Schema.optional(Schema.Boolean),
});

export const PromptHookAction = Schema.Struct({
  type: Schema.Literal("prompt"),
  prompt: Schema.String,
  model: Schema.optional(TrimmedNonEmptyString),
});

export const AgentHookAction = Schema.Struct({
  type: Schema.Literal("agent"),
  prompt: Schema.String,
  model: Schema.optional(TrimmedNonEmptyString),
});

export const HttpHookAction = Schema.Struct({
  type: Schema.Literal("http"),
  url: TrimmedNonEmptyString,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export const HookAction = Schema.Union([
  CommandHookAction,
  PromptHookAction,
  AgentHookAction,
  HttpHookAction,
]);
export type HookAction = typeof HookAction.Type;

export const CustomHook = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  event: HookEvent,
  matcher: Schema.optional(TrimmedNonEmptyString),
  action: HookAction,
  timeout: Schema.optional(Schema.Number),
  statusMessage: Schema.optional(TrimmedNonEmptyString),
  once: Schema.optional(Schema.Boolean),
  if: Schema.optional(TrimmedNonEmptyString),
  status: HookStatus.pipe(Schema.withDecodingDefault(Effect.succeed("draft" as const))),
  scope: CustomSlashCommandScope.pipe(
    Schema.withDecodingDefault(Effect.succeed("global" as const)),
  ),
});
export type CustomHook = typeof CustomHook.Type;
