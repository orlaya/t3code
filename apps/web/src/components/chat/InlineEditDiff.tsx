import { memo, useCallback, useMemo } from "react";
import { createPatch } from "diff";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { type EditDiffEntry } from "../../session-logic";
import { resolveDiffThemeName, buildPatchCacheKey } from "../../lib/diffRendering";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "../../editorPreferences";

const INLINE_DIFF_STYLE = {
  "--diffs-font-size": "11px",
   "--diffs-line-height": "15px",
   "--diffs-token-light-font-weight": "400",
   "--diffs-token-dark-font-weight": "400",
} as React.CSSProperties;

export const InlineEditDiff = memo(function InlineEditDiff({
  editEntry,
  workspaceRoot,
  resolvedTheme,
}: {
  editEntry: EditDiffEntry;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}) {
  const displayPath = formatWorkspaceRelativePath(editEntry.filePath, workspaceRoot);

  const handleOpenInEditor = useCallback(() => {
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, editEntry.filePath);
  }, [editEntry.filePath]);

  const fileDiff = useMemo(() => {
    // Ensure both strings end with \n so createPatch doesn't emit
    // the "No newline at end of file" marker in every snippet diff.
    const oldStr = editEntry.oldString.endsWith("\n")
      ? editEntry.oldString
      : editEntry.oldString + "\n";
    const newStr = editEntry.newString.endsWith("\n")
      ? editEntry.newString
      : editEntry.newString + "\n";
    const patch = createPatch(editEntry.filePath, oldStr, newStr);
    const parsed = parsePatchFiles(patch, buildPatchCacheKey(patch, "inline-edit"));
    return parsed.flatMap((p) => p.files)[0] ?? null;
  }, [editEntry.filePath, editEntry.oldString, editEntry.newString]);

  if (!fileDiff) return null;

  return (
    <div
      className="cursor-pointer rounded-lg border border-border/45 bg-card/25 overflow-hidden transition-colors duration-100 hover:border-border/70"
      onClick={handleOpenInEditor}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">
          {displayPath}
        </span>

      </div>
      <FileDiff
        fileDiff={fileDiff}
        style={INLINE_DIFF_STYLE}
        options={{
          diffStyle: "unified",
          disableFileHeader: true,
          disableLineNumbers: true,
          hunkSeparators: "simple",
          lineDiffType: "none",
          overflow: "wrap",
          theme: resolveDiffThemeName(resolvedTheme),
          themeType: resolvedTheme,
        }}
      />
    </div>
  );
});
