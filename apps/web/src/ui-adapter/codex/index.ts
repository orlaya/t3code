/**
 * Codex provider — UI adapter.
 *
 * Re-exports extraction (field-level) and assembly (lifecycle grouping)
 * functions for the Codex provider.
 */

export { extractCodexToolData, extractCodexInlineDiffs } from "./extraction";

export { assembleCodexTools, type CodexAssemblyResult } from "./assembly";
