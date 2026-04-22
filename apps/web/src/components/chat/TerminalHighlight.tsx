import { memo, useMemo, type CSSProperties } from "react";
import { TerminalIcon } from "lucide-react";
import { Dialog, DialogPanel, DialogPopup } from "../ui/dialog";
import { MessageCopyButton } from "./MessageCopyButton";

/**
 * Lightweight terminal-output syntax highlighter.
 *
 * Inspired by sugar-high's architecture: tokenise text into typed segments,
 * then let the renderer map token types to themed CSS custom properties.
 *
 * Unlike sugar-high (character-by-character for programming languages) this
 * operates line-by-line with pattern matching — terminal stdout is
 * unstructured text, not a grammar.
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type TermTokenType =
  | "plain"
  | "command" // Lines starting with `$` — the shell command being executed
  | "meta" // Turbo bullet lines (`• …`), preamble
  | "package-prefix" // `@scope/pkg:task:` prefix on scoped output lines
  | "label" // Left-hand side of `Key:   value` summary lines
  | "bracket-label" // `[something]` inline labels common in log output
  | "filepath" // File paths like `src/foo/Bar.ts`
  | "error" // Substrings matching error patterns
  | "warning" // Substrings matching warning patterns
  | "success" // Substrings matching success patterns
  | "dim"; // De-emphasised noise (cache bypass hashes, etc.)

// ---------------------------------------------------------------------------
// A single token: [type, text]
// ---------------------------------------------------------------------------

export type TermToken = [type: TermTokenType, text: string];

// ---------------------------------------------------------------------------
// CSS custom property mapping — consumed by the renderer.
//
// Uses the existing theme variables so colours follow light/dark mode
// automatically.  The renderer applies these as inline `style` on <span>s.
// ---------------------------------------------------------------------------

export const termTokenStyles: Record<TermTokenType, CSSProperties> = {
  plain: { color: "var(--foreground)", opacity: 0.75 },
  command: { color: "var(--foreground)", fontWeight: 600 },
  meta: { color: "var(--muted-foreground)", opacity: 0.7 },
  "package-prefix": { color: "var(--muted-foreground)", opacity: 0.55 },
  label: { color: "var(--muted-foreground)", opacity: 0.55 },
  "bracket-label": { color: "var(--muted-foreground)", opacity: 0.6 },
  filepath: { color: "var(--info)", opacity: 0.8 },
  error: { color: "var(--destructive)" },
  warning: { color: "var(--warning)" },
  success: { color: "var(--success)" },
  dim: { color: "var(--muted-foreground)", opacity: 0.4 },
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Package-scoped prefix: any `key:task: ` pattern, e.g. `@t3tools/web:typecheck: ` or `t3:typecheck: ` */
const PACKAGE_PREFIX_RE = /^(\s*[^\s:]+:[^\s:]+:\s*)(.*)/;

/** Summary key-value: `  Tasks:    9 successful` (label followed by 2+ spaces) */
const SUMMARY_KV_RE = /^(\s*\w[\w ]*?:\s{2,})(.*)/;

/** Turbo bullet meta line */
const BULLET_META_RE = /^\s*[•·]\s/;

/** Shell command line */
const COMMAND_RE = /^\s*\$\s/;

/** Cache bypass hash noise — e.g. `cache bypass, force executing 9ce1252c7c91f9ba` */
const CACHE_BYPASS_RE = /(cache bypass, force executing \w+)/i;

// Keyword patterns (case-insensitive).  We split the line around these so the
// keyword itself gets coloured while the rest of the line keeps its base style.
// Single source of truth — classifyInlineMatch also uses these.
const ERROR_WORDS = "error|errors|failed|failure|fatal|bugger";
const WARNING_WORDS = "warning|warnings|warn|hmm";
const SUCCESS_WORDS = "successful|success|ok|passed|0 errors|0 warnings|0 failures";

// Bracket labels: `[types]`, `[check]`, `[build]`, etc.
const BRACKET_LABEL = "\\[[^\\]]+\\]";

// File paths: must contain `/` and end with a file extension.
// Captures things like `src/foo/Bar.ts`, `/Users/sh/t3code/apps/web/src/index.css`
const FILEPATH = "(?:[\\w@.\\-]+/)+[\\w.\\-]+\\.\\w+";

// Combined inline pattern — one pass to find all interesting substrings.
// Order matters: file paths before keywords (so `src/errors/Fatal.ts` matches
// as a path, not as the word "error" inside it).
const INLINE_RE = new RegExp(
  `(${BRACKET_LABEL})|(${FILEPATH})|\\b(${ERROR_WORDS})\\b|\\b(${WARNING_WORDS})\\b|(\\b(?:\\d+\\s+)?(?:${SUCCESS_WORDS})\\b|✓)`,
  "gi",
);

//
//
//

/**
 * Tokenise a block of terminal output into typed segments.
 *
 * Returns an array of lines, where each line is an array of `[type, text]`
 * token pairs.  The renderer can iterate these to produce <span> elements.
 */
export function tokenizeTerminalOutput(text: string): TermToken[][] {
  const lines = text.split("\n");
  return lines.map(tokenizeLine);
}

function tokenizeLine(line: string): TermToken[] {
  // Empty / whitespace-only lines
  if (line.trim() === "") return [["plain", line]];

  // Shell command: `$ bun run typecheck`
  if (COMMAND_RE.test(line)) return [["command", line]];

  // Bullet meta: `• Packages in scope: …`
  if (BULLET_META_RE.test(line)) return [["meta", line]];

  // Package-scoped line: `@t3tools/marketing:typecheck: Result (6 files):`
  const pkgMatch = line.match(PACKAGE_PREFIX_RE);
  if (pkgMatch) {
    const prefix = pkgMatch[1]!;
    const rest = pkgMatch[2]!;
    // Value starting with `$` is a command (e.g. `t3:typecheck: $ tsc --noEmit`)
    if (COMMAND_RE.test(rest)) {
      return [
        ["package-prefix", prefix],
        ["command", rest],
      ];
    }
    return [["package-prefix", prefix], ...highlightInline(rest, "plain")];
  }

  // Summary key-value: `Tasks:    9 successful, 9 total`
  const kvMatch = line.match(SUMMARY_KV_RE);
  if (kvMatch) {
    const label = kvMatch[1]!;
    const value = kvMatch[2]!;
    return [["label", label], ...highlightInline(value, "plain")];
  }

  // Cache bypass noise line
  if (CACHE_BYPASS_RE.test(line)) return [["dim", line]];

  // Default: scan for keywords
  return highlightInline(line, "plain");
}

//
//
//

/**
 * Scan `text` for bracket labels, file paths, and error/warning/success
 * keywords in a single pass.  Non-matching parts get `baseType`.
 */
function highlightInline(text: string, baseType: TermTokenType): TermToken[] {
  // Reset lastIndex — the regex is global and reused across calls.
  INLINE_RE.lastIndex = 0;

  const tokens: TermToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Capture groups from INLINE_RE:
  //   1 = bracket label, 2 = filepath,
  //   3 = error word, 4 = warning word, 5 = success word
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push([baseType, text.slice(lastIndex, match.index)]);
    }

    const type: TermTokenType = match[1]
      ? "bracket-label"
      : match[2]
        ? "filepath"
        : match[3]
          ? "error"
          : match[4]
            ? "warning"
            : "success";
    tokens.push([type, match[0]!]);

    lastIndex = INLINE_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push([baseType, text.slice(lastIndex)]);
  }

  if (tokens.length === 0) {
    tokens.push([baseType, text]);
  }

  return tokens;
}

//
//
//

/** Renders terminal output with lightweight syntax highlighting. */
export const HighlightedTerminalOutput = memo(function HighlightedTerminalOutput({
  content,
}: {
  content: string;
}) {
  const lines = useMemo(() => tokenizeTerminalOutput(content), [content]);
  return (
    <pre className="font-mono text-[11px] whitespace-pre-wrap wrap-break-word">
      {lines.map((tokens, lineIdx) => {
        const isBlank = tokens.length === 1 && tokens[0]![1].trim() === "";
        const leadType = tokens[0]?.[0];
        const prevLeadType = lineIdx > 0 ? lines[lineIdx - 1]?.[0]?.[0] : undefined;
        // Extra breathing room: blank lines, or when the leading token type
        // changes (e.g. package-prefix → plain, or command → package-prefix).
        const isGroupBreak = lineIdx > 0 && (isBlank || leadType !== prevLeadType);
        return (
          <div
            // eslint-disable-next-line react/no-array-index-key
            key={lineIdx}
            style={{
              lineHeight: "1.6",
              marginTop: isGroupBreak ? 6 : 0,
            }}
          >
            {tokens.map(([type, text], tokenIdx) => (
              // eslint-disable-next-line react/no-array-index-key
              <span key={tokenIdx} style={termTokenStyles[type]}>
                {text}
              </span>
            ))}
          </div>
        );
      })}
    </pre>
  );
});

/** Dialog showing the full tool result output (bash stdout, grep results, etc.). */
export const ToolResultDialog = memo(function ToolResultDialog({
  open,
  onOpenChange,
  heading,
  command,
  resultContent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heading: string;
  command?: string | undefined;
  resultContent: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="max-w-2xl max-h-[75vh] focus:outline-none [&_[data-slot=scroll-area-scrollbar]]:me-0"
        showCloseButton
      >
        <DialogPanel className="pt-6 pr-6 pb-6">
          {/* Heading */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3.5 py-2">
            <TerminalIcon className="size-3.5 shrink-0 text-primary/70" />
            <div className="min-w-0 text-[13px] leading-5 text-foreground/85">
              <span className="font-semibold">{heading}</span>
            </div>
          </div>

          {/* Command */}
          {command && (
            <div className="mt-3 rounded-lg border border-border/45 bg-card/25 px-3 py-2">
              <p className="pb-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
                Command
              </p>
              <p className="font-mono text-[11px] leading-relaxed text-foreground/70 whitespace-pre-wrap wrap-break-word">
                {command}
              </p>
            </div>
          )}

          {/* Output */}
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
            <div className="max-h-[50vh] overflow-y-auto pb-2">
              <div className="px-3">
                <HighlightedTerminalOutput content={resultContent} />
              </div>
            </div>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
});
