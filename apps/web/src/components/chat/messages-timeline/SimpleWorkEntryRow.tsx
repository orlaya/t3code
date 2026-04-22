import { memo, useCallback, useState } from "react";
import { LoaderIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ToolResultDialog } from "../TerminalHighlight";
import { normalizeCompactToolLabel } from "../../../ui-adapter";
import {
  resolveWorkEntryIcon,
  workEntryHeading,
  workEntryPreview,
  workEntryRawCommand,
} from "../workEntryDisplay";
import { parseToolCallDetail } from "../toolCallDisplay";
import { formatWorkspaceRelativePath } from "../../../filePathDisplay";
import { readLocalApi } from "~/localApi";
import { openInPreferredEditor } from "../../../editorPreferences";
import { workToneIcon, workToneClass, workEntryPrimaryFilePath } from "./helpers";
import type { WorkLogEntry } from "../../../session-logic/index";

export const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: WorkLogEntry;
  workspaceRoot: string | undefined;
}) {
  const { workEntry, workspaceRoot } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = resolveWorkEntryIcon(workEntry) ?? iconConfig.icon;
  const heading = workEntryHeading(workEntry);
  const rawPreview = workEntryPreview(workEntry, workspaceRoot);
  const preview =
    rawPreview &&
    normalizeCompactToolLabel(rawPreview).toLowerCase() ===
      normalizeCompactToolLabel(heading).toLowerCase()
      ? null
      : rawPreview;
  const rawCommand = workEntryRawCommand(workEntry);
  const displayText = preview ? `${heading} - ${preview}` : heading;
  const hasChangedFiles = (workEntry.changedFiles?.length ?? 0) > 0;
  const previewIsChangedFiles = hasChangedFiles && !workEntry.command && !workEntry.detail;
  const primaryFilePath = workEntryPrimaryFilePath(workEntry, workspaceRoot);
  const primaryEditDiff = workEntry.editDiffs?.[0];
  const primaryEditorTargetPath =
    primaryFilePath && primaryEditDiff?.anchorLine !== undefined
      ? `${primaryFilePath}:${primaryEditDiff.anchorLine}`
      : primaryFilePath;
  const primaryFileDisplayPath = primaryFilePath
    ? formatWorkspaceRelativePath(
        primaryEditDiff?.anchorLine !== undefined
          ? `${workEntry.detail?.trim() ?? primaryFilePath}:${primaryEditDiff.anchorLine}`
          : (workEntry.detail?.trim() ?? primaryFilePath),
        workspaceRoot,
      )
    : null;
  const isToolCall =
    workEntry.itemType === "dynamic_tool_call" || workEntry.requestKind === "tool-call";
  const toolCallParsed = isToolCall ? parseToolCallDetail(workEntry.detail) : null;

  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const hasResult = !!workEntry.resultContent;

  const handleOpenInEditor = useCallback(() => {
    if (!primaryEditorTargetPath) return;
    const api = readLocalApi();
    if (!api) return;
    void openInPreferredEditor(api, primaryEditorTargetPath);
  }, [primaryEditorTargetPath]);

  const handleClick = primaryFilePath
    ? handleOpenInEditor
    : hasResult
      ? () => setResultDialogOpen(true)
      : undefined;

  const isClickable = !!primaryEditorTargetPath || hasResult;

  return (
    <>
      <div
        className={cn("rounded-lg px-0.25 py-1", isClickable && "group/file cursor-pointer")}
        onClick={handleClick}
      >
        <div className="flex items-center gap-1 transition-[opacity,translate] duration-200">
          <span
            className={cn("flex size-5 shrink-0 items-center justify-center", iconConfig.className)}
          >
            {workEntry.isToolInProgress ? (
              <LoaderIcon className="size-3 animate-spin [animation-duration:4s]" />
            ) : (
              <EntryIcon className="size-3" />
            )}
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            {rawCommand ? (
              <div className="max-w-full">
                <p
                  className={cn(
                    "truncate text-xs leading-5",
                    workToneClass(workEntry.tone),
                    preview ? "text-muted-foreground/80" : "",
                  )}
                  title={displayText}
                >
                  <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                    {heading}
                  </span>
                  {preview && (
                    <Tooltip>
                      <TooltipTrigger
                        closeDelay={0}
                        delay={75}
                        render={
                          <span className="max-w-full cursor-default text-muted-foreground/85">
                            {" "}
                            - {preview}
                          </span>
                        }
                      />
                      <TooltipPopup
                        align="start"
                        className="max-w-[min(56rem,calc(100vw-2rem))] px-0 py-0"
                        side="top"
                      >
                        <div className="max-w-[min(56rem,calc(100vw-2rem))] overflow-x-auto px-1.5 py-1 text-[11px] leading-4 whitespace-nowrap">
                          {rawCommand}
                        </div>
                      </TooltipPopup>
                    </Tooltip>
                  )}
                </p>
              </div>
            ) : primaryFilePath ? (
              <p className={cn("truncate text-[11px] leading-5", workToneClass(workEntry.tone))}>
                <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                  {heading}
                </span>
                <span className="text-muted-foreground/85">
                  {" "}
                  -{" "}
                  <span className="transition-colors duration-150 group-hover/file:text-foreground/70">
                    {primaryFileDisplayPath}
                  </span>
                </span>
              </p>
            ) : toolCallParsed?.url ? (
              <p className={cn("truncate text-[11px] leading-5", workToneClass(workEntry.tone))}>
                <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                  {heading}
                </span>
                <span className="text-muted-foreground/85">
                  {" — "}
                  <a
                    href={toolCallParsed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground/70"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {toolCallParsed.url}
                  </a>
                </span>
              </p>
            ) : (
              <Tooltip>
                <TooltipTrigger className="block min-w-0 w-full text-left" aria-label={displayText}>
                  <p
                    className={cn(
                      "truncate text-[11px] leading-5",
                      workToneClass(workEntry.tone),
                      preview ? "text-muted-foreground/80" : "",
                    )}
                  >
                    <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                      {heading}
                    </span>
                    {preview && <span className="text-muted-foreground/85"> - {preview}</span>}
                  </p>
                </TooltipTrigger>
                <TooltipPopup className="max-w-[min(720px,calc(100vw-2rem))]">
                  <p className="whitespace-pre-wrap wrap-break-word text-xs leading-5">
                    {displayText}
                  </p>
                </TooltipPopup>
              </Tooltip>
            )}
          </div>
        </div>
        {hasChangedFiles &&
          !previewIsChangedFiles &&
          (() => {
            const filteredFiles = primaryFilePath
              ? workEntry.changedFiles?.filter(
                  (fp) => fp !== primaryFilePath && !primaryFilePath.endsWith("/" + fp),
                )
              : workEntry.changedFiles;
            const totalFiltered = filteredFiles?.length ?? 0;
            if (totalFiltered === 0) return null;
            return (
              <div className="mt-1 flex flex-wrap gap-1 pl-6">
                {filteredFiles?.slice(0, 4).map((filePath) => {
                  const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
                  return (
                    <span
                      key={`${workEntry.id}:${filePath}`}
                      className="rounded-md bg-background/75 px-0.5 py-0.75 text-[10.5px] text-muted-foreground/85"
                      title={displayPath}
                    >
                      {displayPath}
                    </span>
                  );
                })}
                {totalFiltered > 4 && (
                  <span className="px-1 text-[10px] text-muted-foreground/80">
                    +{totalFiltered - 4}
                  </span>
                )}
              </div>
            );
          })()}
      </div>
      {hasResult && (
        <ToolResultDialog
          open={resultDialogOpen}
          onOpenChange={setResultDialogOpen}
          heading={heading}
          command={workEntry.rawCommand ?? workEntry.command}
          resultContent={workEntry.resultContent!}
        />
      )}
    </>
  );
});
