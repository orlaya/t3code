import { describe, expect, it } from "vitest";
import { parseEditHookSearch, parseAdoptSearch } from "./settings.hooks.search";

// ── parseEditHookSearch ────────────────────────────────────────────

describe("parseEditHookSearch", () => {
  it("parses valid global level and cwd", () => {
    const result = parseEditHookSearch({ level: "global", cwd: "/my/project" });
    expect(result).toEqual({ level: "global", cwd: "/my/project" });
  });

  it("parses valid project level", () => {
    const result = parseEditHookSearch({ level: "project", cwd: "/my/project" });
    expect(result).toEqual({ level: "project", cwd: "/my/project" });
  });

  it("defaults level to project when missing", () => {
    const result = parseEditHookSearch({ cwd: "/whatever" });
    expect(result.level).toBe("project");
  });

  it("defaults level to project for unrecognised value", () => {
    const result = parseEditHookSearch({ level: "nonsense", cwd: "" });
    expect(result.level).toBe("project");
  });

  it("defaults cwd to empty string when missing", () => {
    const result = parseEditHookSearch({ level: "global" });
    expect(result.cwd).toBe("");
  });

  it("defaults cwd to empty string when non-string", () => {
    const result = parseEditHookSearch({ level: "project", cwd: 42 });
    expect(result.cwd).toBe("");
  });

  it("handles completely empty search", () => {
    const result = parseEditHookSearch({});
    expect(result).toEqual({ level: "project", cwd: "" });
  });
});

// ── parseAdoptSearch ───────────────────────────────────────────────

describe("parseAdoptSearch", () => {
  it("parses all valid fields", () => {
    const result = parseAdoptSearch({
      level: "global",
      fingerprint: "abc123",
      cwd: "/my/project",
    });
    expect(result).toEqual({ level: "global", fingerprint: "abc123", cwd: "/my/project" });
  });

  it("defaults level to project when missing", () => {
    const result = parseAdoptSearch({ fingerprint: "abc" });
    expect(result.level).toBe("project");
  });

  it("defaults fingerprint to empty string when missing", () => {
    const result = parseAdoptSearch({ level: "project" });
    expect(result.fingerprint).toBe("");
  });

  it("defaults fingerprint to empty string when non-string", () => {
    const result = parseAdoptSearch({ fingerprint: 123 });
    expect(result.fingerprint).toBe("");
  });

  it("defaults cwd to empty string when missing", () => {
    const result = parseAdoptSearch({ level: "global", fingerprint: "abc" });
    expect(result.cwd).toBe("");
  });

  it("handles completely empty search", () => {
    const result = parseAdoptSearch({});
    expect(result).toEqual({ level: "project", fingerprint: "", cwd: "" });
  });
});
