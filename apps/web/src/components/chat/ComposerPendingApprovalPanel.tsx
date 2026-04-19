import { memo, useMemo } from "react";
import { type PendingApproval } from "../../session-logic";
import { InlineEditDiff } from "./InlineEditDiff";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}

/**
 * Extract edit diff data from approval args when the tool is an edit-style tool
 * with old_string/new_string parameters.
 */
function extractEditDiffEntry(approval: PendingApproval) {
  const args = approval.args;
  if (!args?.input || approval.requestKind !== "file-change") return null;

  const input = args.input;
  const filePath = typeof input.file_path === "string" ? input.file_path : null;
  const oldString = typeof input.old_string === "string" ? input.old_string : null;
  const newString = typeof input.new_string === "string" ? input.new_string : null;

  if (!filePath || oldString == null || newString == null) return null;

  return {
    id: approval.requestId,
    createdAt: approval.createdAt,
    turnId: null,
    filePath,
    oldString,
    newString,
    replaceAll: input.replace_all === true,
    toolName: args.toolName ?? "Edit",
  };
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount,
  workspaceRoot,
  resolvedTheme,
}: ComposerPendingApprovalPanelProps) {
  const approvalSummary =
    approval.requestKind === "command"
      ? "Command approval requested"
      : approval.requestKind === "file-read"
        ? "File-read approval requested"
        : "File-change approval requested";

  const editEntry = useMemo(() => extractEditDiffEntry(approval), [approval]);

  return (
    <div className="px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="uppercase text-sm tracking-[0.2em]">PENDING APPROVAL</span>
        <span className="text-sm font-medium">{approvalSummary}</span>
        {pendingCount > 1 ? (
          <span className="text-xs text-muted-foreground">1/{pendingCount}</span>
        ) : null}
      </div>
      {editEntry && (
        <div className="mt-3">
          <InlineEditDiff
            editEntry={editEntry}
            workspaceRoot={workspaceRoot}
            resolvedTheme={resolvedTheme}
          />
        </div>
      )}
    </div>
  );
});
