import type {
  CanonicalInlineDiff,
  CanonicalToolData,
  CanonicalToolInput,
  CanonicalToolResult,
} from "@t3tools/contracts";
import { isToolLifecycleItemType } from "@t3tools/contracts";

import { asString, isRecord } from "../helpers";

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): ReadonlyArray<unknown> | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asChangeKind(value: unknown): CanonicalInlineDiff["changeKind"] {
  switch (value) {
    case "add":
    case "update":
    case "delete":
    case "move":
      return value;
    default:
      return "update";
  }
}

function extractFirstAnchorLine(value: string | undefined): number | undefined {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(value ?? "");
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPatchPath(filePath: string, side: "a" | "b"): string {
  return filePath.startsWith("/") ? `${side}${filePath}` : `${side}/${filePath}`;
}

function buildPatchHeaders(
  filePath: string,
  changeKind: CanonicalInlineDiff["changeKind"],
): { oldHeader: string; newHeader: string } {
  if (changeKind === "add") {
    return {
      oldHeader: "--- /dev/null",
      newHeader: `+++ ${toPatchPath(filePath, "b")}`,
    };
  }
  if (changeKind === "delete") {
    return {
      oldHeader: `--- ${toPatchPath(filePath, "a")}`,
      newHeader: "+++ /dev/null",
    };
  }
  return {
    oldHeader: `--- ${toPatchPath(filePath, "a")}`,
    newHeader: `+++ ${toPatchPath(filePath, "b")}`,
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function toUnifiedPatch(
  filePath: string,
  changeKind: CanonicalInlineDiff["changeKind"],
  diff: string,
): string {
  const normalizedDiff = ensureTrailingNewline(diff);
  if (
    normalizedDiff.startsWith("diff --git") ||
    normalizedDiff.startsWith("--- ") ||
    normalizedDiff.startsWith("@@ ")
  ) {
    if (normalizedDiff.startsWith("@@ ")) {
      const headers = buildPatchHeaders(filePath, changeKind);
      return [
        `diff --git ${toPatchPath(filePath, "a")} ${toPatchPath(filePath, "b")}`,
        headers.oldHeader,
        headers.newHeader,
        normalizedDiff,
      ].join("\n");
    }
    return normalizedDiff;
  }

  return normalizedDiff;
}

function toolNameFromItemType(value: string | undefined): string {
  switch (value) {
    case "commandExecution":
      return "Command";
    case "fileChange":
      return "ApplyPatch";
    case "mcpToolCall":
      return "MCP";
    case "dynamicToolCall":
      return "Tool";
    case "collabToolCall":
      return "Agent";
    case "webSearch":
      return "WebSearch";
    case "imageView":
      return "ImageView";
    default:
      return "unknown";
  }
}

function extractFileChangePaths(item: Record<string, unknown> | undefined): string[] {
  const changes = asArray(item?.changes);
  if (!changes) {
    return [];
  }
  return changes
    .map((entry) => (isRecord(entry) ? asString(entry.path) : undefined))
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function firstDetail(
  payload: Record<string, unknown>,
  item: Record<string, unknown> | undefined,
): string | undefined {
  const direct = asString(payload.detail);
  if (direct) {
    return direct;
  }

  const command = asString(item?.command);
  if (command) {
    return command;
  }

  const firstPath = extractFileChangePaths(item)[0];
  if (firstPath) {
    return firstPath;
  }

  return asString(item?.query) ?? asString(item?.path);
}

function extractInput(item: Record<string, unknown> | undefined): CanonicalToolInput | undefined {
  if (!item) {
    return undefined;
  }

  const input: CanonicalToolInput = {};
  const command = asString(item.command);
  if (command) {
    input.command = command;
  }

  const firstPath = extractFileChangePaths(item)[0] ?? asString(item.path);
  if (firstPath) {
    input.file_path = firstPath;
  }

  return Object.keys(input).length > 0 ? input : undefined;
}

function extractResult(item: Record<string, unknown> | undefined): CanonicalToolResult | undefined {
  if (!item) {
    return undefined;
  }

  const result: CanonicalToolResult = {};
  const aggregatedOutput = asString(item.aggregatedOutput);
  if (aggregatedOutput) {
    result.content = aggregatedOutput;
  }
  const exitCode = asNumber(item.exitCode);
  if (exitCode !== undefined) {
    result.exitCode = exitCode;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function extractCodexToolData(payload: unknown): CanonicalToolData | null {
  if (!isRecord(payload)) {
    return null;
  }

  const itemType = asString(payload.itemType);
  if (!itemType || !isToolLifecycleItemType(itemType)) {
    return null;
  }

  const data = isRecord(payload.data) ? payload.data : undefined;
  const item = isRecord(data?.item) ? data.item : undefined;
  const toolName = toolNameFromItemType(asString(item?.type));
  const detail = firstDetail(payload, item);
  const status = asString(payload.status);
  const toolCallId = asString(item?.id);
  const input = extractInput(item);
  const result = extractResult(item);

  return {
    toolName,
    itemType,
    ...(detail ? { detail } : {}),
    ...(status ? { status } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(input ? { input } : {}),
    ...(result ? { result } : {}),
  };
}

export function extractCodexInlineDiffs(payload: unknown): CanonicalInlineDiff[] {
  if (!isRecord(payload) || payload.itemType !== "file_change") {
    return [];
  }

  const data = isRecord(payload.data) ? payload.data : undefined;
  const item = isRecord(data?.item) ? data.item : undefined;
  if (!item || item.type !== "fileChange") {
    return [];
  }

  const toolCallId = asString(item.id);
  const changes = asArray(item.changes);
  if (!changes) {
    return [];
  }

  return changes.flatMap<CanonicalInlineDiff>((entry): CanonicalInlineDiff[] => {
    const change = isRecord(entry) ? entry : undefined;
    const filePath = asString(change?.path);
    if (!filePath) {
      return [];
    }

    const kind = isRecord(change?.kind) ? change.kind : undefined;
    const changeKind = asChangeKind(kind?.type);
    const movePath = asString(kind?.move_path) ?? asString(kind?.movePath);
    const diff = asString(change?.diff);

    if (changeKind === "add" && typeof diff === "string") {
      return [
        {
          filePath,
          ...(toolCallId ? { toolCallId } : {}),
          toolName: "ApplyPatch",
          changeKind,
          source: "before_after",
          oldString: "",
          newString: diff,
          anchorLine: 1,
        },
      ];
    }

    const unifiedPatch =
      typeof diff === "string" && diff.length > 0
        ? toUnifiedPatch(filePath, changeKind, diff)
        : undefined;
    const anchorLine = extractFirstAnchorLine(unifiedPatch ?? diff);

    return [
      {
        filePath,
        ...(toolCallId ? { toolCallId } : {}),
        toolName: "ApplyPatch",
        changeKind,
        source: unifiedPatch ? "patch" : "before_after",
        ...(unifiedPatch ? { unifiedPatch } : {}),
        ...(movePath ? { movePath } : {}),
        ...(anchorLine !== undefined ? { anchorLine } : {}),
      },
    ];
  });
}
