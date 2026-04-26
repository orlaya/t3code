import { memo, useCallback, useState } from "react";
import { CircleChevronRightIcon, WrenchIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { ToolRowIcon, toolHeadingClass, toolHeadingSuffix } from "./ToolRowIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { ToolResultDialog } from "../TerminalHighlight";
import type { AssembledMcpTool, AssembledToolCall } from "@t3tools/contracts";

/**
 * Renders a generic tool-call or MCP tool row.
 *
 * MCP tools get WrenchIcon, generic dynamic tools get CircleChevronRightIcon.
 * Failed tools get XCircleIcon with red styling.
 */
export const AssembledToolCallRow = memo(function AssembledToolCallRow({
  tool,
}: {
  tool: AssembledToolCall | AssembledMcpTool;
}) {
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const hasResult = !!tool.resultContent;
  const heading = tool.heading + toolHeadingSuffix(tool.state);
  const headingCls = toolHeadingClass(tool.state);
  const preview = tool.detail ?? null;
  const displayText = preview ? `${heading} - ${preview}` : heading;

  const handleResultClick = hasResult ? () => setResultDialogOpen(true) : undefined;
  const handleResultClose = useCallback((open: boolean) => setResultDialogOpen(open), []);

  const RestIcon = tool.kind === "mcp-tool" ? WrenchIcon : CircleChevronRightIcon;

  return (
    <>
      <div
        className={cn("rounded-lg px-0.25 py-1", hasResult && "group/file cursor-pointer")}
        onClick={handleResultClick}
      >
        <div className="flex items-center gap-1 transition-[opacity,translate] duration-200">
          <ToolRowIcon state={tool.state} restIcon={RestIcon} hook={tool.hook} />
          <div className="min-w-0 flex-1 overflow-hidden">
            <Tooltip>
              <TooltipTrigger className="block min-w-0 w-full text-left" aria-label={displayText}>
                <p
                  className={cn(
                    "truncate text-[11px] leading-5",
                    headingCls,
                    preview ? "text-muted-foreground/80" : "",
                  )}
                >
                  <span className={cn("text-foreground/80", headingCls)}>{heading}</span>
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
