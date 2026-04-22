/**
 * UI Adapter — entry point.
 *
 * Dispatches to the correct per-provider extraction function based on
 * providerName from the session. Returns CanonicalToolData or null
 * (null = not a tool activity, or unknown provider — graceful degradation).
 */

import type {
  CanonicalApprovalData,
  CanonicalInlineDiff,
  CanonicalToolData,
  CanonicalToolInput,
} from "@t3tools/contracts";
import {
  extractClaudeApprovalInlineDiffs,
  extractClaudeToolData,
  extractClaudeApprovalData,
  extractClaudeApprovalDecision,
  extractClaudeInlineDiffs,
} from "./claude.ts";
import { extractCodexInlineDiffs, extractCodexToolData } from "./codex.ts";
import { extractOpenCodeToolData } from "./opencode.ts";
import { extractCursorToolData } from "./cursor.ts";

export { getLifecycleMap } from "./lifecycle.ts";
export {
  normalizeCompactToolLabel,
  resolveToolDisplayPresentation,
  type CanonicalToolDisplayPresentation,
} from "./display.ts";
export { assembleClaudeTools, type ClaudeAssemblyResult } from "./claude/index.ts";
export { buildSubAgentTaskLinks, type SubAgentTaskLinks } from "./task-linking.ts";

type Extractor = (payload: unknown) => CanonicalToolData | null;

const extractorsByProvider: Record<string, Extractor> = {
  claudeAgent: extractClaudeToolData,
  cursor: extractCursorToolData,
  codex: extractCodexToolData,
  opencode: extractOpenCodeToolData,
};

/**
 * Extract canonical tool data from a raw activity payload.
 *
 * @param payload - The raw `activity.payload` (typed as `unknown` in the DB)
 * @param providerName - From `session.providerName`, e.g. "claudeAgent"
 * @returns Canonical tool data, or null if not a tool activity / unknown provider
 */
export function extractToolData(payload: unknown, providerName: string): CanonicalToolData | null {
  const extractor = extractorsByProvider[providerName];
  if (!extractor) return null;
  return extractor(payload);
}

// ---------------------------------------------------------------------------
// Inline diff extraction
// ---------------------------------------------------------------------------

type InlineDiffExtractor = (payload: unknown) => CanonicalInlineDiff[];

const inlineDiffExtractorsByProvider: Record<string, InlineDiffExtractor> = {
  claudeAgent: extractClaudeInlineDiffs,
  codex: extractCodexInlineDiffs,
  opencode: () => [],
  cursor: () => [],
};

export function extractInlineDiffs(
  payload: unknown,
  providerName: string,
): ReadonlyArray<CanonicalInlineDiff> {
  const extractor = inlineDiffExtractorsByProvider[providerName];
  if (!extractor) return [];
  return extractor(payload);
}

function extractApprovalInlineDiffsFromInput(
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

export function extractInlineDiffsFromApprovalArgs(input: {
  toolName?: string;
  input?: CanonicalToolInput;
  toolUseId?: string;
}): ReadonlyArray<CanonicalInlineDiff> {
  return extractApprovalInlineDiffsFromInput(
    input.input,
    input.toolName ?? "Edit",
    input.toolUseId,
  );
}

// ---------------------------------------------------------------------------
// Approval extraction
// ---------------------------------------------------------------------------

type ApprovalExtractor = (payload: unknown) => CanonicalApprovalData | null;
type ApprovalDecisionExtractor = (payload: unknown) => CanonicalApprovalData["decision"] | null;

const approvalExtractorsByProvider: Record<string, ApprovalExtractor> = {
  claudeAgent: extractClaudeApprovalData,
  // Other providers: Phase 4
};

type ApprovalInlineDiffExtractor = (payload: unknown) => CanonicalInlineDiff[];

const approvalInlineDiffExtractorsByProvider: Record<string, ApprovalInlineDiffExtractor> = {
  claudeAgent: extractClaudeApprovalInlineDiffs,
};

const approvalDecisionExtractorsByProvider: Record<string, ApprovalDecisionExtractor> = {
  claudeAgent: extractClaudeApprovalDecision,
  // Other providers: Phase 4
};

/**
 * Extract canonical approval data from a raw approval.requested payload.
 */
export function extractApprovalData(
  payload: unknown,
  providerName: string,
): CanonicalApprovalData | null {
  const extractor = approvalExtractorsByProvider[providerName];
  if (!extractor) return null;
  return extractor(payload);
}

export function extractApprovalInlineDiffs(
  payload: unknown,
  providerName: string,
): ReadonlyArray<CanonicalInlineDiff> {
  const extractor = approvalInlineDiffExtractorsByProvider[providerName];
  if (!extractor) return [];
  return extractor(payload);
}

/**
 * Extract the decision from a raw approval.resolved payload.
 */
export function extractApprovalDecision(
  payload: unknown,
  providerName: string,
): CanonicalApprovalData["decision"] | null {
  const extractor = approvalDecisionExtractorsByProvider[providerName];
  if (!extractor) return null;
  return extractor(payload);
}
