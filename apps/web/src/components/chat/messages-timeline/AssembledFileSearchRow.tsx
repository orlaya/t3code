import { memo, useCallback, useState } from "react";
import { LoaderIcon, SearchIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ToolResultDialog } from "../TerminalHighlight";
import { formatWorkspaceRelativePath } from "../../../filePathDisplay";
import type { AssembledFileSearch } from "@t3tools/contracts";

export const AssembledFileSearchRow = memo(function AssembledFileSearchRow({
  tool,
  workspaceRoot,
}: {
  tool: AssembledFileSearch;
  workspaceRoot: string | undefined;
}) {
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const hasResult = !!tool.resultContent;
  const isInProgress = tool.state === "starting" || tool.state === "in-progress";

  const heading = tool.heading;
  const preview = tool.pattern
    ? tool.filePath
      ? `${formatWorkspaceRelativePath(tool.filePath, workspaceRoot)} · ${tool.pattern}`
      : tool.pattern
    : tool.filePath
      ? formatWorkspaceRelativePath(tool.filePath, workspaceRoot)
      : null;
  const displayText = preview ? `${heading} - ${preview}` : heading;

  const handleResultClick = hasResult ? () => setResultDialogOpen(true) : undefined;
  const handleResultClose = useCallback((open: boolean) => setResultDialogOpen(open), []);

  return (
    <>
      <div
        className={cn("rounded-lg px-0.25 py-1", hasResult && "group/file cursor-pointer")}
        onClick={handleResultClick}
      >
        <div className="flex items-center gap-1 transition-[opacity,translate] duration-200">
          <span className="flex size-5 shrink-0 items-center justify-center text-foreground/60">
            {isInProgress ? (
              <LoaderIcon className="size-3 animate-spin [animation-duration:4s]" />
            ) : (
              <SearchIcon className="size-3" />
            )}
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <Tooltip>
              <TooltipTrigger className="block min-w-0 w-full text-left" aria-label={displayText}>
                <p
                  className={cn(
                    "truncate text-[11px] leading-5",
                    "text-muted-foreground/90",
                    preview ? "text-muted-foreground/80" : "",
                  )}
                >
                  <span className={cn("text-foreground/80", "text-muted-foreground/90")}>
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
          </div>
        </div>
      </div>
      {hasResult && (
        <ToolResultDialog
          open={resultDialogOpen}
          onOpenChange={handleResultClose}
          heading={heading}
          command={preview ?? heading}
          resultContent={tool.resultContent!}
        />
      )}
    </>
  );
});
