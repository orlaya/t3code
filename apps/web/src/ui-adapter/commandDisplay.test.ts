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
});
