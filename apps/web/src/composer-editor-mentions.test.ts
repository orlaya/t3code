import { describe, expect, it } from "vitest";

import {
  selectionTouchesMentionBoundary,
  splitPromptIntoComposerSegments,
} from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

describe("splitPromptIntoComposerSegments", () => {
  it("keeps typed at-symbol file-looking text as plain text", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect @AGENTS.md please" },
    ]);
  });

  it("keeps typed npm scope paths as plain text", () => {
    expect(splitPromptIntoComposerSegments("Use @orlaya/gist/cue here")).toEqual([
      { type: "text", text: "Use @orlaya/gist/cue here" },
    ]);
  });

  it("keeps newlines around typed at-symbol text", () => {
    expect(splitPromptIntoComposerSegments("one\n@src/index.ts \ntwo")).toEqual([
      { type: "text", text: "one\n@src/index.ts \ntwo" },
    ]);
  });

  it("splits skill tokens followed by whitespace into skill segments", () => {
    expect(splitPromptIntoComposerSegments("Use $review-follow-up please")).toEqual([
      { type: "text", text: "Use " },
      { type: "skill", name: "review-follow-up" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing skill token", () => {
    expect(splitPromptIntoComposerSegments("Use $review-follow-up")).toEqual([
      { type: "text", text: "Use $review-follow-up" },
    ]);
  });

  it("keeps inline terminal context placeholders at their prompt positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md please`,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "text", text: "@AGENTS.md please" },
    ]);
  });

  it("preserves consecutive terminal context placeholders without dropping positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}tail`,
      ),
    ).toEqual([
      { type: "terminal-context", context: null },
      { type: "terminal-context", context: null },
      { type: "text", text: "tail" },
    ]);
  });

  it("keeps skill parsing alongside typed at-symbol text and terminal placeholders", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}$review-follow-up after @AGENTS.md `,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "skill", name: "review-follow-up" },
      { type: "text", text: " after @AGENTS.md " },
    ]);
  });
});

describe("selectionTouchesMentionBoundary", () => {
  it("returns false for typed at-symbol text", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi @package.json there",
        "hi @package.json".length,
        "hi @package.json there".length,
      ),
    ).toBe(false);
  });

  it("returns false when selection includes whitespace before typed at-symbol text", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi there @package.json later",
        "hi there".length,
        "hi there ".length,
      ),
    ).toBe(false);
  });

  it("returns false when selection starts after the mention boundary whitespace", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi @package.json there",
        "hi @package.json ".length,
        "hi @package.json there".length,
      ),
    ).toBe(false);
  });

  it("returns false for typed at-symbol text following a terminal placeholder", () => {
    const prompt = `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md there`;
    expect(
      selectionTouchesMentionBoundary(
        prompt,
        `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md`.length,
        prompt.length,
      ),
    ).toBe(false);
  });
});
