/**
 * Timeline derivation, edit diff extraction, and checkpoint counting.
 *
 * Assembles messages, proposed plans, work log entries, and edit diffs into
 * a unified chronological timeline for the chat view.
 */

import type {
  AssembledToolInvocation,
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";

import type { ChatMessage, ProposedPlan, TurnDiffSummary } from "../types";
import { extractInlineDiffs } from "../ui-adapter";
import type { EditDiffEntry, TimelineEntry, WorkLogEntry } from "./types";
import { compareActivitiesByOrder } from "./helpers";

// ---------------------------------------------------------------------------
// Edit diff extraction (uses UI adapter)
// ---------------------------------------------------------------------------

export function deriveEditDiffEntries(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  providerName: string,
): EditDiffEntry[] {
  return [...activities]
    .filter((activity) => {
      if (activity.kind !== "tool.completed") return false;
      return extractInlineDiffs(activity.payload, providerName).length > 0;
    })
    .toSorted(compareActivitiesByOrder)
    .flatMap((activity) =>
      extractInlineDiffs(activity.payload, providerName).map((diff, index) => {
        const entry: EditDiffEntry = {
          id: `edit:${activity.id}:${index}`,
          createdAt: activity.createdAt,
          turnId: activity.turnId,
          source: diff.source,
          filePath: diff.filePath,
          changeKind: diff.changeKind,
          toolName: diff.toolName,
        };
        if (diff.toolCallId) entry.toolCallId = diff.toolCallId;
        if (diff.oldString !== undefined) entry.oldString = diff.oldString;
        if (diff.newString !== undefined) entry.newString = diff.newString;
        if (diff.unifiedPatch !== undefined) entry.unifiedPatch = diff.unifiedPatch;
        if (diff.movePath !== undefined) entry.movePath = diff.movePath;
        if (diff.anchorLine !== undefined) entry.anchorLine = diff.anchorLine;
        return entry;
      }),
    );
}

// ---------------------------------------------------------------------------
// Timeline assembly
// ---------------------------------------------------------------------------

export function deriveTimelineEntries(
  messages: ChatMessage[],
  proposedPlans: ProposedPlan[],
  workEntries: WorkLogEntry[],
  editEntries: EditDiffEntry[],
  visibleTurnIds?: Set<TurnId> | TurnId,
  assembledTools?: AssembledToolInvocation[],
): TimelineEntry[] {
  const visibleMessages = messages.filter((message) => {
    if (message.role !== "thinking") return true;
    if (message.text.trim().length === 0) return false;
    if (visibleTurnIds === undefined) return true;
    if (visibleTurnIds instanceof Set)
      return message.turnId != null && visibleTurnIds.has(message.turnId);
    return message.turnId === visibleTurnIds;
  });
  const messageRows: TimelineEntry[] = visibleMessages.map((message) => ({
    id: message.id,
    kind: "message",
    createdAt: message.createdAt,
    message,
  }));
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: "proposed-plan",
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }));
  for (const workEntry of workEntries) {
    delete workEntry.editDiffs;
  }
  // Attach edit diff data to matching work entries so they render inline.
  // Prefer exact tool invocation matches, then fall back to filePath order.
  // Each work entry consumes the next available edit for that path — one
  // edit per work entry so each renders as its own standalone row.
  const editsByToolCallId = new Map<string, EditDiffEntry[]>();
  const editsByFilePath = new Map<string, EditDiffEntry[]>();
  for (const editEntry of editEntries) {
    if (editEntry.toolCallId) {
      let toolBucket = editsByToolCallId.get(editEntry.toolCallId);
      if (!toolBucket) {
        toolBucket = [];
        editsByToolCallId.set(editEntry.toolCallId, toolBucket);
      }
      toolBucket.push(editEntry);
    }
    let bucket = editsByFilePath.get(editEntry.filePath);
    if (!bucket) {
      bucket = [];
      editsByFilePath.set(editEntry.filePath, bucket);
    }
    bucket.push(editEntry);
  }
  const matchedEditIds = new Set<string>();
  for (const workEntry of workEntries) {
    if (workEntry.itemType !== "file_change" || !workEntry.detail) continue;
    const exactEdits =
      workEntry.toolCallId !== undefined ? editsByToolCallId.get(workEntry.toolCallId) : undefined;
    if (exactEdits && exactEdits.length > 0) {
      workEntry.editDiffs = [...exactEdits];
      for (const edit of exactEdits) {
        matchedEditIds.add(edit.id);
      }
      continue;
    }
    const bucket = editsByFilePath.get(workEntry.detail);
    if (!bucket || bucket.length === 0) continue;
    let nextEdit = bucket.shift();
    while (nextEdit && matchedEditIds.has(nextEdit.id)) {
      nextEdit = bucket.shift();
    }
    if (!nextEdit) continue;
    workEntry.editDiffs = [nextEdit];
    matchedEditIds.add(nextEdit.id);
  }

  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: "work",
    createdAt: entry.createdAt,
    entry,
  }));
  // When assembled tools include edits/writes, suppress standalone edit rows
  // for those tool call IDs — the assembled path renders them instead.
  const assembledToolCallIds = new Set<string>();
  if (assembledTools) {
    for (const tool of assembledTools) {
      if ((tool.kind === "edit" || tool.kind === "write") && tool.toolCallId) {
        assembledToolCallIds.add(tool.toolCallId);
      }
    }
  }
  const editRows: TimelineEntry[] = editEntries
    .filter((e) => !matchedEditIds.has(e.id))
    .filter((e) => !e.toolCallId || !assembledToolCallIds.has(e.toolCallId))
    .map((editEntry) => ({
      id: editEntry.id,
      kind: "edit",
      createdAt: editEntry.createdAt,
      editEntry,
    }));
  const assembledToolRows: TimelineEntry[] = (assembledTools ?? []).map((tool) => ({
    id: tool.id,
    kind: "assembled-tool" as const,
    createdAt: tool.createdAt,
    tool,
  }));
  return [
    ...messageRows,
    ...proposedPlanRows,
    ...workRows,
    ...editRows,
    ...assembledToolRows,
  ].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// Completion divider
// ---------------------------------------------------------------------------

export function deriveCompletionDividerBeforeEntryId(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  latestTurn: Pick<
    OrchestrationLatestTurn,
    "assistantMessageId" | "startedAt" | "completedAt"
  > | null,
): string | null {
  if (!latestTurn?.startedAt || !latestTurn.completedAt) {
    return null;
  }

  if (latestTurn.assistantMessageId) {
    const exactMatch = timelineEntries.find(
      (timelineEntry) =>
        timelineEntry.kind === "message" &&
        timelineEntry.message.role === "assistant" &&
        timelineEntry.message.id === latestTurn.assistantMessageId,
    );
    if (exactMatch) {
      return exactMatch.id;
    }
  }

  const turnStartedAt = Date.parse(latestTurn.startedAt);
  const turnCompletedAt = Date.parse(latestTurn.completedAt);
  if (Number.isNaN(turnStartedAt) || Number.isNaN(turnCompletedAt)) {
    return null;
  }

  let inRangeMatch: string | null = null;
  let fallbackMatch: string | null = null;
  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message" || timelineEntry.message.role !== "assistant") {
      continue;
    }
    const messageAt = Date.parse(timelineEntry.message.createdAt);
    if (Number.isNaN(messageAt) || messageAt < turnStartedAt) {
      continue;
    }
    fallbackMatch = timelineEntry.id;
    if (messageAt <= turnCompletedAt) {
      inRangeMatch = timelineEntry.id;
    }
  }
  return inRangeMatch ?? fallbackMatch;
}

// ---------------------------------------------------------------------------
// Checkpoint counting
// ---------------------------------------------------------------------------

export function inferCheckpointTurnCountByTurnId(
  summaries: TurnDiffSummary[],
): Record<TurnId, number> {
  const sorted = [...summaries].toSorted((a, b) => a.completedAt.localeCompare(b.completedAt));
  const result: Record<TurnId, number> = {};
  for (let index = 0; index < sorted.length; index += 1) {
    const summary = sorted[index];
    if (!summary) continue;
    result[summary.turnId] = index + 1;
  }
  return result;
}
