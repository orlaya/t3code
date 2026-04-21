import { memo, useCallback, useEffect, useRef } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Contract — each search context implements this to wire its own logic.
// ---------------------------------------------------------------------------

export interface SearchHandler {
  /** Run a search query. Returns total match count. */
  search(query: string): number;
  /** Navigate to the next match. Returns the new current index (0-based). */
  next(): number;
  /** Navigate to the previous match. Returns the new current index (0-based). */
  prev(): number;
  /** Clear all highlights and reset state. */
  clear(): void;
}

// ---------------------------------------------------------------------------
// SearchOverlay — floating Chrome-style search bar.
// ---------------------------------------------------------------------------

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  matchCount: number;
  currentMatch: number;
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  /** Extra classes to override default positioning (top-2 right-3). */
  className?: string;
}

export const SearchOverlay = memo(function SearchOverlay({
  open,
  onClose,
  matchCount,
  currentMatch,
  onSearch,
  onNext,
  onPrev,
  className: positionClassName,
}: SearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef("");

  // Focus input when opened.
  useEffect(() => {
    if (open) {
      // Small delay so the element is in the DOM and visible.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      queryRef.current = e.target.value;
      onSearch(e.target.value);
    },
    [onSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          onPrev();
        } else {
          onNext();
        }
      }
    },
    [onClose, onNext, onPrev],
  );

  if (!open) return null;

  const hasQuery = queryRef.current.length > 0;
  const matchLabel = hasQuery
    ? matchCount > 0
      ? `${currentMatch + 1} of ${matchCount}`
      : "NA"
    : "";

  return (
    <div
      className={cn(
        "absolute top-2 right-3 z-40 flex w-72 items-center gap-0 rounded-lg border border-border bg-popover px-2 py-1 shadow-lg/5 animate-in fade-in slide-in-from-top-1 duration-150",
        positionClassName,
      )}
      data-slot="search-overlay"
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="Search…"
        className="pl-0.75 h-6 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        defaultValue={queryRef.current}
      />
      <span className="pr-1 shrink-0 whitespace-nowrap text-right text-[11px] text-muted-foreground/70 tabular-nums">
        {matchLabel}
      </span>
      <button
        type="button"
        tabIndex={-1}
        className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-40"
        onClick={onPrev}
        disabled={matchCount === 0}
        title="Previous match (Shift+Enter)"
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground disabled:opacity-40"
        onClick={onNext}
        disabled={matchCount === 0}
        title="Next match (Enter)"
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
        onClick={onClose}
        title="Close (Escape)"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
});
