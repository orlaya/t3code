/**
 * UI Adapter — entry point.
 *
 * Dispatches to the correct per-provider extraction function based on
 * providerName from the session. Returns CanonicalToolData or null
 * (null = not a tool activity, or unknown provider — graceful degradation).
 */

import type { CanonicalToolData, CanonicalApprovalData } from "@t3tools/contracts";
import {
  extractClaudeToolData,
  extractClaudeApprovalData,
  extractClaudeApprovalDecision,
} from "./claude.ts";
import { extractCodexToolData } from "./codex.ts";
import { extractOpenCodeToolData } from "./opencode.ts";
import { extractCursorToolData } from "./cursor.ts";

export { getLifecycleMap } from "./lifecycle.ts";

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
// Approval extraction
// ---------------------------------------------------------------------------

type ApprovalExtractor = (payload: unknown) => CanonicalApprovalData | null;
type ApprovalDecisionExtractor = (payload: unknown) => CanonicalApprovalData["decision"] | null;

const approvalExtractorsByProvider: Record<string, ApprovalExtractor> = {
  claudeAgent: extractClaudeApprovalData,
  // Other providers: Phase 4
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
