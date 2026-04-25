import type {
  ClaudeHooksAllProjectsResult,
  HookAction,
  HookMatcherGroup,
  ManagedHookEntry,
  ManagedHookFile,
} from "@t3tools/contracts";
import { fingerprintAction } from "@t3tools/shared/claudeHooksFingerprint";

// ── Types ───────────────────────────────────────────────────────

export interface ManagedRef {
  id: string;
  hook: ManagedHookEntry;
  /** Owning project cwd. `null` for global hooks. */
  projectCwd: string | null;
  /** Owning project title. `null` for global hooks. */
  projectTitle: string | null;
}

export interface UnmanagedRef {
  file: ManagedHookFile;
  event: string;
  matcher: string | undefined;
  action: HookAction;
  groupTimeout: number | undefined;
  fingerprint: string;
  /** Owning project cwd. `null` for global hooks. */
  projectCwd: string | null;
  /** Owning project title. `null` for global hooks. */
  projectTitle: string | null;
}

export const ALL_PROJECTS = "__all__";

// ── Helpers ─────────────────────────────────────────────────────

export function unmanagedTitle(ref: UnmanagedRef): string {
  return ref.matcher ? `${ref.event} · ${ref.matcher}` : ref.event;
}

export function flattenManagedLevel(
  managed: Record<string, ManagedHookEntry>,
  projectCwd: string | null,
  projectTitle: string | null,
): ManagedRef[] {
  return Object.entries(managed).map(([id, hook]) => ({
    id,
    hook,
    projectCwd,
    projectTitle,
  }));
}

export function flattenUnmanagedLevel(
  unmanaged: ClaudeHooksAllProjectsResult["global"]["unmanaged"],
  projectCwd: string | null,
  projectTitle: string | null,
): UnmanagedRef[] {
  const refs: UnmanagedRef[] = [];
  for (const file of ["committed", "local"] as const) {
    const events = unmanaged[file];
    for (const [event, groups] of Object.entries(events)) {
      for (const group of groups as HookMatcherGroup[]) {
        for (const action of group.hooks) {
          refs.push({
            file,
            event,
            matcher: group.matcher,
            action,
            groupTimeout: group.timeout,
            fingerprint: fingerprintAction(event, group.matcher, action),
            projectCwd,
            projectTitle,
          });
        }
      }
    }
  }
  return refs;
}
