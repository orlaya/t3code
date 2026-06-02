/**
 * Display helpers for shell commands surfaced by any provider.
 *
 * Provider assembly decides where the command came from; this module only
 * understands command-line syntax well enough to hide shell wrappers and
 * recognise common read-shaped commands.
 */

export interface DisplayCommand {
  command: string;
  rawCommand?: string;
}

export interface ParsedReadCommand {
  kind: "read";
  tool: "sed" | "cat";
  filePath?: string;
  filePaths?: ReadonlyArray<string>;
  lineStart?: number;
  lineEnd?: number;
}

export interface ParsedGrepCommand {
  kind: "grep";
  tool: "rg";
  heading: "Grep";
  command: string;
}

export interface ParsedOutlineCommand {
  kind: "outline";
  heading: "Outline";
  detail: string;
}

export type ParsedDisplayCommand = ParsedReadCommand | ParsedGrepCommand | ParsedOutlineCommand;

function trimMatchingOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    const unquoted = trimmed.slice(1, -1).trim();
    return unquoted.length > 0 ? unquoted : trimmed;
  }
  return trimmed;
}

function executableBasename(value: string): string | null {
  const trimmed = trimMatchingOuterQuotes(value);
  if (trimmed.length === 0) return null;
  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const last = segments.at(-1)?.trim() ?? "";
  return last.length > 0 ? last.toLowerCase() : null;
}

function splitExecutableAndRest(value: string): { executable: string; rest: string } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const quote = trimmed.charAt(0);
    const closeIndex = trimmed.indexOf(quote, 1);
    if (closeIndex <= 0) return null;
    return {
      executable: trimmed.slice(0, closeIndex + 1),
      rest: trimmed.slice(closeIndex + 1).trim(),
    };
  }

  const firstWhitespace = trimmed.search(/\s/);
  if (firstWhitespace < 0) return { executable: trimmed, rest: "" };

  return {
    executable: trimmed.slice(0, firstWhitespace),
    rest: trimmed.slice(firstWhitespace).trim(),
  };
}

const SHELL_WRAPPER_SPECS = [
  {
    executables: ["pwsh", "pwsh.exe", "powershell", "powershell.exe"],
    wrapperFlagPattern: /(?:^|\s)-command\s+/i,
  },
  {
    executables: ["cmd", "cmd.exe"],
    wrapperFlagPattern: /(?:^|\s)\/c\s+/i,
  },
  {
    executables: ["bash", "sh", "zsh"],
    wrapperFlagPattern: /(?:^|\s)-(?:l)?c\s+/i,
  },
] as const;

function unwrapKnownShellCommandWrapper(value: string): string {
  const split = splitExecutableAndRest(value);
  if (!split || split.rest.length === 0) return value;

  const shell = executableBasename(split.executable);
  if (!shell) return value;

  const spec = SHELL_WRAPPER_SPECS.find((s) =>
    (s.executables as ReadonlyArray<string>).includes(shell),
  );
  if (!spec) return value;

  const match = spec.wrapperFlagPattern.exec(split.rest);
  if (!match) return value;

  const command = split.rest.slice(match.index + match[0].length).trim();
  if (command.length === 0) return value;

  const commandWords = parseShellWords(command);
  const unwrapped =
    commandWords && commandWords.length === 1 ? commandWords[0]! : trimMatchingOuterQuotes(command);
  return unwrapped.length > 0 ? unwrapped : value;
}

export function formatCommandForDisplay(command: string): DisplayCommand {
  const normalized = unwrapKnownShellCommandWrapper(command);
  const result: DisplayCommand = { command: normalized };
  if (normalized !== command) result.rawCommand = command;
  return result;
}

function parseShellWords(command: string): string[] | null {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      started = true;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\" && index + 1 < command.length) {
        index += 1;
        current += command[index]!;
      } else {
        current += char;
      }
      started = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (started) {
        words.push(current);
        current = "";
        started = false;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }

    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      current += command[index]!;
      started = true;
      continue;
    }

    current += char;
    started = true;
  }

  if (quote) return null;
  if (started) words.push(current);
  return words;
}

function parseSedRange(script: string): Pick<ParsedReadCommand, "lineStart" | "lineEnd"> | null {
  const rangeMatch = script.match(/^(\d+),(\d+)p$/);
  if (rangeMatch) {
    const lineStart = Number.parseInt(rangeMatch[1]!, 10);
    const lineEnd = Number.parseInt(rangeMatch[2]!, 10);
    if (lineStart > 0 && lineEnd >= lineStart) return { lineStart, lineEnd };
    return null;
  }

  const singleLineMatch = script.match(/^(\d+)p$/);
  if (singleLineMatch) {
    const line = Number.parseInt(singleLineMatch[1]!, 10);
    if (line > 0) return { lineStart: line, lineEnd: line };
  }

  return null;
}

function parseReadCommand(command: string, words: ReadonlyArray<string>): ParsedReadCommand | null {
  const catRead = parseCatReadCommand(words);
  if (catRead) return catRead;

  if (!words || words.length < 4) return null;

  const executable = executableBasename(words[0]!);
  if (executable !== "sed" && executable !== "gsed") return null;

  let sawQuiet = false;
  let script: string | undefined;
  let filePath: string | undefined;

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]!;
    if (word === "--") {
      filePath = words[index + 1];
      break;
    }
    if (!sawQuiet && /^-[A-Za-z]*n[A-Za-z]*$/.test(word)) {
      sawQuiet = true;
      continue;
    }
    if (!script) {
      script = word;
      continue;
    }
    filePath = word;
    break;
  }

  if (!sawQuiet || !script || !filePath) return null;
  const range = parseSedRange(script);
  if (!range) return null;

  return {
    kind: "read",
    tool: "sed",
    filePath,
    ...range,
  };
}

function parseCatReadCommand(words: ReadonlyArray<string>): ParsedReadCommand | null {
  if (words.length < 2) return null;
  const executable = executableBasename(words[0]!);
  if (executable !== "cat") return null;

  const filePaths = words.slice(1);
  if (filePaths.length === 0) return null;
  if (filePaths.some((word) => word.length === 0 || word.startsWith("-") || word === "-")) {
    return null;
  }

  return {
    kind: "read",
    tool: "cat",
    ...(filePaths.length === 1 ? { filePath: filePaths[0]! } : {}),
    filePaths,
  };
}

function parseGrepCommand(command: string, words: ReadonlyArray<string>): ParsedGrepCommand | null {
  const executable = executableBasename(words[0] ?? "");
  if (executable !== "rg" && executable !== "ripgrep") return null;

  return {
    kind: "grep",
    tool: "rg",
    heading: "Grep",
    command,
  };
}

function parseOutlineCommand(words: ReadonlyArray<string>): ParsedOutlineCommand | null {
  const executable = executableBasename(words[0] ?? "");
  if (executable !== "frank") return null;
  if (words[1] !== "outline") return null;

  const detail = words.slice(2).join(" ").trim();
  if (detail.length === 0) return null;

  return {
    kind: "outline",
    heading: "Outline",
    detail,
  };
}

export function parseCommandForDisplay(command: string): ParsedDisplayCommand | null {
  const displayCommand = formatCommandForDisplay(command).command;
  const words = parseShellWords(displayCommand);
  if (!words || words.length === 0) return null;

  return (
    parseReadCommand(displayCommand, words) ??
    parseGrepCommand(displayCommand, words) ??
    parseOutlineCommand(words)
  );
}
