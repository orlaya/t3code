/**
 * Claude provider — UI adapter extraction.
 *
 * Claude's activity payloads are already well-structured:
 *   { itemType, detail, status?, data: { toolName, input, result } }
 *
 * This extraction is nearly a pass-through — it just maps the native shape
 * into the canonical CanonicalToolData type so session-logic.ts can consume
 * it uniformly regardless of provider.
 */

import type {
  CanonicalToolData,
  CanonicalInlineDiff,
  CanonicalToolResult,
  CanonicalToolInput,
  CanonicalContentBlock,
  CanonicalApprovalData,
} from "@t3tools/contracts";
import { isToolLifecycleItemType } from "@t3tools/contracts";

import { asString, isRecord } from "./helpers";

function extractToolCallId(data: Record<string, unknown>): string | undefined {
  const direct = asString(data.toolCallId);
  if (direct) return direct;

  const result = isRecord(data.result) ? data.result : undefined;
  if (!result) return undefined;

  return asString(result.tool_use_id) ?? asString(result.toolUseId);
}

// ---------------------------------------------------------------------------
// Input extraction
// ---------------------------------------------------------------------------

function extractInput(raw: unknown): CanonicalToolInput | undefined {
  if (!isRecord(raw)) return undefined;

  const input: CanonicalToolInput = {};
  // Only copy known fields that session-logic actually uses
  if (typeof raw.file_path === "string") input.file_path = raw.file_path;
  if (typeof raw.old_string === "string") input.old_string = raw.old_string;
  if (typeof raw.new_string === "string") input.new_string = raw.new_string;
  if (typeof raw.replace_all === "boolean") input.replace_all = raw.replace_all;
  if (typeof raw.content === "string") input.content = raw.content;
  if (typeof raw.command === "string") input.command = raw.command;
  if (typeof raw.description === "string") input.description = raw.description;
  if (typeof raw.subagent_type === "string") input.subagent_type = raw.subagent_type;
  if (typeof raw.prompt === "string") input.prompt = raw.prompt;
  if (typeof raw.query === "string") input.query = raw.query;
  if (typeof raw.url === "string") input.url = raw.url;
  if (typeof raw.pattern === "string") input.pattern = raw.pattern;

  return Object.keys(input).length > 0 ? input : undefined;
}

// ---------------------------------------------------------------------------
// Result extraction
// ---------------------------------------------------------------------------

function isContentBlockArray(value: unknown): value is ReadonlyArray<CanonicalContentBlock> {
  if (!Array.isArray(value)) return false;
  return value.every((block) => isRecord(block) && typeof block.type === "string");
}

function extractResult(raw: unknown): CanonicalToolResult | undefined {
  if (!isRecord(raw)) return undefined;

  const result: CanonicalToolResult = {};

  // Claude result.content is either a string or an array of content blocks
  if (typeof raw.content === "string") {
    result.content = raw.content;
  } else if (isContentBlockArray(raw.content)) {
    result.content = raw.content;
  }

  if (typeof raw.is_error === "boolean" && raw.is_error) {
    result.isError = true;
    // When is_error is true and content is a string, also set error
    if (typeof raw.content === "string") {
      result.error = raw.content;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/**
 * Extract canonical tool data from a Claude activity payload.
 *
 * Returns null if the payload isn't a tool activity (e.g. content.delta,
 * context-compaction, turn events, etc).
 */
export function extractClaudeToolData(payload: unknown): CanonicalToolData | null {
  if (!isRecord(payload)) return null;

  // Must have an itemType that's a known tool lifecycle type
  const itemType = asString(payload.itemType);
  if (!itemType || !isToolLifecycleItemType(itemType)) return null;

  const data = isRecord(payload.data) ? payload.data : undefined;

  // toolName comes from data.toolName — may not be present on tool.started
  const toolName = data ? asString(data.toolName) : undefined;

  const canonical: CanonicalToolData = {
    toolName: toolName ?? "unknown",
    itemType,
  };

  const detail = asString(payload.detail);
  if (detail !== undefined) canonical.detail = detail;

  const status = asString(payload.status);
  if (status !== undefined) canonical.status = status;

  if (data) {
    const toolCallId = extractToolCallId(data);
    if (toolCallId) canonical.toolCallId = toolCallId;

    const input = extractInput(data.input);
    if (input) canonical.input = input;

    const result = extractResult(data.result);
    if (result) canonical.result = result;
  }

  return canonical;
}

// ---------------------------------------------------------------------------
// Inline diff extraction
// ---------------------------------------------------------------------------

function extractInlineDiffsFromClaudeInput(
  input: CanonicalToolInput | undefined,
  toolName: string,
  toolCallId?: string,
): CanonicalInlineDiff[] {
  if (!input?.file_path) {
    return [];
  }

  if (toolName === "Write" && typeof input.content === "string") {
    return [
      {
        filePath: input.file_path,
        ...(toolCallId ? { toolCallId } : {}),
        toolName,
        changeKind: "add",
        source: "before_after",
        oldString: "",
        newString: input.content,
        anchorLine: 1,
      },
    ];
  }

  if (typeof input.old_string === "string" && typeof input.new_string === "string") {
    return [
      {
        filePath: input.file_path,
        ...(toolCallId ? { toolCallId } : {}),
        toolName,
        changeKind: "update",
        source: "before_after",
        oldString: input.old_string,
        newString: input.new_string,
      },
    ];
  }

  return [];
}

export function extractClaudeInlineDiffs(payload: unknown): CanonicalInlineDiff[] {
  const tool = extractClaudeToolData(payload);
  if (!tool || tool.itemType !== "file_change") {
    return [];
  }

  return extractInlineDiffsFromClaudeInput(tool.input, tool.toolName, tool.toolCallId);
}

export function extractClaudeApprovalInlineDiffs(payload: unknown): CanonicalInlineDiff[] {
  const approval = extractClaudeApprovalData(payload);
  if (!approval || approval.requestKind !== "file-change") {
    return [];
  }

  return extractInlineDiffsFromClaudeInput(
    approval.input,
    approval.toolName ?? "Edit",
    approval.toolUseId,
  );
}

// ---------------------------------------------------------------------------
// Approval extraction
// ---------------------------------------------------------------------------

const VALID_DECISIONS = new Set(["accept", "acceptForSession", "decline", "cancel"]);

/**
 * Extract canonical approval data from a Claude approval.requested payload.
 *
 * Returns null if the payload isn't an approval request.
 * Call `resolveClaudeApproval` with the resolution payload to fill in the decision.
 */
export function extractClaudeApprovalData(payload: unknown): CanonicalApprovalData | null {
  if (!isRecord(payload)) return null;

  const requestId = asString(payload.requestId);
  if (!requestId) return null;

  const requestKind = asString(payload.requestKind);
  if (!requestKind) return null;

  const approval: CanonicalApprovalData = {
    requestId,
    requestKind,
  };

  const detail = asString(payload.detail);
  if (detail !== undefined) approval.detail = detail;

  // Claude puts tool data in args: { toolName, input, toolUseId }
  const args = isRecord(payload.args) ? payload.args : undefined;
  if (args) {
    const toolName = asString(args.toolName);
    if (toolName) approval.toolName = toolName;

    const toolUseId = asString(args.toolUseId);
    if (toolUseId) approval.toolUseId = toolUseId;

    const input = extractInput(args.input);
    if (input) approval.input = input;
  }

  return approval;
}

/**
 * Extract the decision from a Claude approval.resolved payload.
 *
 * Returns the decision string, or null if the payload isn't a resolution.
 */
export function extractClaudeApprovalDecision(
  payload: unknown,
): CanonicalApprovalData["decision"] | null {
  if (!isRecord(payload)) return null;
  const decision = asString(payload.decision);
  if (!decision || !VALID_DECISIONS.has(decision)) return null;
  return decision as CanonicalApprovalData["decision"];
}
