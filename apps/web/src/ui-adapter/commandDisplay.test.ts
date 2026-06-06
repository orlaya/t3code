import { describe, expect, it } from "vitest";

import { formatCommandForDisplay, parseCommandForDisplay } from "./commandDisplay";

describe("command display", () => {
  it("unwraps common shell command wrappers", () => {
    expect(
      formatCommandForDisplay("/bin/zsh -lc 'git diff --stat -- apps/web/src/foo.ts'"),
    ).toEqual({
      command: "git diff --stat -- apps/web/src/foo.ts",
      rawCommand: "/bin/zsh -lc 'git diff --stat -- apps/web/src/foo.ts'",
    });
  });

  it("parses sed read ranges", () => {
    expect(parseCommandForDisplay("sed -n '1,420p' apps/web/src/foo.ts")).toEqual({
      kind: "read",
      tool: "sed",
      filePath: "apps/web/src/foo.ts",
      lineStart: 1,
      lineEnd: 420,
    });
  });

  it("parses sed ranges after shell wrapper quote juggling", () => {
    expect(
      parseCommandForDisplay(
        `/bin/zsh -lc 'sed -n '"'"'1,260p'"'"' apps/web/src/ui-adapter/codex.test.ts'`,
      ),
    ).toEqual({
      kind: "read",
      tool: "sed",
      filePath: "apps/web/src/ui-adapter/codex.test.ts",
      lineStart: 1,
      lineEnd: 260,
    });
  });

  it("parses plain cat file commands as whole-file reads", () => {
    expect(parseCommandForDisplay("cat AGENTS.md")).toEqual({
      kind: "read",
      tool: "cat",
      filePath: "AGENTS.md",
      filePaths: ["AGENTS.md"],
    });
  });

  it("parses plain cat multi-file commands as whole-file reads", () => {
    expect(parseCommandForDisplay("cat AGENTS.md CLAUDE.local.md")).toEqual({
      kind: "read",
      tool: "cat",
      filePaths: ["AGENTS.md", "CLAUDE.local.md"],
    });
  });

  it("parses nl -ba file commands as whole-file reads", () => {
    expect(parseCommandForDisplay("nl -ba AGENTS.md")).toEqual({
      kind: "read",
      tool: "nl -ba",
      filePath: "AGENTS.md",
      filePaths: ["AGENTS.md"],
    });
  });

  it("parses nl -b a file commands as whole-file reads", () => {
    expect(parseCommandForDisplay("nl -b a -- AGENTS.md")).toEqual({
      kind: "read",
      tool: "nl -ba",
      filePath: "AGENTS.md",
      filePaths: ["AGENTS.md"],
    });
  });

  it("does not parse nl commands without all-line numbering as plain reads", () => {
    expect(parseCommandForDisplay("nl AGENTS.md")).toBeNull();
  });

  it("does not parse cat commands with flags as plain reads", () => {
    expect(parseCommandForDisplay("cat -n AGENTS.md")).toBeNull();
  });

  it("does not parse cat stdin as a plain read", () => {
    expect(parseCommandForDisplay("cat -")).toBeNull();
  });

  it("parses ripgrep commands as grep display commands", () => {
    expect(parseCommandForDisplay('rg "AssembledWorkGroup" apps/web/src -n')).toEqual({
      kind: "grep",
      tool: "rg",
      heading: "Grep",
      command: 'rg "AssembledWorkGroup" apps/web/src -n',
    });
  });

  it("parses wrapped ripgrep commands as grep display commands", () => {
    expect(
      parseCommandForDisplay(`/bin/zsh -lc 'rg "AssembledWorkGroup" apps/web/src -n'`),
    ).toEqual({
      kind: "grep",
      tool: "rg",
      heading: "Grep",
      command: 'rg "AssembledWorkGroup" apps/web/src -n',
    });
  });

  it("parses frank outline commands as outline display commands", () => {
    expect(
      parseCommandForDisplay(
        "frank outline ___dandy/cli/tests/compare.rs ___dandy/cli/tests/ts_runtime.rs",
      ),
    ).toEqual({
      kind: "outline",
      heading: "Outline",
      detail: "___dandy/cli/tests/compare.rs ___dandy/cli/tests/ts_runtime.rs",
    });
  });

  it("parses wrapped frank outline commands as outline display commands", () => {
    expect(
      parseCommandForDisplay(
        "/bin/zsh -lc 'frank outline ___dandy/cli/tests/compare.rs ___dandy/cli/tests/ts_runtime.rs'",
      ),
    ).toEqual({
      kind: "outline",
      heading: "Outline",
      detail: "___dandy/cli/tests/compare.rs ___dandy/cli/tests/ts_runtime.rs",
    });
  });
});
