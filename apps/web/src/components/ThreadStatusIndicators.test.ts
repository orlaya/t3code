import { describe, expect, it } from "vitest";

import { resolveThreadStatusCwd } from "./ThreadStatusIndicators";

describe("resolveThreadStatusCwd", () => {
  it("uses an isolated worktree path for thread status indicators", () => {
    expect(resolveThreadStatusCwd({ worktreePath: "/repo/worktrees/thread-a" })).toBe(
      "/repo/worktrees/thread-a",
    );
  });

  it("does not use the shared project checkout for historical thread status", () => {
    expect(resolveThreadStatusCwd({ worktreePath: null })).toBeNull();
  });
});
