import { memo, useCallback, useMemo } from "react";
import { type PendingApproval } from "../../session-logic/index";
import { InlineEditDiff } from "./InlineEditDiff";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "../../editorPreferences";
import { parseToolCallDetail } from "./toolCallDisplay";
import { extractApprovalInlineDiffs } from "../../ui-adapter";

interface ComposerPendingApprovalPanelProps {
  approval: PendingApproval;
  pendingCount: number;
  providerName: string;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}

function extractEditDiffEntry(approval: PendingApproval, providerName: string) {
  if (approval.requestKind !== "file-change") return null;
  const diff = extractApprovalInlineDiffs(
    {
      requestId: approval.requestId,
      requestKind: approval.requestKind,
      ...(approval.detail ? { detail: approval.detail } : {}),
      ...(approval.args ? { args: approval.args } : {}),
    },
    providerName,
  )[0];
  if (!diff) return null;

  return {
    id: approval.requestId,
    createdAt: approval.createdAt,
    turnId: null,
    source: diff.source,
    ...(diff.toolCallId ? { toolCallId: diff.toolCallId } : {}),
    filePath: diff.filePath,
    ...(diff.oldString !== undefined ? { oldString: diff.oldString } : {}),
    ...(diff.newString !== undefined ? { newString: diff.newString } : {}),
    ...(diff.unifiedPatch !== undefined ? { unifiedPatch: diff.unifiedPatch } : {}),
    changeKind: diff.changeKind,
    ...(diff.movePath !== undefined ? { movePath: diff.movePath } : {}),
    ...(diff.anchorLine !== undefined ? { anchorLine: diff.anchorLine } : {}),
    toolName: diff.toolName,
  };
}

/** Extract the raw file path from approval args (for IDE click). */
function extractFilePath(approval: PendingApproval): string | null {
  const input = approval.args?.input;
  if (!input) return null;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  return null;
}

export const ComposerPendingApprovalPanel = memo(function ComposerPendingApprovalPanel({
  approval,
  pendingCount: _pendingCount,
  providerName,
  workspaceRoot,
  resolvedTheme,
}: ComposerPendingApprovalPanelProps) {
  const editEntry = useMemo(
    () => extractEditDiffEntry(approval, providerName),
    [approval, providerName],
  );
  const rawFilePath = useMemo(() => extractFilePath(approval), [approval]);

  const handleOpenInEditor = useCallback(() => {
    if (!rawFilePath) return;
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, rawFilePath);
  }, [rawFilePath]);

  if (editEntry) {
    return (
      <InlineEditDiff
        editEntry={editEntry}
        workspaceRoot={workspaceRoot}
        resolvedTheme={resolvedTheme}
        headerLabel={editEntry.toolName === "Write" ? "WRITE" : "EDIT"}
        variant="flush"
      />
    );
  }

  if (approval.requestKind === "command") {
    return (
      <div>
        <div className="bg-black/15 px-2.5 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">
            COMMAND
          </span>
        </div>
        {approval.detail && (
          <div className="pt-0 pb-3.5 px-2.5 ">
            <span className="font-mono text-[11px] text-foreground/70">{approval.detail}</span>
          </div>
        )}
      </div>
    );
  }

  if (approval.requestKind === "tool-call") {
    const toolLabel = approval.args?.toolName ?? "TOOL";
    const parsed = parseToolCallDetail(approval.detail, approval.args?.input ?? undefined);

    return (
      <div>
        <div className="bg-black/15 px-2.5 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">
            {toolLabel}
          </span>
        </div>
        {parsed ? (
          <div className="bg-black/15 px-2.5 pt-1.5 pb-2.5 space-y-1">
            {parsed.url && (
              <a
                href={parsed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs font-semibold text-foreground/80 underline"
              >
                {parsed.url}
              </a>
            )}
            {parsed.prompt && (
              <p className="text-xs text-foreground/50 leading-snug">{parsed.prompt}</p>
            )}
          </div>
        ) : approval.detail ? (
          <div className="bg-black/15 pt-0 pb-3.5 px-2.5">
            <span className="font-mono text-[11px] text-foreground/70">{approval.detail}</span>
          </div>
        ) : null}
      </div>
    );
  }

  // file-read / file-change without preview (or any other non-handled type)
  const fallbackLabel = approval.requestKind === "file-change" ? "EDIT" : "READ";
  const displayDetail = approval.detail
    ? formatWorkspaceRelativePath(approval.detail, workspaceRoot)
    : "";

  return (
    <div
      className={`flex items-center gap-2 bg-black/15 px-2.5 py-2.5${rawFilePath ? " cursor-pointer" : ""}`}
      onClick={rawFilePath ? handleOpenInEditor : undefined}
    >
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">
        {fallbackLabel}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-foreground/70">
        {displayDetail}
      </span>
    </div>
  );
});
