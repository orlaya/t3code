/**
 * Claude provider — UI adapter.
 *
 * Re-exports extraction (field-level) and assembly (lifecycle grouping)
 * functions for the Claude provider.
 */

export {
  extractClaudeToolData,
  extractClaudeInlineDiffs,
  extractClaudeApprovalData,
  extractClaudeApprovalDecision,
  extractClaudeApprovalInlineDiffs,
} from "./extraction";

export { assembleClaudeTools, type ClaudeAssemblyResult } from "./assembly";
