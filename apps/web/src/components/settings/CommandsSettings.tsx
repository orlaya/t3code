import { PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";
import type { CustomSlashCommand } from "@t3tools/contracts";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

// ── Validation ──────────────────────────────────────────────────

/** Characters allowed in command names: lowercase alphanumeric, hyphens, underscores. */
const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Names that would collide with built-in or well-known provider commands. */
const RESERVED_NAMES = new Set([
  "compact",
  "default",
  "model",
  "plan",
  "help",
  "clear",
  "bug",
  "init",
  "login",
  "logout",
  "memory",
  "review",
  "vim",
]);

function validateCommandName(
  name: string,
  existingNames: ReadonlyArray<string>,
  editingIndex: number | null,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Name is required.";
  if (!COMMAND_NAME_PATTERN.test(trimmed)) {
    return "Lowercase letters, numbers, hyphens, and underscores only. Must start with a letter or number.";
  }
  if (RESERVED_NAMES.has(trimmed)) return `"${trimmed}" is reserved.`;
  const collision = existingNames.findIndex((existing) => existing === trimmed);
  if (collision !== -1 && collision !== editingIndex) {
    return `A command named "${trimmed}" already exists.`;
  }
  return null;
}

// ── Draft state for a new or editing command ────────────────────

interface CommandDraft {
  name: string;
  description: string;
  promptMessage: string;
  promptFile: string;
  highlightResponse: boolean;
}

const EMPTY_DRAFT: CommandDraft = {
  name: "",
  description: "",
  promptMessage: "",
  promptFile: "",
  highlightResponse: false,
};

function draftFromCommand(cmd: CustomSlashCommand): CommandDraft {
  return {
    name: cmd.name,
    description: cmd.description,
    promptMessage: cmd.promptMessage ?? "",
    promptFile: cmd.promptFile ?? "",
    highlightResponse: cmd.highlightResponse,
  };
}

function draftToCommand(draft: CommandDraft): CustomSlashCommand {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    ...(draft.promptMessage.trim() ? { promptMessage: draft.promptMessage.trim() } : {}),
    ...(draft.promptFile.trim() ? { promptFile: draft.promptFile.trim() } : {}),
    highlightResponse: draft.highlightResponse,
    scope: "global" as const,
  };
}

// ── Command card ────────────────────────────────────────────────

function CommandCard({
  draft,
  onChange,
  nameError,
  promptError,
  onDelete,
}: {
  draft: CommandDraft;
  onChange: (draft: CommandDraft) => void;
  nameError: string | null;
  promptError: string | null;
  onDelete: (() => void) | null;
}) {
  const idSuffix = draft.name || "new";

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <div className="space-y-0">
        {/* Name */}
        <div className="px-4 py-3 sm:px-5">
          <label className="block" htmlFor={`cmd-name-${idSuffix}`}>
            <span className="text-xs font-medium text-foreground">Name</span>
            <Input
              id={`cmd-name-${idSuffix}`}
              className="mt-1.5"
              value={draft.name ? `/${draft.name}` : ""}
              onChange={(event) => {
                const raw = event.target.value;
                onChange({ ...draft, name: raw.startsWith("/") ? raw.slice(1) : raw });
              }}
              placeholder="/handoff"
              spellCheck={false}
              aria-label="Command name"
            />
            {nameError ? (
              <span className="mt-1 block text-xs text-destructive">{nameError}</span>
            ) : null}
          </label>
        </div>

        {/* Description */}
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <label className="block" htmlFor={`cmd-desc-${idSuffix}`}>
            <span className="text-xs font-medium text-foreground">Description</span>
            <Input
              id={`cmd-desc-${idSuffix}`}
              className="mt-1.5"
              value={draft.description}
              onChange={(event) => onChange({ ...draft, description: event.target.value })}
              placeholder="Shown in the slash command menu"
              spellCheck={false}
              aria-label="Command description"
            />
          </label>
        </div>

        {/* Prompt message */}
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <label className="block" htmlFor={`cmd-prompt-${idSuffix}`}>
            <span className="text-xs font-medium text-foreground">Prompt message</span>
            <Textarea
              id={`cmd-prompt-${idSuffix}`}
              className="mt-1.5"
              size="lg"
              value={draft.promptMessage}
              onChange={(event) => onChange({ ...draft, promptMessage: event.target.value })}
              placeholder="The prompt text sent when this command is invoked..."
              spellCheck={false}
              aria-label="Prompt message"
            />
          </label>
        </div>

        {/* Prompt file */}
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <label className="block" htmlFor={`cmd-file-${idSuffix}`}>
            <span className="text-xs font-medium text-foreground">Prompt file</span>
            <Input
              id={`cmd-file-${idSuffix}`}
              className="mt-1.5"
              value={draft.promptFile}
              onChange={(event) => onChange({ ...draft, promptFile: event.target.value })}
              placeholder="/absolute/path/to/prompt.md"
              spellCheck={false}
              aria-label="Prompt file path"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Absolute path to a file whose contents are prepended to the prompt message.
            </span>
          </label>
          {promptError ? <p className="mt-2 text-xs text-destructive">{promptError}</p> : null}
        </div>

        {/* Highlight toggle + delete */}
        <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 sm:px-5">
          <label className="flex items-center gap-2.5" htmlFor={`cmd-highlight-${idSuffix}`}>
            <Switch
              id={`cmd-highlight-${idSuffix}`}
              checked={draft.highlightResponse}
              onCheckedChange={(checked) =>
                onChange({ ...draft, highlightResponse: Boolean(checked) })
              }
              aria-label="Highlight response"
            />
            <span className="text-xs text-muted-foreground">Highlight response</span>
          </label>

          {onDelete ? (
            <Button
              size="xs"
              variant="destructive-outline"
              onClick={onDelete}
              aria-label={`Delete /${draft.name}`}
            >
              <Trash2Icon className="size-3.5" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

export function CommandsSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  const commands = settings.customSlashCommands;
  const existingNames = commands.map((cmd) => cmd.name);

  // Editing state: index of the command being edited, or null
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<CommandDraft>(EMPTY_DRAFT);
  const [editErrors, setEditErrors] = useState<{ name: string | null; prompt: string | null }>({
    name: null,
    prompt: null,
  });

  // New command state
  const [isAdding, setIsAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<CommandDraft>(EMPTY_DRAFT);
  const [newErrors, setNewErrors] = useState<{ name: string | null; prompt: string | null }>({
    name: null,
    prompt: null,
  });

  const saveCommand = useCallback(
    (draft: CommandDraft, index: number | null): boolean => {
      const nameErr = validateCommandName(draft.name, existingNames, index);
      const hasPrompt = draft.promptMessage.trim() || draft.promptFile.trim();
      const promptErr = hasPrompt
        ? null
        : "At least one of prompt message or prompt file is required.";
      const descErr = draft.description.trim() ? null : "Description is required.";

      if (nameErr || promptErr || descErr) {
        const errors = { name: nameErr || descErr, prompt: promptErr };
        if (index !== null) {
          setEditErrors(errors);
        } else {
          setNewErrors(errors);
        }
        return false;
      }

      const cmd = draftToCommand(draft);
      const updated = [...commands];
      if (index !== null) {
        updated[index] = cmd;
      } else {
        updated.push(cmd);
      }
      updateSettings({ customSlashCommands: updated });
      return true;
    },
    [commands, existingNames, updateSettings],
  );

  const handleStartEditing = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setEditDraft(draftFromCommand(commands[index]!));
      setEditErrors({ name: null, prompt: null });
    },
    [commands],
  );

  const handleSaveEdit = useCallback(() => {
    if (editingIndex === null) return;
    if (saveCommand(editDraft, editingIndex)) {
      setEditingIndex(null);
      setEditDraft(EMPTY_DRAFT);
    }
  }, [editDraft, editingIndex, saveCommand]);

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditDraft(EMPTY_DRAFT);
    setEditErrors({ name: null, prompt: null });
  }, []);

  const handleAddNew = useCallback(() => {
    if (saveCommand(newDraft, null)) {
      setNewDraft(EMPTY_DRAFT);
      setNewErrors({ name: null, prompt: null });
      setIsAdding(false);
    }
  }, [newDraft, saveCommand]);

  const handleDelete = useCallback(
    (index: number) => {
      const updated = commands.filter((_, i) => i !== index);
      updateSettings({ customSlashCommands: updated });
      if (editingIndex === index) {
        setEditingIndex(null);
        setEditDraft(EMPTY_DRAFT);
      }
    },
    [commands, editingIndex, updateSettings],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Custom Slash Commands"
        headerAction={
          !isAdding && editingIndex === null ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsAdding(true);
                setNewDraft(EMPTY_DRAFT);
                setNewErrors({ name: null, prompt: null });
              }}
            >
              <PlusIcon className="size-3.5" />
              Add command
            </Button>
          ) : null
        }
      >
        {commands.length === 0 && !isAdding ? (
          <div className="px-4 py-8 text-center sm:px-5">
            <p className="py-3 text-sm text-muted-foreground/80">Create a saved prompt shortcut.</p>
          </div>
        ) : null}

        {/* Existing commands */}
        {commands.map((cmd, index) =>
          editingIndex === index ? (
            <div key={cmd.name}>
              <CommandCard
                draft={editDraft}
                onChange={(draft) => {
                  setEditDraft(draft);
                  setEditErrors({ name: null, prompt: null });
                }}
                nameError={editErrors.name}
                promptError={editErrors.prompt}
                onDelete={() => handleDelete(index)}
              />
              <div className="flex justify-end gap-2 border-t border-border/40 px-4 py-3 sm:px-5">
                <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveEdit}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div
              key={cmd.name}
              className="group cursor-pointer border-t border-border/60 first:border-t-0"
              onClick={() => handleStartEditing(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleStartEditing(index);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="flex items-center justify-between px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                      /{cmd.name}
                    </span>
                    {cmd.highlightResponse ? (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary/70">
                        highlight
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground/80">{cmd.description}</p>
                </div>
                <span className="text-xs text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100">
                  Click to edit
                </span>
              </div>
            </div>
          ),
        )}

        {/* New command form */}
        {isAdding ? (
          <div>
            <CommandCard
              draft={newDraft}
              onChange={(draft) => {
                setNewDraft(draft);
                setNewErrors({ name: null, prompt: null });
              }}
              nameError={newErrors.name}
              promptError={newErrors.prompt}
              onDelete={null}
            />
            <div className="flex justify-end gap-2 border-t border-border/40 px-4 py-3 sm:px-5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setIsAdding(false);
                  setNewDraft(EMPTY_DRAFT);
                  setNewErrors({ name: null, prompt: null });
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleAddNew}>
                Add
              </Button>
            </div>
          </div>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
