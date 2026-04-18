/**
 * ClaudeContextWindowTracker
 *
 * Tracks the *actual* context window fill level for the primary Claude agent
 * by capturing per-API-call token usage from raw `message_delta` stream events.
 *
 * The Claude Agent SDK only surfaces accumulated totals (summed across every
 * API call in the session) via `task_progress` and `result.usage`. Those numbers
 * grow monotonically and do NOT represent how full the context window currently is.
 *
 * The raw Anthropic API stream, however, emits a `message_delta` event at the
 * end of each API response whose `usage` object contains the per-request token
 * breakdown. The sum `input_tokens + cache_creation_input_tokens +
 * cache_read_input_tokens` is the number of tokens that were sent to the model
 * as input — i.e. the actual context window fill at the start of that call.
 * Adding `output_tokens` gives the approximate fill *after* the call (since the
 * output gets appended to the conversation for the next turn).
 *
 * This module is intentionally dependency-free (no Effect, no SDK imports) so it
 * can live in its own file with minimal merge-conflict surface.
 */

import type { ThreadTokenUsageSnapshot } from "@t3tools/contracts";

export interface MessageDeltaUsage {
  readonly input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly output_tokens?: number;
}

export interface ClaudeContextWindowTracker {
  /** Feed the `usage` object from a raw `message_delta` stream event. */
  recordMessageDeltaUsage(usage: MessageDeltaUsage): void;

  /** Set the model's maximum context window size (from ModelUsage.contextWindow). */
  setContextWindow(maxTokens: number): void;

  /**
   * Build a ThreadTokenUsageSnapshot reflecting the real context window fill,
   * or undefined if no message_delta usage has been recorded yet.
   *
   * @param accumulatedTotalProcessedTokens - optional accumulated total from
   * the SDK result, included as a separate stat (totalProcessedTokens) so the
   * UI can show "total billed" alongside "current context fill" if desired.
   */
  snapshot(accumulatedTotalProcessedTokens?: number): ThreadTokenUsageSnapshot | undefined;
}

export function createClaudeContextWindowTracker(): ClaudeContextWindowTracker {
  let lastInputTokens: number | undefined;
  let lastOutputTokens: number | undefined;
  let maxContextWindow: number | undefined;

  return {
    recordMessageDeltaUsage(usage: MessageDeltaUsage): void {
      const input =
        finiteOrZero(usage.input_tokens) +
        finiteOrZero(usage.cache_creation_input_tokens) +
        finiteOrZero(usage.cache_read_input_tokens);
      const output = finiteOrZero(usage.output_tokens);

      // Only record if we got meaningful data (at least some input tokens).
      if (input > 0) {
        lastInputTokens = input;
        lastOutputTokens = output;
      }
    },

    setContextWindow(maxTokens: number): void {
      if (Number.isFinite(maxTokens) && maxTokens > 0) {
        maxContextWindow = maxTokens;
      }
    },

    snapshot(accumulatedTotalProcessedTokens?: number): ThreadTokenUsageSnapshot | undefined {
      if (lastInputTokens === undefined) {
        return undefined;
      }

      // After an API call the output gets appended to the conversation, so the
      // context fill going into the next call is approximately input + output.
      const usedTokens = lastInputTokens + (lastOutputTokens ?? 0);
      const maxTokens = maxContextWindow;
      const cappedUsedTokens =
        maxTokens !== undefined ? Math.min(usedTokens, maxTokens) : usedTokens;

      return {
        usedTokens: cappedUsedTokens,
        lastUsedTokens: cappedUsedTokens,
        ...(lastInputTokens > 0 ? { inputTokens: lastInputTokens } : {}),
        ...(lastOutputTokens !== undefined && lastOutputTokens > 0
          ? { outputTokens: lastOutputTokens }
          : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(typeof accumulatedTotalProcessedTokens === "number" &&
        Number.isFinite(accumulatedTotalProcessedTokens) &&
        accumulatedTotalProcessedTokens > cappedUsedTokens
          ? { totalProcessedTokens: accumulatedTotalProcessedTokens }
          : {}),
      };
    },
  };
}

function finiteOrZero(value: number | undefined | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
