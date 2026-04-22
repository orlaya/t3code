import { memo, useCallback, useState } from "react";
import { LoaderIcon, TerminalIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ToolResultDialog } from "../TerminalHighlight";
import type { AssembledCommand } from "@t3tools/contracts";

export const AssembledCommandRow = memo(function AssembledCommandRow({
  tool,
}: {
  tool: AssembledCommand;
}) {
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const hasResult = !!tool.resultContent;
  const isInProgress = tool.state === "starting" || tool.state === "in-progress";

  const handleClick = hasResult ? () => setResultDialogOpen(true) : undefined;

  const heading = tool.heading;
  const preview = tool.command.length > 0 ? tool.command : null;
  const displayText = preview ? `${heading} - ${preview}` : heading;

  const handleResultClose = useCallback((open: boolean) => setResultDialogOpen(open), []);

  return (
    <>
      <div
        className={cn("rounded-lg px-0.25 py-1", hasResult && "group/file cursor-pointer")}
        onClick={handleClick}
      >
        <div className="flex items-center gap-1 transition-[opacity,translate] duration-200">
          <span className="flex size-5 shrink-0 items-center justify-center text-foreground/60">
            {isInProgress ? (
              <LoaderIcon className="size-3 animate-spin [animation-duration:4s]" />
            ) : (
              <TerminalIcon className="size-3" />
            )}
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            {tool.rawCommand ? (
              <div className="max-w-full">
                <p
                  className={cn(
                    "truncate text-xs leading-5",
                    "text-muted-foreground/90",
                    preview ? "text-muted-foreground/80" : "",
                  )}
                  title={displayText}
                >
                  <span className={cn("text-foreground/80", "text-muted-foreground/90")}>
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
                          {tool.rawCommand}
                        </div>
                      </TooltipPopup>
                    </Tooltip>
                  )}
                </p>
              </div>
            ) : (
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
            )}
          </div>
        </div>
      </div>
      {hasResult && (
        <ToolResultDialog
          open={resultDialogOpen}
          onOpenChange={handleResultClose}
          heading={heading}
          command={tool.rawCommand ?? tool.command}
          resultContent={tool.resultContent!}
        />
      )}
    </>
  );
});
