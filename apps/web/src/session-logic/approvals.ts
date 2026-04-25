/**
 * Approval and user-input derivation.
 *
 * Tracks which approval requests and user-input prompts are still pending
 * (opened but not yet resolved) for the current session.
 */

import {
  ApprovalRequestId,
  type OrchestrationThreadActivity,
  type UserInputQuestion,
} from "@t3tools/contracts";

import type { SessionPhase } from "../types";
import type { PendingApproval, PendingApprovalArgs, PendingUserInput } from "./types";
import { compareActivitiesByOrder } from "./helpers";

// ---------------------------------------------------------------------------
// Approval request kind mapping
// ---------------------------------------------------------------------------

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pending approvals
// ---------------------------------------------------------------------------

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  sessionPhase?: SessionPhase | null,
  sessionCreatedAt?: string | null,
): PendingApproval[] {
  // When the session is disconnected (provider process died, laptop sleep, etc.)
  // any pending approvals are stale — the provider callback that was waiting for
  // the response no longer exists.
  if (sessionPhase === "disconnected") {
    return [];
  }

  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const requestKind =
      payload &&
      (payload.requestKind === "command" ||
        payload.requestKind === "file-read" ||
        payload.requestKind === "file-change" ||
        payload.requestKind === "tool-call")
        ? payload.requestKind
        : payload
          ? (requestKindFromRequestType(payload.requestType) ?? "tool-call")
          : null;
    const detail = payload && typeof payload.detail === "string" ? payload.detail : undefined;
    const args =
      payload && payload.args && typeof payload.args === "object"
        ? (payload.args as PendingApprovalArgs)
        : undefined;

    if (activity.kind === "approval.requested" && requestId && requestKind) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail ? { detail } : {}),
        ...(args ? { args } : {}),
      });
      continue;
    }

    if (activity.kind === "approval.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (activity.kind === "provider.approval.respond.failed" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }
  }

  let pending = [...openByRequestId.values()];

  // Discard approvals from a previous session — the provider callbacks that
  // were waiting for the response no longer exist after a session restart.
  if (sessionCreatedAt) {
    pending = pending.filter((a) => a.createdAt >= sessionCreatedAt);
  }

  return pending.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

// ---------------------------------------------------------------------------
// Pending user inputs
// ---------------------------------------------------------------------------

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        multiSelect: question.multiSelect === true,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  sessionPhase?: SessionPhase | null,
): PendingUserInput[] {
  // When the session is disconnected, pending user input prompts are stale.
  if (sessionPhase === "disconnected") {
    return [];
  }

  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId =
      payload && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;

    if (activity.kind === "user-input.requested" && requestId) {
      const questions = parseUserInputQuestions(payload);
      if (!questions) {
        continue;
      }
      openByRequestId.set(requestId, {
        requestId,
        createdAt: activity.createdAt,
        questions,
      });
      continue;
    }

    if (activity.kind === "user-input.resolved" && requestId) {
      openByRequestId.delete(requestId);
      continue;
    }

    if (activity.kind === "provider.user-input.respond.failed" && requestId) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}
