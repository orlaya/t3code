import { memo, useCallback, useMemo, useState } from "react";
import { GlobeIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { ToolRowIcon, toolHeadingClass, toolHeadingSuffix } from "./ToolRowIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { Dialog, DialogPanel, DialogPopup } from "../../ui/dialog";
import { HighlightedTerminalOutput } from "../TerminalHighlight";
import { MessageCopyButton } from "../MessageCopyButton";
import type { AssembledWebSearch } from "@t3tools/contracts";

// ---------------------------------------------------------------------------
// Web search result parsing
// ---------------------------------------------------------------------------

interface ParsedWebSearchLink {
  title: string;
  url: string;
}

interface ParsedWebSearchResult {
  /** Summary body text (links JSON and REMINDER stripped). */
  body: string;
  /** Extracted links from the JSON blob. */
  links: ParsedWebSearchLink[];
}

function parseWebSearchResult(raw: string): ParsedWebSearchResult {
  const links: ParsedWebSearchLink[] = [];
  let body = raw;

  // Strip the "Web search results for query: ..." header line
  body = body.replace(/^Web search results for query:\s*"[^"]*"\s*\n*/i, "");

  // Extract and remove the Links: [...] JSON blob
  const linksMatch = body.match(/^Links:\s*(\[[\s\S]*?\])\s*\n*/m);
  if (linksMatch) {
    body = body.slice(0, linksMatch.index!) + body.slice(linksMatch.index! + linksMatch[0].length);
    try {
      const parsed: unknown = JSON.parse(linksMatch[1]!);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item === "object" &&
            typeof (item as Record<string, unknown>).title === "string" &&
            typeof (item as Record<string, unknown>).url === "string"
          ) {
            links.push({
              title: (item as Record<string, unknown>).title as string,
              url: (item as Record<string, unknown>).url as string,
            });
          }
        }
      }
    } catch {
      // JSON parse failed — leave links empty, body keeps the raw text
    }
  }

  // Strip the trailing REMINDER line
  body = body.replace(/\n*REMINDER:[\s\S]*$/m, "");

  return { body: body.trim(), links };
}

// ---------------------------------------------------------------------------
// Web search result dialog
// ---------------------------------------------------------------------------

const WebSearchResultDialog = memo(function WebSearchResultDialog({
  open,
  onOpenChange,
  query,
  resultContent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string | undefined;
  resultContent: string;
}) {
  const parsed = useMemo(() => parseWebSearchResult(resultContent), [resultContent]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-2xl max-h-[75vh] focus:outline-none [&_[data-slot=scroll-area-scrollbar]]:me-0"
        showCloseButton
      >
        <DialogPanel className="pt-6 pr-6 pb-6">
          {/* Heading */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3.5 py-2">
            <GlobeIcon className="size-3.5 shrink-0 text-primary/70" />
            <div className="min-w-0 text-[13px] leading-5 text-foreground/85">
              <span className="font-semibold">Search</span>
            </div>
          </div>

          {/* Query */}
          {query && (
            <div className="mt-3 rounded-lg border border-border/45 bg-card/25 px-3 py-2">
              <p className="pb-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                Query
              </p>
              <p className="font-mono text-[11px] leading-relaxed text-foreground/70">{query}</p>
            </div>
          )}

          {/* Summary output */}
          {parsed.body.length > 0 && (
            <div className="relative mt-3 rounded-lg border border-border/45 bg-card/25 pt-2">
              <MessageCopyButton
                text={resultContent}
                size="icon-xs"
                variant="ghost"
                className="absolute top-1.5 right-1.5 z-10 text-muted-foreground/55"
              />
              <p className="px-3 pb-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                Output
              </p>
              <div className="max-h-[35vh] overflow-y-auto pb-2">
                <div className="px-3">
                  <HighlightedTerminalOutput content={parsed.body} />
                </div>
              </div>
            </div>
          )}

          {/* Links */}
          {parsed.links.length > 0 && (
            <div className="mt-3 rounded-lg border border-border/45 bg-card/25 px-3 pt-2 pb-2">
              <p className="pb-1.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                Sources ({parsed.links.length})
              </p>
              <ul className="space-y-1">
                {parsed.links.map((link) => (
                  <li key={link.url} className="min-w-0">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/link flex min-w-0 items-baseline gap-1.5 text-[11px] leading-5"
                    >
                      <GlobeIcon className="mt-1.5 size-2.5 shrink-0 text-muted-foreground/50" />
                      <span className="min-w-0">
                        <span className="text-foreground/75 group-hover/link:underline">
                          {link.title}
                        </span>
                        <span className="ml-1.5 text-muted-foreground/50 truncate">
                          {new URL(link.url).hostname}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
});

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

export const AssembledWebSearchRow = memo(function AssembledWebSearchRow({
  tool,
}: {
  tool: AssembledWebSearch;
}) {
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const hasResult = !!tool.resultContent;
  const heading = tool.heading + toolHeadingSuffix(tool.state);
  const headingCls = toolHeadingClass(tool.state);
  const preview = tool.query ?? null;
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
          <ToolRowIcon state={tool.state} restIcon={GlobeIcon} />
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
        <WebSearchResultDialog
          open={resultDialogOpen}
          onOpenChange={handleResultClose}
          query={tool.query}
          resultContent={tool.resultContent!}
        />
      )}
    </>
  );
});
