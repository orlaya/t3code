import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPatch } from "diff";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
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

/** Collapsed height in px. ~13 lines at 11px/15px. */
const COLLAPSED_MAX_HEIGHT = 350;

const TOGGLE_CHEVRON_CLASSES =
  "text-muted-foreground/70 transition-colors duration-150 hover:text-foreground";

const TOGGLE_TEXT_CLASSES =
  "text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75";

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
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const diffContainerRef = useRef<HTMLDivElement>(null);

  const handleOpenInEditor = useCallback(() => {
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, editEntry.filePath);
  }, [editEntry.filePath]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((v) => !v);
  }, []);

  const fileDiff = useMemo(() => {
    // Ensure non-empty strings end with \n so createPatch doesn't emit
    // the "No newline at end of file" marker in every snippet diff.
    // Empty strings must stay empty — appending \n to "" makes createPatch
    // think the old file had one blank line, rendering a spurious deletion band.
    const oldStr =
      editEntry.oldString === "" || editEntry.oldString.endsWith("\n")
        ? editEntry.oldString
        : editEntry.oldString + "\n";
    const newStr =
      editEntry.newString === "" || editEntry.newString.endsWith("\n")
        ? editEntry.newString
        : editEntry.newString + "\n";
    const patch = createPatch(editEntry.filePath, oldStr, newStr);
    const parsed = parsePatchFiles(patch, buildPatchCacheKey(patch, "inline-edit"));
    return parsed.flatMap((p) => p.files)[0] ?? null;
  }, [editEntry.filePath, editEntry.oldString, editEntry.newString]);

  // Detect whether the rendered diff overflows the collapsed max-height.
  // ResizeObserver catches the async shadow DOM render (Shiki via worker pool).
  useEffect(() => {
    const el = diffContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setIsOverflowing(el.scrollHeight > COLLAPSED_MAX_HEIGHT);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fileDiff]);

  if (!fileDiff) return null;

  // Always constrain height until explicitly expanded. This prevents the
  // render-then-collapse bounce: without this, `isOverflowing` starts false →
  // no maxHeight → Shiki renders at full height → ResizeObserver fires →
  // isOverflowing flips true → maxHeight snaps to 350 → height shrinks
  // dramatically → virtualizer's cached measurement is wrong → scroll jumps.
  // By always starting constrained, the height is stable from first paint.
  const showExpanded = isOverflowing && isExpanded;

  return (
    <div
      className="cursor-pointer rounded-lg border border-border/45 bg-card/25 overflow-hidden transition-colors duration-100 hover:border-border/70"
      onClick={handleOpenInEditor}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">
          {displayPath}
        </span>
        {isOverflowing && (
          <div
            className={`${TOGGLE_CHEVRON_CLASSES} ml-auto flex flex-1 cursor-pointer items-center justify-end self-stretch shrink-0`}
            onClick={handleToggle}
          >
            {isExpanded ? (
              <ChevronUpIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </div>
        )}
      </div>

      <div
        ref={diffContainerRef}
        className="relative"
        style={showExpanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT, overflow: "hidden" }}
      >
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
        {!showExpanded && isOverflowing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card/90 to-transparent" />
        )}
      </div>

      {isOverflowing && (
        <button
          type="button"
          className={`${TOGGLE_TEXT_CLASSES} w-full py-1.5 text-center`}
          onClick={handleToggle}
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
});
