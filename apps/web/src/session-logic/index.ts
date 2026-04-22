/**
 * Session logic — public API.
 *
 * Re-exports everything that components import from "session-logic".
 */

// Types
export type {
  WorkLogEntry,
  PendingApproval,
  PendingApprovalArgs,
  PendingUserInput,
  ActivePlanState,
  LatestProposedPlanState,
  EditDiffEntry,
  TimelineEntry,
  ProviderPickerKind,
} from "./types";
export { PROVIDER_OPTIONS } from "./types";

// Helpers
export {
  formatDuration,
  formatElapsed,
  isLatestTurnSettled,
  deriveActiveWorkStartedAt,
  derivePhase,
  hasToolActivityForTurn,
} from "./helpers";

// Approvals
export { derivePendingApprovals, derivePendingUserInputs } from "./approvals";

// Plans
export {
  deriveActivePlanState,
  findLatestProposedPlan,
  findSidebarProposedPlan,
  hasActionableProposedPlan,
} from "./plans";

// Work log
export { deriveWorkLogEntries } from "./work-log";

// Timeline
export {
  deriveEditDiffEntries,
  deriveTimelineEntries,
  deriveCompletionDividerBeforeEntryId,
  inferCheckpointTurnCountByTurnId,
} from "./timeline";
