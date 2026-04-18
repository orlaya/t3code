/**
 * Utilities for "terminal threads" — phantom threads that exist solely
 * to host a project-scoped persistent terminal (no chat UI).
 *
 * Convention: the thread ID is prefixed with `TERMINAL-`.
 * ThreadId is just a branded non-empty string so any prefix works.
 * The title remains fully user-editable.
 */

import { ThreadId } from "@t3tools/contracts";

export const TERMINAL_THREAD_ID_PREFIX = "TERMINAL-";

export const DEFAULT_TERMINAL_THREAD_TITLE = "Terminal";

/** Returns `true` when the thread ID marks it as a terminal-only thread. */
export function isTerminalThread(threadId: string): boolean {
  return threadId.startsWith(TERMINAL_THREAD_ID_PREFIX);
}

/** Generates a new terminal thread ID with the `TERMINAL-` prefix. */
export function newTerminalThreadId(): ThreadId {
  const suffix = crypto.randomUUID();
  return ThreadId.make(`${TERMINAL_THREAD_ID_PREFIX}${suffix}`);
}
