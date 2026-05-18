import { memo, ReactNode, use, useCallback, useEffect, useRef, useState } from "react";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { SkillInlineText } from "~/components/chat/SkillInlineText";
import { SearchMatchDot } from "~/components/chat/messages-timeline/SearchMatchDot";
import {
  SearchQueryCtx,
  hasMatchOutsideVisibleBounds,
} from "~/components/chat/messages-timeline/shared";
import { TerminalContextInlineChip } from "~/components/chat/TerminalContextInlineChip";
import {
  textContainsInlineTerminalContextLabels,
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
} from "~/components/chat/userMessageTerminalContexts";
import { type ParsedTerminalContextEntry } from "~/lib/terminalContext";

// Leaf components
export const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

// Collapsible wrapper for long user messages
/** Collapsed height in px — roughly 10 lines of body text at 14px/relaxed. */
const USER_MSG_COLLAPSED_MAX_HEIGHT = 300;

export const CollapsibleUserMessageContent = memo(function CollapsibleUserMessageContent({
  children,
}: {
  children: ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [hasHiddenMatch, setHasHiddenMatch] = useState(false);
  const measureRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const searchQuery = use(SearchQueryCtx);

  // Measure the inner div (which never has maxHeight) so the natural content
  // height is always reported, regardless of the outer div's collapsed state.
  // This prevents layout thrashing when content is right at the threshold.
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setIsOverflowing(el.scrollHeight > USER_MSG_COLLAPSED_MAX_HEIGHT);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Check for matches in the hidden overflow area using DOM positions.
  useEffect(() => {
    if (!isOverflowing || isExpanded || !searchQuery) {
      setHasHiddenMatch(false);
      return;
    }
    // Small delay to let the DOM settle after renders.
    const timer = setTimeout(() => {
      setHasHiddenMatch(hasMatchOutsideVisibleBounds(clipRef.current, searchQuery));
    }, 50);
    return () => clearTimeout(timer);
  }, [isOverflowing, isExpanded, searchQuery]);

  const handleToggle = useCallback(() => {
    setIsExpanded((v) => !v);
  }, []);

  // Always constrain until explicitly expanded (prevents render-then-collapse bounce).
  const showExpanded = isOverflowing && isExpanded;

  return (
    <div>
      <div
        ref={clipRef}
        className="relative"
        style={
          showExpanded
            ? undefined
            : {
                maxHeight: USER_MSG_COLLAPSED_MAX_HEIGHT,
                overflow: "hidden",
                maskImage: isOverflowing
                  ? "linear-gradient(to bottom, black 88%, rgba(0,0,0,0.4) 94%, transparent 100%)"
                  : undefined,
                WebkitMaskImage: isOverflowing
                  ? "linear-gradient(to bottom, black 88%, rgba(0,0,0,0.4) 94%, transparent 100%)"
                  : undefined,
              }
        }
      >
        <div ref={measureRef}>{children}</div>
      </div>
      {isOverflowing && (
        <button
          type="button"
          className="mb-0.5 mt-0 flex w-full items-center justify-center gap-1.5 text-center text-[9px] uppercase tracking-[0.12em] text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75"
          onClick={handleToggle}
        >
          {hasHiddenMatch && <SearchMatchDot />}
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
});

// Slash command detection for user message styling

interface SlashCommandMatch {
  name: string;
  extraText: string;
}

export function parseSlashCommandText(text: string): SlashCommandMatch | null {
  if (!text.startsWith("/")) return null;
  const match = /^\/([a-z0-9][a-z0-9_-]*)(?:\s([\s\S]*))?$/.exec(text);
  if (!match) return null;
  return { name: match[1]!, extraText: match[2]?.trim() ?? "" };
}

export const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  slashCommandMatch: SlashCommandMatch | null;
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              <SkillInlineText text={props.text.slice(cursor, matchIndex)} skills={props.skills} />
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              <SkillInlineText text={props.text.slice(cursor)} skills={props.skills} />
            </span>,
          );
        }

        return (
          <div className="mb-2 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(
        <span key="user-message-terminal-context-inline-text">
          <SkillInlineText text={props.text} skills={props.skills} />
        </span>,
      );
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="mb-2 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  if (props.slashCommandMatch) {
    const { name, extraText } = props.slashCommandMatch;
    return (
      <div className="mb-2 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
        <span className="mr-px text-primary">/</span>
        <span className="font-semibold">{name}</span>
        {extraText && <span> {extraText}</span>}
      </div>
    );
  }

  return (
    <div className="mb-2 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
      <SkillInlineText text={props.text} skills={props.skills} />
    </div>
  );
});
