import { GlobeIcon, InfoIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { HookAction, HooksLevel, ManagedHookEntry, ManagedHookFile } from "@t3tools/contracts";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { useServerConfig } from "../../rpc/serverState";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

// ── Constants (mirrors HooksSettings) ──────────────────────────

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
  "PermissionDenied",
  "Setup",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "InstructionsLoaded",
  "CwdChanged",
  "FileChanged",
] as const;

const ACTION_TYPES = ["command", "prompt", "agent", "http"] as const;
type ActionType = (typeof ACTION_TYPES)[number];

const ACTION_TYPE_INFO: Record<
  ActionType,
  { readonly title: string; readonly tagline: string; readonly description: string }
> = {
  command: {
    title: "Command",
    tagline: "Run a shell command",
    description:
      "Runs a shell command. Stdin receives the event JSON; stdout, stderr, and exit code control what happens next. The workhorse for most hooks.",
  },
  prompt: {
    title: "Prompt",
    tagline: "Quick yes / no Haiku gatekeeper",
    description:
      "Sends your prompt text to Haiku as a yes/no gatekeeper. It decides whether the turn proceeds or is blocked — it does not inject context.",
  },
  agent: {
    title: "Agent",
    tagline: "Full sub-agent gatekeeper",
    description:
      "Like Prompt, but spawns a full sub-agent that can read files, run commands, etc. before deciding to allow or block. Heavier and experimental.",
  },
  http: {
    title: "HTTP",
    tagline: "POST to a webhook URL",
    description:
      "POSTs the event JSON to a URL endpoint. The response body uses the same decision format as Command hooks.",
  },
};

const TOOL_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
]);

const TOOL_NAMES = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "Agent",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "TodoWrite",
  "AskUserQuestion",
  "Mcp",
  "ListMcpResources",
  "ReadMcpResource",
  "Config",
  "TaskStop",
  "TaskOutput",
  "EnterWorktree",
  "ExitWorktree",
  "ExitPlanMode",
] as const;

const FILE_TOOLS = new Set(["Read", "Write", "Edit"]);

function patternPlaceholder(tool: string): string {
  if (tool === "Bash") return "git *";
  if (FILE_TOOLS.has(tool)) return "src/**/*.ts";
  return "";
}

function patternHint(tool: string): string {
  if (tool === "Bash")
    return 'Glob-style wildcards. "git *" matches git commands, "npm run *" matches npm scripts. A space before * enforces a word boundary.';
  if (FILE_TOOLS.has(tool))
    return 'Gitignore-style path patterns. "src/**/*.ts" matches TypeScript files in src, "*.test.*" matches test files.';
  return "Optional filter pattern.";
}

// ── Form state ───────────────────────────────────────────────

interface HookFormState {
  name: string;
  description: string;
  level: HooksLevel;
  /** Cwd of the project this hook will be saved to. Ignored when level is "global". */
  projectCwd: string;
  file: ManagedHookFile;
  event: string;
  matcherTool: string;
  matcherPattern: string;
  actionType: ActionType;
  command: string;
  prompt: string;
  url: string;
  timeout: string;
  statusMessage: string;
}

const EMPTY_STATE: HookFormState = {
  name: "",
  description: "",
  level: "project",
  projectCwd: "",
  file: "committed",
  event: "PostToolUse",
  matcherTool: "",
  matcherPattern: "",
  actionType: "command",
  command: "",
  prompt: "",
  url: "",
  timeout: "",
  statusMessage: "",
};

/** Parse a managed hook into form state. Splits `action.if` (e.g. "Bash(git *)") back into tool + pattern. */
function hookToState(hook: ManagedHookEntry, level: HooksLevel, projectCwd: string): HookFormState {
  const action = hook.action;
  const matcherTool = hook.matcher ?? "";
  let matcherPattern = "";
  if (action.if) {
    const m = /^([A-Za-z]+)\((.*)\)$/.exec(action.if);
    if (m && m[1] === matcherTool) matcherPattern = m[2] ?? "";
  }

  return {
    name: hook.name,
    description: hook.description ?? "",
    level,
    projectCwd,
    file: hook.file,
    event: hook.event,
    matcherTool,
    matcherPattern,
    actionType: action.type,
    command: action.type === "command" ? action.command : "",
    prompt: action.type === "prompt" || action.type === "agent" ? action.prompt : "",
    url: action.type === "http" ? action.url : "",
    timeout: action.timeout !== undefined ? String(action.timeout) : "",
    statusMessage: action.statusMessage ?? "",
  };
}

function composeMatcher(s: HookFormState): string | undefined {
  if (!TOOL_EVENTS.has(s.event)) return undefined;
  return s.matcherTool || undefined;
}

function composeIf(s: HookFormState): string | undefined {
  if (!TOOL_EVENTS.has(s.event)) return undefined;
  if (!s.matcherTool) return undefined;
  const pattern = s.matcherPattern.trim();
  if (!pattern) return undefined;
  return `${s.matcherTool}(${pattern})`;
}

function buildAction(s: HookFormState): HookAction {
  const common: Record<string, unknown> = {};
  if (s.timeout.trim()) common["timeout"] = Number(s.timeout);
  if (s.statusMessage.trim()) common["statusMessage"] = s.statusMessage.trim();
  const ifValue = composeIf(s);
  if (ifValue) common["if"] = ifValue;

  switch (s.actionType) {
    case "command":
      return { type: "command", command: s.command.trim(), ...common } as HookAction;
    case "prompt":
      return { type: "prompt", prompt: s.prompt.trim(), ...common } as HookAction;
    case "agent":
      return { type: "agent", prompt: s.prompt.trim(), ...common } as HookAction;
    case "http":
      return { type: "http", url: s.url.trim(), ...common } as HookAction;
  }
}

function validate(s: HookFormState): string | null {
  if (!s.name.trim()) return "Name is required.";
  if (s.actionType === "command" && !s.command.trim()) return "Command is required.";
  if ((s.actionType === "prompt" || s.actionType === "agent") && !s.prompt.trim())
    return "Prompt is required.";
  if (s.actionType === "http" && !s.url.trim()) return "URL is required.";
  return null;
}

// ── Component ────────────────────────────────────────────────

export interface HookEditFormProps {
  /** Set when editing an existing managed hook. */
  hookId?: string;
  /** Set when editing — pre-populates the form. */
  initialHook?: ManagedHookEntry;
  /** Initial level. For create: defaults to "project". For edit: the level the hook was found in. */
  initialLevel?: HooksLevel;
  /** Set when adopting a pre-existing (unmanaged) hook — the unmanaged entry is removed after save. */
  adoptFingerprint?: string;
  /**
   * Owning project cwd for edits/adopts. Falls back to the current session's
   * cwd when unset (the create case, or legacy links that didn't encode it).
   */
  initialCwd?: string;
}

export function HookEditForm({
  hookId,
  initialHook,
  initialLevel,
  adoptFingerprint,
  initialCwd,
}: HookEditFormProps) {
  const isEdit = hookId !== undefined && initialHook !== undefined;
  const navigate = useNavigate();
  const serverConfig = useServerConfig();
  const currentCwd = serverConfig?.cwd ?? "";
  const owningCwd = initialCwd || currentCwd;

  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const projectOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ cwd: string; title: string }> = [];
    for (const project of projects) {
      if (!project.cwd || seen.has(project.cwd)) continue;
      seen.add(project.cwd);
      options.push({ cwd: project.cwd, title: project.name || project.cwd });
    }
    return options;
  }, [projects]);

  const [state, setState] = useState<HookFormState>(() =>
    initialHook ? hookToState(initialHook, initialLevel ?? "project", owningCwd) : EMPTY_STATE,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const rpcCwd = state.level === "project" ? state.projectCwd : undefined;
  const selectedProject = projectOptions.find((p) => p.cwd === state.projectCwd);

  const update = useCallback(
    (patch: Partial<HookFormState>) => {
      setState((prev) => ({ ...prev, ...patch }));
      setError(null);
    },
    [setState],
  );

  const save = useCallback(
    async (asDraft: boolean) => {
      const v = validate(state);
      if (v) {
        setError(v);
        return;
      }
      if (state.level === "project" && !rpcCwd) {
        setError("Select a project to save this hook to.");
        return;
      }

      const matcher = composeMatcher(state);
      const action = buildAction(state);
      const hook: ManagedHookEntry = {
        name: state.name.trim(),
        ...(state.description.trim() ? { description: state.description.trim() } : {}),
        draft: asDraft,
        file: state.file,
        event: state.event as ManagedHookEntry["event"],
        ...(matcher !== undefined ? { matcher } : {}),
        action,
      };

      // Detect whether the hook is being moved to a different level or project.
      const isMoving =
        isEdit &&
        initialLevel !== undefined &&
        (initialLevel !== state.level ||
          (initialLevel === "project" &&
            state.level === "project" &&
            owningCwd !== state.projectCwd));

      setSaving(true);
      try {
        const client = getPrimaryEnvironmentConnection().client;

        if (isMoving && hookId) {
          // Delete from old location first, then write to new location with no hookId (new entry).
          await client.claudeHooks.delete({
            cwd: initialLevel === "global" ? undefined : owningCwd,
            level: initialLevel!,
            hookId,
          });
          await client.claudeHooks.write({
            cwd: rpcCwd,
            level: state.level,
            hook,
          });
        } else {
          await client.claudeHooks.write({
            cwd: rpcCwd,
            ...(hookId !== undefined ? { hookId } : {}),
            level: state.level,
            hook,
          });
        }

        if (adoptFingerprint && initialLevel) {
          try {
            await client.claudeHooks.delete({
              cwd: owningCwd,
              level: initialLevel,
              fingerprint: adoptFingerprint,
            });
          } catch {
            // Reconcile will strip the matching unmanaged entry on next read;
            // tolerate delete failures here.
          }
        }
        void navigate({ to: "/settings/hooks" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save hook.");
        setSaving(false);
      }
    },
    [state, rpcCwd, hookId, isEdit, adoptFingerprint, initialLevel, owningCwd, navigate],
  );

  const remove = useCallback(async () => {
    const client = getPrimaryEnvironmentConnection().client;

    // Always delete from the *original* location, not the currently-selected
    // level (the user may have changed the selector before hitting delete).
    const deleteLevel = initialLevel ?? state.level;
    const deleteCwd = deleteLevel === "global" ? undefined : owningCwd || rpcCwd;

    if (hookId && (deleteLevel === "global" || deleteCwd)) {
      setSaving(true);
      try {
        await client.claudeHooks.delete({
          cwd: deleteCwd,
          level: deleteLevel,
          hookId,
        });
        void navigate({ to: "/settings/hooks" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete hook.");
        setSaving(false);
      }
      return;
    }

    if (adoptFingerprint && initialLevel && owningCwd) {
      setSaving(true);
      try {
        await client.claudeHooks.delete({
          cwd: owningCwd,
          level: initialLevel,
          fingerprint: adoptFingerprint,
        });
        void navigate({ to: "/settings/hooks" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete hook.");
        setSaving(false);
      }
    }
  }, [hookId, adoptFingerprint, initialLevel, rpcCwd, owningCwd, state.level, navigate]);

  const isToolEvent = TOOL_EVENTS.has(state.event);

  return (
    <SettingsPageContainer>
      <div className="space-y-6 py-2">
        {/* ── Card 0: Identity ───────────────────────────────── */}
        <SettingsSection title="Identity">
          <div className="px-4 py-3 sm:px-5">
            <label className="block">
              <span className="text-xs font-medium text-foreground">Name</span>
              <Input
                className="mt-1.5"
                value={state.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Block git in background"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="border-t border-border/60 px-4 py-3 sm:px-5">
            <label className="block">
              <span className="text-xs font-medium text-foreground">Description</span>
              <Textarea
                className="mt-1.5"
                value={state.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="Optional. What this hook does, why it exists."
                spellCheck={true}
              />
            </label>
          </div>
        </SettingsSection>

        {/* ── Card 1: Save to ────────────────────────────────── */}
        <SettingsSection title="Save to">
          <SettingsRow
            title="Level"
            description="Global applies to every Claude Code session on this machine. Pick a project to scope the hook to that project only."
            status={
              state.level === "project" && state.projectCwd ? (
                <span className="font-mono">{state.projectCwd}</span>
              ) : null
            }
            control={
              <Select
                value={state.level === "global" ? "__global__" : state.projectCwd}
                onValueChange={(value) => {
                  if (!value) return;
                  if (value === "__global__") {
                    update({ level: "global" });
                  } else {
                    update({ level: "project", projectCwd: value });
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-52" aria-label="Level">
                  <SelectValue placeholder="Select…">
                    {(value) => {
                      if (value === "__global__") {
                        return (
                          <span className="flex items-center gap-1.5">
                            Global
                            <GlobeIcon className="size-3 opacity-50" />
                          </span>
                        );
                      }
                      if (!value) return null;
                      return (
                        <span className="truncate">{selectedProject?.title ?? String(value)}</span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global__" hideIndicator>
                    <span className="flex items-center gap-1.5">
                      Global
                      <GlobeIcon className="size-3 opacity-50" />
                    </span>
                  </SelectItem>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.cwd} value={project.cwd} hideIndicator>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{project.title}</span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {project.cwd}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="File"
            description="Which settings file to save this hook to."
            control={
              <Select
                value={state.file}
                onValueChange={(value) => {
                  if (value) update({ file: value as ManagedHookFile });
                }}
              >
                <SelectTrigger className="w-full sm:w-52" aria-label="File">
                  <SelectValue>
                    {(value) => (value === "local" ? "settings.local.json" : "settings.json")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="committed" hideIndicator>
                    settings.json
                  </SelectItem>
                  <SelectItem value="local" hideIndicator>
                    settings.local.json
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </SettingsSection>

        {/* ── Card 2: Trigger ────────────────────────────────── */}
        <SettingsSection title="Trigger">
          <div className="px-4 py-3 sm:px-5">
            <label className="block">
              <span className="text-xs font-medium text-foreground">Event</span>
              <Select
                value={state.event}
                onValueChange={(value) => {
                  if (!value) return;
                  const clearing = TOOL_EVENTS.has(state.event) && !TOOL_EVENTS.has(value);
                  update({
                    event: value,
                    ...(clearing ? { matcherTool: "", matcherPattern: "" } : {}),
                  });
                }}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_EVENTS.map((event) => (
                    <SelectItem key={event} value={event}>
                      {event}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          {isToolEvent ? (
            <>
              <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                <label className="block">
                  <span className="text-xs font-medium text-foreground">Tool</span>
                  <Select
                    value={state.matcherTool || "__all__"}
                    onValueChange={(value) => {
                      if (!value) return;
                      const tool = value === "__all__" ? "" : value;
                      update({
                        matcherTool: tool,
                        matcherPattern: tool ? state.matcherPattern : "",
                      });
                    }}
                  >
                    <SelectTrigger className="mt-1.5">
                      <span className="flex-1 truncate">{state.matcherTool || "All tools"}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All tools</SelectItem>
                      {TOOL_NAMES.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              {state.matcherTool ? (
                <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                  <label className="block">
                    <span className="text-xs font-medium text-foreground">Pattern</span>
                    <Input
                      className="mt-1.5 font-mono text-xs"
                      value={state.matcherPattern}
                      onChange={(e) => update({ matcherPattern: e.target.value })}
                      placeholder={patternPlaceholder(state.matcherTool) || "Optional"}
                      spellCheck={false}
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {patternHint(state.matcherTool)} Leave empty to match all.
                    </span>
                  </label>
                </div>
              ) : null}
            </>
          ) : null}
        </SettingsSection>

        {/* ── Card 3: Action ─────────────────────────────────── */}
        <SettingsSection title="Then do">
          <div className="space-y-1.5 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">Action type</span>
              <Popover>
                <PopoverTrigger
                  aria-label="Show action type reference"
                  className="inline-flex text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  <InfoIcon className="size-3" />
                </PopoverTrigger>
                <PopoverPopup className="w-80">
                  <div className="space-y-3">
                    {ACTION_TYPES.map((type) => (
                      <div key={type}>
                        <div className="text-xs font-medium text-foreground">
                          {ACTION_TYPE_INFO[type].title}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {ACTION_TYPE_INFO[type].description}
                        </p>
                      </div>
                    ))}
                  </div>
                </PopoverPopup>
              </Popover>
            </div>
            <Select
              value={state.actionType}
              onValueChange={(value) => {
                if (value) update({ actionType: value as ActionType });
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) => (value ? ACTION_TYPE_INFO[value as ActionType].title : null)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {ACTION_TYPES.map((type) => (
                  <SelectItem key={type} value={type} hideIndicator>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{ACTION_TYPE_INFO[type].title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {ACTION_TYPE_INFO[type].tagline}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground/80">
              {ACTION_TYPE_INFO[state.actionType].description}
            </p>
          </div>

          {state.actionType === "command" ? (
            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <label className="block">
                <span className="text-xs font-medium text-foreground">Command</span>
                <Textarea
                  className="mt-1.5 font-mono text-xs"
                  size="lg"
                  value={state.command}
                  onChange={(e) => update({ command: e.target.value })}
                  placeholder="echo hello"
                  spellCheck={false}
                />
              </label>
            </div>
          ) : null}

          {state.actionType === "prompt" || state.actionType === "agent" ? (
            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <label className="block">
                <span className="text-xs font-medium text-foreground">Prompt</span>
                <Textarea
                  className="mt-1.5"
                  size="lg"
                  value={state.prompt}
                  onChange={(e) => update({ prompt: e.target.value })}
                  placeholder="The prompt text..."
                  spellCheck={false}
                />
              </label>
            </div>
          ) : null}

          {state.actionType === "http" ? (
            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <label className="block">
                <span className="text-xs font-medium text-foreground">URL</span>
                <Input
                  className="mt-1.5 font-mono text-xs"
                  value={state.url}
                  onChange={(e) => update({ url: e.target.value })}
                  placeholder="https://example.com/webhook"
                  spellCheck={false}
                />
              </label>
            </div>
          ) : null}

          <div className="flex gap-3 border-t border-border/60 px-4 py-3 sm:px-5">
            <label className="w-24">
              <span className="text-xs font-medium text-foreground">Timeout</span>
              <Input
                className="mt-1.5"
                type="number"
                value={state.timeout}
                onChange={(e) => update({ timeout: e.target.value })}
                placeholder="s"
              />
            </label>
            <label className="flex-1">
              <span className="text-xs font-medium text-foreground">Status message</span>
              <Input
                className="mt-1.5"
                value={state.statusMessage}
                onChange={(e) => update({ statusMessage: e.target.value })}
                placeholder="Shown while hook runs..."
                spellCheck={false}
              />
            </label>
          </div>
        </SettingsSection>

        {/* ── Error + Actions ────────────────────────────────── */}
        {error ? (
          <div className="px-4 sm:px-5">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 px-1">
          {isEdit || adoptFingerprint ? (
            <>
              <Button
                size="sm"
                variant="destructive-outline"
                disabled={saving}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
              <AlertDialog
                open={confirmingDelete}
                onOpenChange={(open) => setConfirmingDelete(open)}
              >
                <AlertDialogPopup>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete hook?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove the hook and its underlying settings entry. This
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose
                      disabled={saving}
                      render={
                        <Button size="sm" variant="outline">
                          Cancel
                        </Button>
                      }
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={saving}
                      onClick={() => void remove()}
                    >
                      Delete
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogPopup>
              </AlertDialog>
            </>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => void save(true)}>
              Save as draft
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save(false)}>
              {isEdit ? "Save" : "Add hook"}
            </Button>
          </div>
        </div>
      </div>
    </SettingsPageContainer>
  );
}
