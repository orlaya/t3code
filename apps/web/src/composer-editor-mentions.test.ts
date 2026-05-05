import { describe, expect, it } from "vitest";

import {
  resolveMentionsToAbsolutePaths,
  selectionTouchesMentionBoundary,
  splitPromptIntoComposerSegments,
} from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

describe("splitPromptIntoComposerSegments", () => {
  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing mention token", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md")).toEqual([
      { type: "text", text: "Inspect @AGENTS.md" },
    ]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@src/index.ts \ntwo")).toEqual([
      { type: "text", text: "one\n" },
      { type: "mention", path: "src/index.ts" },
      { type: "text", text: " \ntwo" },
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
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
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

  it("keeps skill parsing alongside mentions and terminal placeholders", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}$review-follow-up after @AGENTS.md `,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "skill", name: "review-follow-up" },
      { type: "text", text: " after " },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " " },
    ]);
  });
});

describe("selectionTouchesMentionBoundary", () => {
  it("returns true when selection includes the whitespace after a mention", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi @package.json there",
        "hi @package.json".length,
        "hi @package.json there".length,
      ),
    ).toBe(true);
  });

  it("returns true when selection includes the whitespace before a mention", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi there @package.json later",
        "hi there".length,
        "hi there ".length,
      ),
    ).toBe(true);
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

  it("returns true when selection includes whitespace after a mention following a terminal placeholder", () => {
    const prompt = `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md there`;
    expect(
      selectionTouchesMentionBoundary(
        prompt,
        `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md`.length,
        prompt.length,
      ),
    ).toBe(true);
  });
});

describe("resolveMentionsToAbsolutePaths", () => {
  it("replaces @mention with absolute path, stripping the @", () => {
    expect(
      resolveMentionsToAbsolutePaths("look at @src/index.ts please", "/Users/me/project"),
    ).toBe("look at /Users/me/project/src/index.ts please");
  });

  it("handles multiple mentions", () => {
    expect(resolveMentionsToAbsolutePaths("@foo.ts and @bar/baz.ts done", "/cwd")).toBe(
      "/cwd/foo.ts and /cwd/bar/baz.ts done",
    );
  });

  it("handles cwd with trailing slash", () => {
    expect(resolveMentionsToAbsolutePaths("see @README.md end", "/cwd/")).toBe(
      "see /cwd/README.md end",
    );
  });

  it("does not touch incomplete trailing mention (no trailing whitespace)", () => {
    expect(resolveMentionsToAbsolutePaths("see @README.md", "/cwd")).toBe("see @README.md");
  });

  it("leaves text without mentions unchanged", () => {
    expect(resolveMentionsToAbsolutePaths("just some text", "/cwd")).toBe("just some text");
  });
});
