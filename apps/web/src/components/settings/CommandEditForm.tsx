import { Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";
import type { CustomSlashCommand } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
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

// ── Draft state ────────────────────────────────────────────────

interface CommandDraft {
  name: string;
  description: string;
  promptMessage: string;
  promptFile: string;
  extraTextPosition: "before" | "after";
}

const EMPTY_DRAFT: CommandDraft = {
  name: "",
  description: "",
  promptMessage: "",
  promptFile: "",
  extraTextPosition: "after",
};

function draftFromCommand(cmd: CustomSlashCommand): CommandDraft {
  return {
    name: cmd.name,
    description: cmd.description,
    promptMessage: cmd.promptMessage ?? "",
    promptFile: cmd.promptFile ?? "",
    extraTextPosition: cmd.extraTextPosition,
  };
}

function draftToCommand(draft: CommandDraft): CustomSlashCommand {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    ...(draft.promptMessage.trim() ? { promptMessage: draft.promptMessage.trim() } : {}),
    ...(draft.promptFile.trim() ? { promptFile: draft.promptFile.trim() } : {}),
    extraTextPosition: draft.extraTextPosition,
    scope: "global" as const,
  };
}

// ── Form ───────────────────────────────────────────────────────

interface CommandEditFormProps {
  /** Name of the command being edited. Undefined = new command. */
  commandName?: string;
}

export function CommandEditForm({ commandName }: CommandEditFormProps) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const navigate = useNavigate();

  const commands = settings.customSlashCommands;
  const existingNames = commands.map((cmd) => cmd.name);
  const editingIndex = commandName ? commands.findIndex((cmd) => cmd.name === commandName) : null;
  const isEdit = editingIndex !== null && editingIndex !== -1;

  const [draft, setDraft] = useState<CommandDraft>(() => {
    if (isEdit) return draftFromCommand(commands[editingIndex]!);
    return EMPTY_DRAFT;
  });

  const [errors, setErrors] = useState<{ name: string | null; prompt: string | null }>({
    name: null,
    prompt: null,
  });

  const handleSave = useCallback(() => {
    const nameErr = validateCommandName(draft.name, existingNames, isEdit ? editingIndex : null);
    const hasPrompt = draft.promptMessage.trim() || draft.promptFile.trim();
    const promptErr = hasPrompt
      ? null
      : "At least one of prompt message or prompt file is required.";
    const descErr = draft.description.trim() ? null : "Description is required.";

    if (nameErr || promptErr || descErr) {
      setErrors({ name: nameErr || descErr, prompt: promptErr });
      return;
    }

    const cmd = draftToCommand(draft);
    const updated = [...commands];
    if (isEdit) {
      updated[editingIndex] = cmd;
    } else {
      updated.push(cmd);
    }
    updateSettings({ customSlashCommands: updated });
    void navigate({ to: "/settings/commands" });
  }, [draft, existingNames, isEdit, editingIndex, commands, updateSettings, navigate]);

  const handleDelete = useCallback(() => {
    if (!isEdit) return;
    const updated = commands.filter((_, i) => i !== editingIndex);
    updateSettings({ customSlashCommands: updated });
    void navigate({ to: "/settings/commands" });
  }, [isEdit, editingIndex, commands, updateSettings, navigate]);

  const idSuffix = draft.name || "new";

  return (
    <SettingsPageContainer>
      <div className="space-y-6 py-2">
        {/* ── Identity ──────────────────────────────────────── */}
        <SettingsSection title="Identity">
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
                  setDraft({ ...draft, name: raw.startsWith("/") ? raw.slice(1) : raw });
                  setErrors({ name: null, prompt: null });
                }}
                placeholder="/handoff"
                spellCheck={false}
                aria-label="Command name"
              />
              {errors.name ? (
                <span className="mt-1 block text-xs text-destructive">{errors.name}</span>
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
                onChange={(event) => {
                  setDraft({ ...draft, description: event.target.value });
                  setErrors({ name: null, prompt: null });
                }}
                placeholder="Shown in the slash command menu"
                spellCheck={false}
                aria-label="Command description"
              />
            </label>
          </div>
        </SettingsSection>

        {/* ── Prompt ────────────────────────────────────────── */}
        <SettingsSection title="Prompt">
          {/* Prompt message */}
          <div className="px-4 py-3 sm:px-5">
            <label className="block" htmlFor={`cmd-prompt-${idSuffix}`}>
              <span className="text-xs font-medium text-foreground">Prompt message</span>
              <Textarea
                id={`cmd-prompt-${idSuffix}`}
                className="mt-1.5"
                size="lg"
                value={draft.promptMessage}
                onChange={(event) => {
                  setDraft({ ...draft, promptMessage: event.target.value });
                  setErrors({ name: null, prompt: null });
                }}
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
                onChange={(event) => {
                  setDraft({ ...draft, promptFile: event.target.value });
                  setErrors({ name: null, prompt: null });
                }}
                placeholder="/absolute/path/to/prompt.md"
                spellCheck={false}
                aria-label="Prompt file path"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Absolute path to a file whose contents are prepended to the prompt message.
              </span>
            </label>
            {errors.prompt ? (
              <p className="mt-2 text-xs text-destructive">{errors.prompt}</p>
            ) : null}
          </div>
        </SettingsSection>

        {/* ── Options ───────────────────────────────────────── */}
        <SettingsSection title="Options">
          <div className="flex items-center justify-between px-4 py-3 sm:px-5">
            <div>
              <span className="text-xs font-medium text-foreground">Extra text position</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Where text typed after the command is placed relative to the prompt.
              </p>
            </div>
            <Select
              value={draft.extraTextPosition}
              onValueChange={(value) => {
                if (value === "before" || value === "after") {
                  setDraft({ ...draft, extraTextPosition: value });
                }
              }}
            >
              <SelectTrigger className="w-36" aria-label="Extra text position">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">Before prompt</SelectItem>
                <SelectItem value="after">After prompt</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </SettingsSection>

        {/* ── Actions ───────────────────────────────────────── */}
        <div className="flex items-center justify-between px-1">
          {isEdit ? (
            <Button
              size="xs"
              variant="destructive-outline"
              onClick={handleDelete}
              aria-label={`Delete /${draft.name}`}
            >
              <Trash2Icon className="size-3.5" />
              Delete
            </Button>
          ) : (
            <div />
          )}
          <Button size="sm" onClick={handleSave}>
            {isEdit ? "Save" : "Add command"}
          </Button>
        </div>
      </div>
    </SettingsPageContainer>
  );
}
