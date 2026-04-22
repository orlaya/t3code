import type { WorkLogEntry } from "../../session-logic/index";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { normalizeCompactToolLabel } from "../../ui-adapter";
import { formatToolCallPreview } from "./toolCallDisplay";
import {
  EyeIcon,
  GlobeIcon,
  LinkIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  type LucideIcon,
  WrenchIcon,
} from "lucide-react";

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function workEntryHeading(
  workEntry: Pick<WorkLogEntry, "displayHeading" | "toolTitle" | "label">,
): string {
  if (workEntry.displayHeading) {
    return workEntry.displayHeading;
  }
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

export function workEntryPreview(
  workEntry: Pick<
    WorkLogEntry,
    "detail" | "command" | "changedFiles" | "displayKind" | "itemType" | "requestKind"
  >,
  workspaceRoot: string | undefined,
): string | null {
  if (workEntry.command) return workEntry.command;

  if (
    workEntry.detail &&
    (workEntry.displayKind === "tool-call" ||
      workEntry.displayKind === "web-search" ||
      workEntry.displayKind === "web-fetch" ||
      workEntry.requestKind === "tool-call" ||
      workEntry.itemType === "dynamic_tool_call" ||
      workEntry.itemType === "web_search")
  ) {
    return formatToolCallPreview(workEntry.detail) ?? workEntry.detail;
  }

  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;

  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;

  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

export function workEntryRawCommand(
  workEntry: Pick<WorkLogEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

export function resolveWorkEntryIcon(
  workEntry: Pick<
    WorkLogEntry,
    "command" | "changedFiles" | "displayKind" | "itemType" | "requestKind"
  >,
): LucideIcon | null {
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return SearchIcon;
  if (workEntry.requestKind === "file-change") return PencilIcon;

  switch (workEntry.displayKind) {
    case "command":
      return TerminalIcon;
    case "edit":
    case "write":
      return PencilIcon;
    case "file-read":
    case "file-search":
      return SearchIcon;
    case "web-search":
      return GlobeIcon;
    case "web-fetch":
      return LinkIcon;
    case "tool-call":
      return SearchIcon;
    case "sub-agent":
      return SearchIcon;
    case "mcp-tool":
      return WrenchIcon;
    case "image":
      return EyeIcon;
  }

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change") return PencilIcon;
  if ((workEntry.changedFiles?.length ?? 0) > 0) {
    return SearchIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return SearchIcon;
    default:
      return null;
  }
}
