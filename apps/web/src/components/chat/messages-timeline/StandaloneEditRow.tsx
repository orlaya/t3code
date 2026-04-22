import { memo, useCallback } from "react";
import { PencilIcon } from "lucide-react";
import { InlineEditDiff } from "../InlineEditDiff";
import { formatWorkspaceRelativePath } from "../../../filePathDisplay";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "../../../editorPreferences";
import type { EditDiffEntry } from "../../../session-logic/index";

export const StandaloneEditRow = memo(function StandaloneEditRow({
  editEntry,
  workspaceRoot,
  resolvedTheme,
}: {
  editEntry: EditDiffEntry;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}) {
  const displayPath = formatWorkspaceRelativePath(editEntry.filePath, workspaceRoot);
  const heading = editEntry.toolName === "Write" ? "Write" : "Edit";

  const handleOpenInEditor = useCallback(() => {
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, editEntry.filePath);
  }, [editEntry.filePath]);

  return (
    <div className="rounded-lg border border-border/45 bg-card/25 overflow-hidden">
      <div className="px-0.5">
        <div
          className="group/file cursor-pointer rounded-lg px-0.25 py-1"
          onClick={handleOpenInEditor}
        >
          <div className="flex items-center gap-1 transition-[opacity,translate] duration-200">
            <span className="flex size-5 shrink-0 items-center justify-center text-foreground/60">
              <PencilIcon className="size-3" />
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="truncate text-[11px] leading-5 text-muted-foreground/90">
                <span className="text-muted-foreground/90">{heading}</span>
                <span className="text-muted-foreground/85">
                  {" "}
                  -{" "}
                  <span className="transition-colors duration-150 group-hover/file:text-foreground/70">
                    {displayPath}
                  </span>
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
      <InlineEditDiff
        editEntry={editEntry}
        workspaceRoot={workspaceRoot}
        resolvedTheme={resolvedTheme}
        variant="flush"
        hideHeader
      />
    </div>
  );
});
