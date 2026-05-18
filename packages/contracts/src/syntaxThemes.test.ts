import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { DEFAULT_DIFF_THEME, mergePartialDiffTheme, PartialDiffTheme } from "./syntaxThemes.ts";

/** Mimics the server's lenient JSONC parse (strip comments + trailing commas). */
function parseLenientJson(input: string): unknown {
  let stripped = input.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (match, s: string | undefined) =>
    s ? match : "",
  );
  stripped = stripped.replace(
    /("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g,
    (match, s: string | undefined) => (s ? match : ""),
  );
  stripped = stripped.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

const decodePartialDiffTheme = Schema.decodeUnknownExit(PartialDiffTheme);

const decodePartial = (jsonc: string) => {
  const parsed = parseLenientJson(jsonc);
  return decodePartialDiffTheme(parsed);
};

const USER_FILE = `{
  "dark": {
    "bg": "#2e2e2e",
    "addition": "#3F4538",
    "additionNumber": "#3F4538",
    "additionEmphasis": "#333B2C",
    "additionColor": "#cae28f",
    "additionNumberFg": "#cae28f",
    "deletion": "#423834",
    "deletionNumber": "#423834",
    "deletionEmphasis": "#362C28",
    // a comment
    "modifiedColor": "#f3a86c",
    "numberFg": "#f5f3f1",
  },
}`;

describe("PartialDiffTheme decode", () => {
  it("decodes the user JSONC file with new optional tokens", () => {
    const result = decodePartial(USER_FILE);
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;

    const partial = result.value;
    expect(partial.dark).toBeDefined();
    expect(partial.dark?.bg).toBe("#2e2e2e");
    expect(partial.dark?.additionColor).toBe("#cae28f");
    expect(partial.dark?.modifiedColor).toBe("#f3a86c");
    expect(partial.dark?.numberFg).toBe("#f5f3f1");
    expect(partial.dark?.additionNumberFg).toBe("#cae28f");
  });

  it("decodes a minimal file with only one new token", () => {
    const result = decodePartial(`{ "dark": { "modifiedColor": "#ff0000" } }`);
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    expect(result.value.dark?.modifiedColor).toBe("#ff0000");
    expect(result.value.light).toBeUndefined();
  });

  it("decodes an empty object", () => {
    const result = decodePartial(`{}`);
    expect(result._tag).toBe("Success");
  });
});

describe("mergePartialDiffTheme", () => {
  it("preserves new optional tokens from user file after merge", () => {
    const result = decodePartial(USER_FILE);
    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;

    const merged = mergePartialDiffTheme(result.value);

    // New tokens from user file
    expect(merged.dark.additionColor).toBe("#cae28f");
    expect(merged.dark.modifiedColor).toBe("#f3a86c");
    expect(merged.dark.numberFg).toBe("#f5f3f1");
    expect(merged.dark.additionNumberFg).toBe("#cae28f");

    // Original tokens overridden by user
    expect(merged.dark.bg).toBe("#2e2e2e");
    expect(merged.dark.addition).toBe("#3F4538");

    // Tokens not in user file get defaults
    expect(merged.dark.context).toBe(DEFAULT_DIFF_THEME.dark.context);

    // Light is pure defaults
    expect(merged.light).toEqual(DEFAULT_DIFF_THEME.light);
  });

  it("returns defaults when partial is empty", () => {
    const merged = mergePartialDiffTheme({});
    expect(merged.light).toEqual(DEFAULT_DIFF_THEME.light);
    expect(merged.dark).toEqual(DEFAULT_DIFF_THEME.dark);
  });
});
