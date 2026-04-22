import { describe, expect, it } from "vitest";
import { extractToolData, getLifecycleMap } from "./index.ts";

import bashFixture from "./fixtures/claude-bash.json";

describe("extractToolData dispatcher", () => {
  it("dispatches to Claude extractor for claudeAgent", () => {
    const result = extractToolData(bashFixture.completed, "claudeAgent");
    expect(result).toMatchObject({
      toolName: "Bash",
      itemType: "command_execution",
    });
  });

  it("returns null for unknown provider", () => {
    expect(extractToolData(bashFixture.completed, "somethingElse")).toBeNull();
  });

  it("returns null for stub providers (codex, opencode, cursor)", () => {
    expect(extractToolData(bashFixture.completed, "codex")).toBeNull();
    expect(extractToolData(bashFixture.completed, "opencode")).toBeNull();
    expect(extractToolData(bashFixture.completed, "cursor")).toBeNull();
  });
});

describe("getLifecycleMap", () => {
  it("returns lifecycle map for known providers", () => {
    const claude = getLifecycleMap("claudeAgent");
    expect(claude).toBeDefined();
    expect(claude?.command_execution).toMatchObject({
      lifecycle: "tracked",
      events: ["tool.started", "tool.updated", "tool.completed"],
    });
  });

  it("returns cursor lifecycle with no tool.started", () => {
    const cursor = getLifecycleMap("cursor");
    expect(cursor?.command_execution).toMatchObject({
      lifecycle: "tracked",
      events: ["tool.updated", "tool.completed"],
    });
  });

  it("returns undefined for unknown provider", () => {
    expect(getLifecycleMap("whatever")).toBeUndefined();
  });
});
