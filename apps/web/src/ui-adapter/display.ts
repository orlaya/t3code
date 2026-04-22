import type {
  CanonicalDisplayCapabilities,
  CanonicalDisplayKind,
  CanonicalLifecycleShape,
  CanonicalToolData,
  ToolLifecycleItemType,
} from "@t3tools/contracts";

import { getLifecycleMap } from "./lifecycle";

export interface CanonicalToolDisplayPresentation {
  displayKind: CanonicalDisplayKind;
  lifecycleShape: CanonicalLifecycleShape;
  capabilities: CanonicalDisplayCapabilities;
  heading: string;
}

const DISPLAY_CAPABILITIES: Record<CanonicalDisplayKind, CanonicalDisplayCapabilities> = {
  command: {
    hasProgressState: true,
    hasResultText: true,
    hasCommandPreview: true,
  },
  edit: {
    hasProgressState: true,
    hasFilePathPreview: true,
    hasInlineDiffs: true,
  },
  write: {
    hasProgressState: true,
    hasFilePathPreview: true,
  },
  "file-read": {
    hasProgressState: true,
    hasFilePathPreview: true,
    hasResultText: true,
  },
  "file-search": {
    hasProgressState: true,
    hasFilePathPreview: true,
    hasResultText: true,
  },
  "web-search": {
    hasProgressState: true,
    hasResultText: true,
  },
  "web-fetch": {
    hasProgressState: true,
    hasResultText: true,
  },
  "tool-call": {
    hasProgressState: true,
    hasResultText: true,
  },
  "sub-agent": {
    hasProgressState: true,
    hasResultText: true,
  },
  "mcp-tool": {
    hasProgressState: true,
    hasResultText: true,
  },
  image: {
    hasProgressState: true,
  },
  "approval-command": {
    hasCommandPreview: true,
    hasApprovalDecision: true,
  },
  "approval-file-read": {
    hasFilePathPreview: true,
    hasApprovalDecision: true,
  },
  "approval-edit": {
    hasFilePathPreview: true,
    hasInlineDiffs: true,
    hasApprovalDecision: true,
  },
};

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase();
}

function displayKindFromTool(input: CanonicalToolData): CanonicalDisplayKind {
  switch (input.itemType) {
    case "command_execution":
      return "command";
    case "file_change":
      return normalizeToolName(input.toolName) === "write" ? "write" : "edit";
    case "collab_agent_tool_call":
      return "sub-agent";
    case "mcp_tool_call":
      return "mcp-tool";
    case "image_view":
      return "image";
    case "web_search":
      return "web-search";
    case "dynamic_tool_call": {
      const toolName = normalizeToolName(input.toolName);
      if (toolName === "read" || toolName === "read file") {
        return "file-read";
      }
      if (toolName === "grep" || toolName === "glob") {
        return "file-search";
      }
      if (toolName === "webfetch") {
        return "web-fetch";
      }
      if (
        input.input?.file_path &&
        !input.input.command &&
        !input.input.query &&
        !input.input.url &&
        !input.input.pattern
      ) {
        return "file-read";
      }
      if (input.input?.pattern) {
        return "file-search";
      }
      if (input.input?.url && !input.input.query) {
        return "web-fetch";
      }
      if (input.input?.url || input.input?.query) {
        return "web-search";
      }
      return "tool-call";
    }
  }
}

function headingFromDisplayKind(
  displayKind: CanonicalDisplayKind,
  input: CanonicalToolData,
): string {
  switch (displayKind) {
    case "command":
      return "Command";
    case "edit":
      return "Edit";
    case "write":
      return "Write";
    case "file-read":
      return "Read";
    case "file-search": {
      const tool = normalizeToolName(input.toolName);
      if (tool === "grep") return "Grep";
      if (tool === "glob") return "Glob";
      return "Search";
    }
    case "web-search":
      return "Search";
    case "web-fetch":
      return "Fetch";
    case "tool-call":
      return "Tool call";
    case "sub-agent":
      return "Sub-agent";
    case "mcp-tool":
      return "MCP Tool";
    case "image":
      return "Image";
    case "approval-command":
      return "Command Approval";
    case "approval-file-read":
      return "Read Approval";
    case "approval-edit":
      return "Edit Approval";
  }
}

function lifecycleShapeFromItemType(
  providerName: string,
  itemType: ToolLifecycleItemType,
): CanonicalLifecycleShape {
  const declaration = getLifecycleMap(providerName)?.[itemType];
  if (!declaration) {
    return "result-only";
  }

  const events = declaration.events;
  if (
    events.length === 3 &&
    events[0] === "tool.started" &&
    events[1] === "tool.updated" &&
    events[2] === "tool.completed"
  ) {
    return "started-updated-completed";
  }
  if (events.length === 2 && events[0] === "tool.updated" && events[1] === "tool.completed") {
    return "updated-completed";
  }

  return declaration.lifecycle === "request-response" ? "request-response" : "result-only";
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

export function resolveToolDisplayPresentation(input: {
  tool: CanonicalToolData;
  providerName: string;
}): CanonicalToolDisplayPresentation {
  const displayKind = displayKindFromTool(input.tool);
  return {
    displayKind,
    lifecycleShape: lifecycleShapeFromItemType(input.providerName, input.tool.itemType),
    capabilities: DISPLAY_CAPABILITIES[displayKind],
    heading: headingFromDisplayKind(displayKind, input.tool),
  };
}
