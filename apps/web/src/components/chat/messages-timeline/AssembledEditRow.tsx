import { memo, useCallback, useMemo } from "react";
import { PenLine } from "lucide-react";
import { cn } from "~/lib/utils";
import { ToolRowIcon, toolHeadingClass, toolHeadingSuffix } from "./ToolRowIcon";
import { InlineEditDiff } from "../InlineEditDiff";
import { formatWorkspaceRelativePath } from "../../../filePathDisplay";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "../../../editorPreferences";
import type { AssembledEdit, AssembledWrite } from "@t3tools/contracts";
import type { EditDiffEntry } from "../../../session-logic/index";

/**
 * Renders an assembled Edit invocation — heading row + inline diff below.
 */
export const AssembledEditRow = memo(function AssembledEditRow({
  tool,
  workspaceRoot,
  resolvedTheme,
}: {
  tool: AssembledEdit;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}) {
  const displayPath = formatWorkspaceRelativePath(tool.filePath, workspaceRoot);
  const hasInlineDiff = tool.inlineDiffs.length > 0;
  const heading = tool.heading + toolHeadingSuffix(tool.state);
  const headingCls = toolHeadingClass(tool.state);

  const handleOpenInEditor = useCallback(() => {
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, tool.filePath);
  }, [tool.filePath]);

  // Construct an EditDiffEntry from the first inline diff so InlineEditDiff
  // can render it. The assembled edit owns the data; we're just bridging
  // into the existing component's expected shape.
  const editEntry: EditDiffEntry | null = useMemo(() => {
    const diff = tool.inlineDiffs[0];
    if (!diff) return null;
    const entry: EditDiffEntry = {
      id: tool.id,
      createdAt: tool.createdAt,
      turnId: null,
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
  }, [tool]);

  const isFailed = tool.state === "failed";
  const showInlineDiff = hasInlineDiff && editEntry && !isFailed;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/45",
        isFailed ? "bg-destructive/5" : "bg-card/25",
      )}
    >
      <div className="px-0.5">
        <div
          className="group/file cursor-pointer rounded-lg px-0.25 py-1"
          onClick={handleOpenInEditor}
        >
          <div className="flex items-start gap-1 transition-[opacity,translate] duration-200">
            <ToolRowIcon state={tool.state} restIcon={PenLine} />
            <div className="min-w-0 flex-1 overflow-hidden">
              {isFailed && tool.errorMessage ? (
                <>
                  <p className={cn("truncate text-[11px] leading-5", headingCls)}>
                    <span className={headingCls}>{heading} failed</span>
                    <span className={headingCls}> – {tool.errorMessage}</span>
                  </p>
                  {tool.filePath && (
                    <p className="truncate text-[11px] leading-4 italic text-muted-foreground/80">
                      {displayPath}
                    </p>
                  )}
                </>
              ) : (
                <p className={cn("truncate text-[11px] leading-5", headingCls)}>
                  <span className={headingCls}>{heading}</span>
                  {tool.filePath && (
                    <span className="text-muted-foreground/85">
                      {" "}
                      -{" "}
                      <span className="transition-colors duration-150 group-hover/file:text-foreground/70">
                        {displayPath}
                      </span>
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {showInlineDiff && (
        <InlineEditDiff
          editEntry={editEntry}
          workspaceRoot={workspaceRoot}
          resolvedTheme={resolvedTheme}
          variant="flush"
          hideHeader
        />
      )}
    </div>
  );
});

/**
 * Renders an assembled Write invocation — heading row + inline diff below.
 * Writes show the full content as an "add" diff.
 */
export const AssembledWriteRow = memo(function AssembledWriteRow({
  tool,
  workspaceRoot,
  resolvedTheme,
}: {
  tool: AssembledWrite;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}) {
  const displayPath = formatWorkspaceRelativePath(tool.filePath, workspaceRoot);
  const heading = tool.heading + toolHeadingSuffix(tool.state);
  const headingCls = toolHeadingClass(tool.state);

  const handleOpenInEditor = useCallback(() => {
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, tool.filePath);
  }, [tool.filePath]);

  // Construct an EditDiffEntry for the Write — shows as an "add" diff
  const editEntry: EditDiffEntry | null = useMemo(() => {
    if (!tool.content) return null;
    const entry: EditDiffEntry = {
      id: tool.id,
      createdAt: tool.createdAt,
      turnId: null,
      source: "before_after",
      filePath: tool.filePath,
      changeKind: "add",
      toolName: "Write",
      oldString: "",
      newString: tool.content,
      anchorLine: 1,
    };
    if (tool.toolCallId) entry.toolCallId = tool.toolCallId;
    return entry;
  }, [tool]);

  const isFailed = tool.state === "failed";
  const showInlineDiff = editEntry && !isFailed;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border/45",
        isFailed ? "bg-destructive/5" : "bg-card/25",
      )}
    >
      <div className="px-0.5">
        <div
          className="group/file cursor-pointer rounded-lg px-0.25 py-1"
          onClick={handleOpenInEditor}
        >
          <div className="flex items-start gap-1 transition-[opacity,translate] duration-200">
            <ToolRowIcon state={tool.state} restIcon={PenLine} />
            <div className="min-w-0 flex-1 overflow-hidden">
              {isFailed && tool.errorMessage ? (
                <>
                  <p className={cn("truncate text-[11px] leading-5", headingCls)}>
                    <span className={headingCls}>{heading} failed</span>
                    <span className={headingCls}> – {tool.errorMessage}</span>
                  </p>
                  {tool.filePath && (
                    <p className="truncate text-[11px] leading-4 italic text-muted-foreground/80">
                      {displayPath}
                    </p>
                  )}
                </>
              ) : (
                <p className={cn("truncate text-[11px] leading-5", headingCls)}>
                  <span className={headingCls}>{heading}</span>
                  {tool.filePath && (
                    <span className="text-muted-foreground/85">
                      {" "}
                      -{" "}
                      <span className="transition-colors duration-150 group-hover/file:text-foreground/70">
                        {displayPath}
                      </span>
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      {showInlineDiff && (
        <InlineEditDiff
          editEntry={editEntry}
          workspaceRoot={workspaceRoot}
          resolvedTheme={resolvedTheme}
          variant="flush"
          hideHeader
        />
      )}
    </div>
  );
});
