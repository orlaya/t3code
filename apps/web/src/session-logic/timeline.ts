/**
 * Timeline derivation, edit diff extraction, and checkpoint counting.
 *
 * Assembles messages, proposed plans, work log entries, and edit diffs into
 * a unified chronological timeline for the chat view.
 */

import type {
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";

import type { ChatMessage, ProposedPlan, TurnDiffSummary } from "../types";
import { extractToolData } from "../ui-adapter";
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
      const canonical = extractToolData(activity.payload, providerName);
      if (!canonical?.input?.file_path) return false;
      // Edit tool: old_string + new_string
      const isEdit =
        typeof canonical.input.old_string === "string" &&
        typeof canonical.input.new_string === "string";
      // Write tool: content (full file written, no old content)
      const isWrite = canonical.toolName === "Write" && typeof canonical.input.content === "string";
      return isEdit || isWrite;
    })
    .toSorted(compareActivitiesByOrder)
    .map((activity) => {
      const canonical = extractToolData(activity.payload, providerName)!;
      const input = canonical.input!;
      const isWrite = canonical.toolName === "Write";
      const entry: EditDiffEntry = {
        id: `edit:${activity.id}`,
        createdAt: activity.createdAt,
        turnId: activity.turnId,
        filePath: input.file_path!,
        oldString: isWrite ? "" : (input.old_string as string),
        newString: isWrite ? (input.content as string) : (input.new_string as string),
        replaceAll: isWrite ? false : (input.replace_all ?? false),
        toolName: canonical.toolName,
      };
      if (canonical.toolCallId) entry.toolCallId = canonical.toolCallId;
      return entry;
    });
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
): TimelineEntry[] {
  const visibleMessages = messages.filter((message) => {
    if (message.role !== "thinking") return true;
    if (visibleTurnIds === undefined) return false;
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
  const editsByToolCallId = new Map<string, EditDiffEntry>();
  const editsByFilePath = new Map<string, EditDiffEntry[]>();
  for (const editEntry of editEntries) {
    if (editEntry.toolCallId) {
      editsByToolCallId.set(editEntry.toolCallId, editEntry);
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
    const exactEdit =
      workEntry.toolCallId !== undefined ? editsByToolCallId.get(workEntry.toolCallId) : undefined;
    if (exactEdit) {
      workEntry.editDiffs = [exactEdit];
      matchedEditIds.add(exactEdit.id);
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
  const editRows: TimelineEntry[] = editEntries
    .filter((e) => !matchedEditIds.has(e.id))
    .map((editEntry) => ({
      id: editEntry.id,
      kind: "edit",
      createdAt: editEntry.createdAt,
      editEntry,
    }));
  return [...messageRows, ...proposedPlanRows, ...workRows, ...editRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
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
