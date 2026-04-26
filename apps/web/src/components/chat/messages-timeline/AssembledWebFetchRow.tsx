import { memo, useCallback, useState } from "react";
import { LinkIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { ToolRowIcon, toolHeadingClass, toolHeadingSuffix } from "./ToolRowIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ToolResultDialog } from "../TerminalHighlight";
import type { AssembledWebFetch } from "@t3tools/contracts";

export const AssembledWebFetchRow = memo(function AssembledWebFetchRow({
  tool,
}: {
  tool: AssembledWebFetch;
}) {
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const hasResult = !!tool.resultContent;
  const heading = tool.heading + toolHeadingSuffix(tool.state);
  const headingCls = toolHeadingClass(tool.state);
  const displayUrl = tool.url ?? null;
  const displayText = displayUrl ? `${heading} - ${displayUrl}` : heading;

  const handleResultClick = hasResult ? () => setResultDialogOpen(true) : undefined;
  const handleResultClose = useCallback((open: boolean) => setResultDialogOpen(open), []);

  return (
    <>
      <div
        className={cn("rounded-lg px-0.25 py-1", hasResult && "group/file cursor-pointer")}
        onClick={handleResultClick}
      >
        <div className="flex items-center gap-1 transition-[opacity,translate] duration-200">
          <ToolRowIcon state={tool.state} restIcon={LinkIcon} hook={tool.hook} />
          <div className="min-w-0 flex-1 overflow-hidden">
            <Tooltip>
              <TooltipTrigger className="block min-w-0 w-full text-left" aria-label={displayText}>
                <p
                  className={cn(
                    "truncate text-[11px] leading-5",
                    headingCls,
                    displayUrl ? "text-muted-foreground/80" : "",
                  )}
                >
                  <span className={cn("text-foreground/80", headingCls)}>{heading}</span>
                  {displayUrl && (
                    <span className="text-muted-foreground/85">
                      {" "}
                      -{" "}
                      <a
                        href={displayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {displayUrl}
                      </a>
                    </span>
                  )}
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
          command={displayUrl ?? heading}
          resultContent={tool.resultContent!}
        />
      )}
    </>
  );
});
