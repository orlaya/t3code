/**
 * Public types for the session-logic module.
 *
 * These are the shapes consumed by components — WorkLogEntry, PendingApproval,
 * EditDiffEntry, TimelineEntry, etc. Internal-only types (like DerivedWorkLogEntry)
 * live in the files that use them.
 */

import { ProviderDriverKind } from "@t3tools/contracts";
import type {
  ApprovalRequestId,
  AssembledToolInvocation,
  CanonicalDisplayCapabilities,
  CanonicalDisplayKind,
  CanonicalInlineDiff,
  CanonicalLifecycleShape,
  OrchestrationProposedPlanId,
  ToolLifecycleItemType,
  UserInputQuestion,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import type { ChatMessage, ProposedPlan } from "../types";

// ---------------------------------------------------------------------------
// Provider picker
// ---------------------------------------------------------------------------

export type ProviderPickerKind = ProviderDriverKind;

export const PROVIDER_OPTIONS: Array<{
  value: ProviderPickerKind;
  label: string;
  available: boolean;
  /** Shown on the model picker sidebar when relevant */
  pickerSidebarBadge?: "new" | "soon";
}> = [
  { value: ProviderDriverKind.make("codex"), label: "Codex", available: true },
  { value: ProviderDriverKind.make("claudeAgent"), label: "Claude", available: true },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    available: true,
    pickerSidebarBadge: "new",
  },
];

// ---------------------------------------------------------------------------
// Work log
// ---------------------------------------------------------------------------

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  rawCommand?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
  toolTitle?: string;
  displayKind?: CanonicalDisplayKind;
  displayHeading?: string;
  lifecycleShape?: CanonicalLifecycleShape;
  displayCapabilities?: CanonicalDisplayCapabilities;
  itemType?: ToolLifecycleItemType;
  requestKind?: PendingApproval["requestKind"];
  /** True when this is a sub-agent tool call that hasn't completed yet. */
  isSubAgentInProgress?: boolean;
  /** True when context compaction is in progress (spinner). */
  isCompacting?: boolean;
  /** True when context compaction has finished. */
  isCompacted?: boolean;
  /** Only present on collab_agent_tool_call entries. */
  subAgentBrief?: {
    prompt: string;
    description: string;
    agentType?: string;
  };
  /** Only present on completed collab_agent_tool_call entries. */
  subAgentResult?: string;
  /** Task ID — present on task.progress entries and matched subagent entries. */
  taskId?: string;
  /** Full tool result output — present on completed command_execution / dynamic_tool_call entries. */
  resultContent?: string;
  /** True when a tool call hasn't completed yet (spinner indicator). */
  isToolInProgress?: boolean;
  /** Unique per tool invocation when the provider exposes one. */
  toolCallId?: string;
  /** Attached edit/write diff — present on completed file_change entries. One diff per work entry. */
  editDiffs?: EditDiffEntry[];
}

// ---------------------------------------------------------------------------
// Approvals & user input
// ---------------------------------------------------------------------------

export interface PendingApprovalArgs {
  toolName?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change" | "tool-call";
  createdAt: string;
  detail?: string;
  args?: PendingApprovalArgs;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<UserInputQuestion>;
}

// ---------------------------------------------------------------------------
// Plan state
// ---------------------------------------------------------------------------

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

// ---------------------------------------------------------------------------
// Edit diffs
// ---------------------------------------------------------------------------

export interface EditDiffEntry {
  id: string;
  createdAt: string;
  turnId: string | null;
  source: CanonicalInlineDiff["source"];
  toolCallId?: string;
  filePath: string;
  oldString?: string;
  newString?: string;
  unifiedPatch?: string;
  changeKind: CanonicalInlineDiff["changeKind"];
  movePath?: string;
  anchorLine?: number;
  replaceAll?: boolean;
  toolName: string;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineEntry =
  | {
      id: string;
      kind: "message";
      createdAt: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "proposed-plan";
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      id: string;
      kind: "work";
      createdAt: string;
      entry: WorkLogEntry;
    }
  | {
      id: string;
      kind: "edit";
      createdAt: string;
      editEntry: EditDiffEntry;
    }
  | {
      id: string;
      kind: "assembled-tool";
      createdAt: string;
      tool: AssembledToolInvocation;
    };
