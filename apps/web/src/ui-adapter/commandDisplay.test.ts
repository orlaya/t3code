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
