import {
  memo,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  LoaderIcon,
} from "lucide-react";
import type { AssembledSubAgent } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { Dialog, DialogPanel, DialogPopup } from "../../ui/dialog";
import ChatMarkdown from "../../ChatMarkdown";
import { MAX_VISIBLE_WORK_LOG_ENTRIES } from "../MessagesTimeline.logic";
import { SimpleWorkEntryRow } from "./SimpleWorkEntryRow";
import { TimelineRowCtx, WorkLogEntriesCtx } from "./shared";

// ---------------------------------------------------------------------------
// Pinned sub-agent entry — always shown at the top of the work group
// ---------------------------------------------------------------------------

export const AssembledPinnedSubAgentEntry = memo(function AssembledPinnedSubAgentEntry({
  tool,
  onOpen,
}: {
  tool: AssembledSubAgent;
  onOpen: () => void;
}) {
  const inProgress = tool.state === "starting" || tool.state === "in-progress";
  const hasBrief = tool.brief.prompt.length > 0;

  // Heading: "Sub-agent", preview: "Explore: description"
  const heading = "Sub-agent";
  const preview =
    tool.brief.description.length > 0
      ? tool.brief.agentType
        ? `${tool.brief.agentType}: ${tool.brief.description}`
        : tool.brief.description
      : null;

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left",
        inProgress ? "bg-primary/5" : "bg-muted/40",
        hasBrief && "cursor-pointer hover:bg-muted/60",
      )}
      onClick={() => {
        if (hasBrief) onOpen();
      }}
    >
      {inProgress ? (
        <LoaderIcon className="size-3 shrink-0 animate-spin [animation-duration:4s] text-primary/70" />
      ) : (
        <CheckIcon className="size-3 shrink-0 text-primary/70" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-[11px] leading-5",
            inProgress ? "text-foreground/90" : "font-medium text-foreground/80",
          )}
        >
          {heading}
          {preview && <span className="text-muted-foreground/70"> — {preview}</span>}
        </p>
      </div>
    </button>
  );
});

// ---------------------------------------------------------------------------
// Sub-agent detail dialog
// ---------------------------------------------------------------------------

export const AssembledSubAgentDetailDialog = memo(function AssembledSubAgentDetailDialog({
  open,
  onOpenChange,
  tool,
  siblingSubAgents,
  siblingIndex,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: AssembledSubAgent;
  /** All sub-agent entries in this work group (for left/right navigation). */
  siblingSubAgents: ReadonlyArray<AssembledSubAgent>;
  /** Index of the currently displayed sub-agent within siblingSubAgents. */
  siblingIndex: number;
  /** Callback to navigate to a different sub-agent by index. */
  onNavigate: (index: number) => void;
}) {
  const { workspaceRoot, markdownCwd } = use(TimelineRowCtx);
  const allWorkLogEntries = use(WorkLogEntriesCtx);
  const brief = tool.brief;
  const inProgress = tool.state === "starting" || tool.state === "in-progress";

  const heading = "Sub-agent";
  const preview =
    brief.description.length > 0
      ? brief.agentType
        ? `${brief.agentType}: ${brief.description}`
        : brief.description
      : null;

  const [briefExpanded, setBriefExpanded] = useState(false);
  const [workLogExpanded, setWorkLogExpanded] = useState(false);

  // Detect when the combined heading + preview overflows a single line.
  const headingMeasureRef = useRef<HTMLSpanElement>(null);
  const headingContainerRef = useRef<HTMLDivElement>(null);
  const [headingOverflows, setHeadingOverflows] = useState(false);

  useLayoutEffect(() => {
    const measure = headingMeasureRef.current;
    const container = headingContainerRef.current;
    if (!measure || !container) return;
    setHeadingOverflows(measure.scrollWidth > container.clientWidth);
  }, [heading, preview, open]);

  // Left/right navigation across sibling sub-agents (loops around).
  const hasSiblings = siblingSubAgents.length > 1;

  const navigateSubAgent = useCallback(
    (direction: -1 | 1) => {
      if (!hasSiblings) return;
      const next = (siblingIndex + direction + siblingSubAgents.length) % siblingSubAgents.length;
      setBriefExpanded(false);
      setWorkLogExpanded(false);
      onNavigate(next);
    },
    [siblingIndex, siblingSubAgents.length, onNavigate, hasSiblings],
  );

  // Capture-phase listener so arrow keys navigate sub-agents before the
  // dialog's internal focus management can intercept them.
  useEffect(() => {
    if (!open || !hasSiblings) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        navigateSubAgent(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        navigateSubAgent(1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, hasSiblings, navigateSubAgent]);

  // Filter work log entries belonging to this sub-agent's task.
  const taskEntries = useMemo(() => {
    if (!tool.taskId) return [];
    return allWorkLogEntries.filter(
      (e) => e.taskId === tool.taskId && e.itemType !== "collab_agent_tool_call",
    );
  }, [allWorkLogEntries, tool.taskId]);

  const workLogHasOverflow = taskEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
  const visibleTaskEntries =
    workLogHasOverflow && !workLogExpanded
      ? taskEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
      : taskEntries;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-lg max-h-[75vh] focus:outline-none [&_[data-slot=scroll-area-scrollbar]]:me-0"
        showCloseButton
      >
        {/* Left/right navigation chevrons — only when multiple sub-agents in group */}
        {hasSiblings && (
          <button
            type="button"
            tabIndex={-1}
            className="absolute -left-11 top-1/2 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-popover/80 text-foreground/60 shadow-md backdrop-blur-sm transition-colors hover:bg-popover hover:text-foreground focus:outline-none"
            aria-label="Previous sub-agent"
            onClick={() => navigateSubAgent(-1)}
          >
            <ChevronLeftIcon className="size-4" />
          </button>
        )}
        {hasSiblings && (
          <button
            type="button"
            tabIndex={-1}
            className="absolute -right-11 top-1/2 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-popover/80 text-foreground/60 shadow-md backdrop-blur-sm transition-colors hover:bg-popover hover:text-foreground focus:outline-none"
            aria-label="Next sub-agent"
            onClick={() => navigateSubAgent(1)}
          >
            <ChevronRightIcon className="size-4" />
          </button>
        )}
        <DialogPanel className="pt-8 pr-8 pb-8">
          {/* Sub-agent heading — mirrors the pinned entry row */}
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg px-3.5 py-2",
              inProgress ? "border border-border/45 bg-primary/5" : "bg-muted/40",
            )}
          >
            {inProgress ? (
              <LoaderIcon className="size-3.5 mt-[3px] shrink-0 animate-spin [animation-duration:4s] text-primary/70" />
            ) : (
              <CheckIcon className="size-3.5 mt-[3px] shrink-0 text-primary/70" />
            )}
            <div
              ref={headingContainerRef}
              className="min-w-0 text-[13px] leading-5 text-foreground/85"
            >
              {/* Hidden measurement span — single-line, no wrapping */}
              {preview && (
                <span
                  ref={headingMeasureRef}
                  className="pointer-events-none invisible absolute whitespace-nowrap text-[13px]"
                  aria-hidden="true"
                >
                  {heading} — {preview}
                </span>
              )}
              {preview && headingOverflows ? (
                <>
                  <p className="font-semibold">{heading}</p>
                  <p className="text-foreground/55">{preview}</p>
                </>
              ) : (
                <p>
                  <span className="font-semibold">{heading}</span>
                  {preview && <span className="text-foreground/55"> — {preview}</span>}
                </p>
              )}
            </div>
          </div>

          {/* Brief prompt text — collapsible, closed by default */}
          <div
            className="group/brief mt-4 cursor-pointer rounded-lg border border-border/45 bg-card/25 px-2 py-1.5"
            onClick={() => setBriefExpanded((v) => !v)}
          >
            <div className="flex items-center justify-between gap-2 px-0.5">
              <p className="pb-1 pt-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                Brief
              </p>
              <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/brief:text-foreground">
                {briefExpanded ? (
                  <ChevronUpIcon className="size-3.5" />
                ) : (
                  <ChevronDownIcon className="size-3.5" />
                )}
              </span>
            </div>
            <div
              className={cn(
                "relative text-[12.5px] italic leading-relaxed text-foreground/50 whitespace-pre-wrap",
                !briefExpanded && "max-h-[12.5em] overflow-hidden",
              )}
            >
              {brief.prompt}
              {!briefExpanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card/80 to-transparent" />
              )}
            </div>
          </div>

          {/* Sub-agent work log — collapsible, closed by default */}
          {taskEntries.length > 0 && (
            <div className="mt-4 rounded-lg border border-border/45 bg-card/25 px-2 py-1.5">
              <div
                className="group/wl flex cursor-pointer items-center justify-between gap-2 px-0.5"
                onClick={() => setWorkLogExpanded((v) => !v)}
              >
                <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                  Work log ({taskEntries.length})
                </p>
                <span className="text-muted-foreground/70 transition-colors duration-150 group-hover/wl:text-foreground">
                  {workLogExpanded ? (
                    <ChevronUpIcon className="size-3.5" />
                  ) : (
                    <ChevronDownIcon className="size-3.5" />
                  )}
                </span>
              </div>
              <div className="space-y-0 [&>*]:py-0.25">
                {visibleTaskEntries.map((entry) => (
                  <SimpleWorkEntryRow
                    key={`subagent-work:${entry.id}`}
                    workEntry={entry}
                    workspaceRoot={workspaceRoot}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Response — divider styled like the main chat completion divider */}
          {tool.resultContent != null && (
            <>
              <div className="my-3 mt-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="px-1 pt-2 text-[12.5px] leading-snug">
                <ChatMarkdown text={tool.resultContent} cwd={markdownCwd} />
              </div>
            </>
          )}
        </DialogPanel>
        {/* Navigation counter — positioned outside the dialog card */}
        {hasSiblings && (
          <p className="absolute -bottom-9 left-1/2 -translate-x-1/2 rounded-full bg-popover/80 px-3 py-1 text-[11px] text-foreground/60 shadow-md backdrop-blur-sm">
            {siblingIndex + 1} / {siblingSubAgents.length}
          </p>
        )}
      </DialogPopup>
    </Dialog>
  );
});
