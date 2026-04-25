import { describe, expect, it } from "vitest";
import type { HookAction, ManagedHookEntry } from "@t3tools/contracts";
import { fingerprintAction } from "@t3tools/shared/claudeHooksFingerprint";

import {
  flattenManagedLevel,
  flattenUnmanagedLevel,
  unmanagedTitle,
  type UnmanagedRef,
} from "./HooksSettings.logic";

// ── Helpers ────────────────────────────────────────────────────────

const cmd = (command: string): HookAction => ({ type: "command", command });

const managedHook = (
  overrides: Partial<ManagedHookEntry> & { event: string; action: HookAction },
): ManagedHookEntry => ({
  name: overrides.name ?? "Test hook",
  draft: overrides.draft ?? false,
  file: overrides.file ?? "committed",
  event: overrides.event as ManagedHookEntry["event"],
  action: overrides.action,
  ...(overrides.matcher !== undefined ? { matcher: overrides.matcher } : {}),
});

// ── unmanagedTitle ─────────────────────────────────────────────────

describe("unmanagedTitle", () => {
  it("formats event and matcher when matcher is present", () => {
    const ref = { event: "PreToolUse", matcher: "Bash" } as UnmanagedRef;
    expect(unmanagedTitle(ref)).toBe("PreToolUse · Bash");
  });

  it("returns just the event when matcher is undefined", () => {
    const ref = { event: "Stop", matcher: undefined } as UnmanagedRef;
    expect(unmanagedTitle(ref)).toBe("Stop");
  });
});

// ── flattenManagedLevel ───────────────────────────────────────────

describe("flattenManagedLevel", () => {
  it("maps managed entries to refs with project metadata", () => {
    const managed: Record<string, ManagedHookEntry> = {
      h1: managedHook({ name: "Hook A", event: "Stop", action: cmd("echo a") }),
      h2: managedHook({ name: "Hook B", event: "PreToolUse", action: cmd("exit 1") }),
    };
    const refs = flattenManagedLevel(managed, "/my/project", "My Project");

    expect(refs).toHaveLength(2);
    expect(refs[0]!.id).toBe("h1");
    expect(refs[0]!.hook.name).toBe("Hook A");
    expect(refs[0]!.projectCwd).toBe("/my/project");
    expect(refs[0]!.projectTitle).toBe("My Project");
    expect(refs[1]!.id).toBe("h2");
  });

  it("uses null for global hooks", () => {
    const managed: Record<string, ManagedHookEntry> = {
      g1: managedHook({ name: "Global", event: "Stop", action: cmd("echo") }),
    };
    const refs = flattenManagedLevel(managed, null, null);

    expect(refs).toHaveLength(1);
    expect(refs[0]!.projectCwd).toBeNull();
    expect(refs[0]!.projectTitle).toBeNull();
  });

  it("returns empty array for empty managed record", () => {
    expect(flattenManagedLevel({}, "/whatever", "Whatever")).toEqual([]);
  });
});

// ── flattenUnmanagedLevel ─────────────────────────────────────────

describe("flattenUnmanagedLevel", () => {
  it("flattens nested unmanaged structure into refs with fingerprints", () => {
    const unmanaged = {
      committed: {
        PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit 1"), cmd("echo check")] }],
      },
      local: {},
    };
    const refs = flattenUnmanagedLevel(unmanaged, "/proj", "Proj");

    expect(refs).toHaveLength(2);
    expect(refs[0]!.file).toBe("committed");
    expect(refs[0]!.event).toBe("PreToolUse");
    expect(refs[0]!.matcher).toBe("Bash");
    expect(refs[0]!.action).toEqual(cmd("exit 1"));
    expect(refs[0]!.fingerprint).toBe(fingerprintAction("PreToolUse", "Bash", cmd("exit 1")));
    expect(refs[0]!.projectCwd).toBe("/proj");
    expect(refs[0]!.projectTitle).toBe("Proj");

    expect(refs[1]!.action).toEqual(cmd("echo check"));
  });

  it("includes actions from both committed and local files", () => {
    const unmanaged = {
      committed: {
        Stop: [{ hooks: [cmd("echo committed")] }],
      },
      local: {
        PreToolUse: [{ matcher: "Grep", hooks: [cmd("echo local")] }],
      },
    };
    const refs = flattenUnmanagedLevel(unmanaged, null, null);

    expect(refs).toHaveLength(2);
    expect(refs[0]!.file).toBe("committed");
    expect(refs[0]!.event).toBe("Stop");
    expect(refs[1]!.file).toBe("local");
    expect(refs[1]!.event).toBe("PreToolUse");
    expect(refs[1]!.matcher).toBe("Grep");
  });

  it("preserves groupTimeout on refs", () => {
    const unmanaged = {
      committed: {
        PreToolUse: [{ matcher: "Bash", hooks: [cmd("exit 1")], timeout: 30 }],
      },
      local: {},
    };
    const refs = flattenUnmanagedLevel(unmanaged, null, null);

    expect(refs).toHaveLength(1);
    expect(refs[0]!.groupTimeout).toBe(30);
  });

  it("returns empty array when no unmanaged hooks exist", () => {
    expect(flattenUnmanagedLevel({ committed: {}, local: {} }, null, null)).toEqual([]);
  });

  it("handles multiple events and multiple groups per event", () => {
    const unmanaged = {
      committed: {
        PreToolUse: [
          { matcher: "Bash", hooks: [cmd("exit 1")] },
          { matcher: "Grep", hooks: [cmd("exit 2")] },
        ],
        Stop: [{ hooks: [cmd("echo bye")] }],
      },
      local: {},
    };
    const refs = flattenUnmanagedLevel(unmanaged, null, null);

    expect(refs).toHaveLength(3);
    expect(refs[0]!.matcher).toBe("Bash");
    expect(refs[1]!.matcher).toBe("Grep");
    expect(refs[2]!.event).toBe("Stop");
    expect(refs[2]!.matcher).toBeUndefined();
  });
});
