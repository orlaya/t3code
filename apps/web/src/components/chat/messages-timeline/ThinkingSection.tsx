import { memo, use, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../../ChatMarkdown";
import type { MessagesTimelineRow } from "../MessagesTimeline.logic";
import { TimelineRowCtx, SearchQueryCtx, hasMatchOutsideVisibleBounds } from "./shared";
import { SearchMatchDot } from "./SearchMatchDot";

const THINKING_EXPAND_CHAR_THRESHOLD = 300;

export const ThinkingSection = memo(function ThinkingSection({
  message,
}: {
  message: Extract<MessagesTimelineRow, { kind: "thinking" }>["message"];
}) {
  const { markdownCwd } = use(TimelineRowCtx);
  const searchQuery = use(SearchQueryCtx);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasHiddenMatch, setHasHiddenMatch] = useState(false);
  const collapsedScrollRef = useRef<HTMLDivElement | null>(null);
  const isSubAgent = message.agentKind === "sub";

  useEffect(() => {
    if (isExpanded || !collapsedScrollRef.current) return;
    collapsedScrollRef.current.scrollTop = collapsedScrollRef.current.scrollHeight;
  }, [message.text, isExpanded]);

  const canExpand = !isSubAgent && message.text.length > THINKING_EXPAND_CHAR_THRESHOLD;

  // Check for matches in the hidden overflow area using DOM positions.
  useEffect(() => {
    if (!canExpand || isExpanded || !searchQuery) {
      setHasHiddenMatch(false);
      return;
    }
    const timer = setTimeout(() => {
      setHasHiddenMatch(hasMatchOutsideVisibleBounds(collapsedScrollRef.current, searchQuery));
    }, 50);
    return () => clearTimeout(timer);
  }, [canExpand, isExpanded, searchQuery]);

  if (isSubAgent) {
    const preview =
      message.text
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-[11px] italic text-muted-foreground/80">
        <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/80">
          Sub-agent thinking
        </span>
        {preview && <span className="min-w-0 flex-1 truncate">{preview}</span>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border/45 bg-card/25 px-2 py-1.5",
        canExpand && "group/think cursor-pointer",
      )}
      onClick={canExpand ? () => setIsExpanded((v) => !v) : undefined}
    >
      <div className="mb-0.5 flex items-center justify-between gap-2 px-0.5">
        {/*0.2em over 0.16 to make up for the THINKING skinnery characters so it looks the same as the others */}
        <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/55">Thinking</p>
        {canExpand && (
          <span className="flex items-center gap-1 text-muted-foreground/70 transition-colors duration-150 group-hover/think:text-foreground">
            {hasHiddenMatch && <SearchMatchDot />}
            {isExpanded ? (
              <ChevronUpIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </span>
        )}
      </div>
      <div className="relative">
        <div
          ref={collapsedScrollRef}
          className={cn(
            "px-1.5 text-[12.5px] italic leading-snug text-muted-foreground/80",
            canExpand && !isExpanded && "thinking-collapsed-scroll max-h-28 overflow-y-auto",
          )}
        >
          <ChatMarkdown
            text={message.text}
            cwd={markdownCwd}
            isStreaming={Boolean(message.streaming)}
            className="pt-0.5 chat-markdown-thinking text-[12.5px] leading-snug text-muted-foreground/80"
          />
        </div>
        {canExpand && !isExpanded && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-card/80 to-transparent" />
        )}
      </div>
    </div>
  );
});
