/**
 * File outline extraction using tree-sitter.
 *
 * When a file exceeds a size threshold, instead of returning the full content
 * we parse it with tree-sitter and return a structural outline showing
 * symbol names and line ranges. This saves agent context while still giving
 * them enough information to request specific sections.
 *
 * Outline queries are adapted from Zed's open-source grammar definitions.
 */

import Parser from "web-tree-sitter";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

/** Files at or above this byte size get condensed to an outline. */
export const AUTO_OUTLINE_THRESHOLD_BYTES = 16_384;

// ---------------------------------------------------------------------------
// Language → grammar mapping
// ---------------------------------------------------------------------------

/** Map file extensions to tree-sitter grammar names (as used by tree-sitter-wasms). */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".md": "markdown",
  ".mdx": "markdown",
  ".rs": "rust",
  ".py": "python",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "c_sharp",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".lua": "lua",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".dart": "dart",
  ".zig": "zig",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".php": "php",
  ".scala": "scala",
  ".sc": "scala",
  ".elm": "elm",
  ".ex": "elixir",
  ".exs": "elixir",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".vue": "vue",
  ".sol": "solidity",
};

// ---------------------------------------------------------------------------
// Outline queries (adapted from Zed)
// ---------------------------------------------------------------------------

const OUTLINE_QUERIES: Record<string, string> = {
  typescript: `
(internal_module
  "namespace" @context
  name: (_) @name) @item

(enum_declaration
  "enum" @context
  name: (_) @name) @item

(type_alias_declaration
  "type" @context
  name: (_) @name) @item

(function_declaration
  "async"? @context
  "function" @context
  name: (_) @name) @item

(interface_declaration
  "interface" @context
  name: (_) @name) @item

(export_statement
  (lexical_declaration
    ["let" "const"] @context
    (variable_declarator
      name: (identifier) @name) @item))

(program
  (lexical_declaration
    ["let" "const"] @context
    (variable_declarator
      name: (identifier) @name) @item))

(class_declaration
  "class" @context
  name: (_) @name) @item

(abstract_class_declaration
  "abstract" @context
  "class" @context
  name: (_) @name) @item

(class_body
  (method_definition
    ["get" "set" "async" "*" "readonly" "static" (override_modifier) (accessibility_modifier)]* @context
    name: (_) @name) @item)

(public_field_definition
  ["declare" "readonly" "abstract" "static" (accessibility_modifier)]* @context
  name: (_) @name) @item
`,

  javascript: `
(function_declaration
  "async"? @context
  "function" @context
  name: (_) @name) @item

(export_statement
  (lexical_declaration
    ["let" "const"] @context
    (variable_declarator
      name: (identifier) @name) @item))

(program
  (lexical_declaration
    ["let" "const"] @context
    (variable_declarator
      name: (identifier) @name) @item))

(class_declaration
  "class" @context
  name: (_) @name) @item

(class_body
  (method_definition
    ["get" "set" "async" "*"]* @context
    name: (_) @name) @item)
`,

  markdown: `
(section
  (atx_heading
    .
    (_) @context
    .
    (_) @name)) @item
`,
};

// TSX uses the same query as TypeScript
OUTLINE_QUERIES.tsx = OUTLINE_QUERIES.typescript!;

// ---------------------------------------------------------------------------
// Parser singleton & caches
// ---------------------------------------------------------------------------

let parserReady: Promise<void> | null = null;
let parserInstance: Parser | null = null;

const languageCache = new Map<string, Parser.Language>();
const queryCache = new Map<string, Parser.Query>();

/**
 * Resolve the path to a grammar WASM file.
 * Uses import.meta.resolve to find tree-sitter-wasms regardless of hoisting.
 */
async function grammarWasmPath(grammarName: string): Promise<string> {
  const wasmSpecifier = `tree-sitter-wasms/out/tree-sitter-${grammarName}.wasm`;
  try {
    // import.meta.resolve handles bun's hoisting/symlink setup
    const resolved = import.meta.resolve(wasmSpecifier);
    return resolved.startsWith("file://") ? fileURLToPath(resolved) : resolved;
  } catch {
    // Fallback: walk up from this file to find the node_modules
    return resolve(
      import.meta.dirname,
      `../node_modules/tree-sitter-wasms/out/tree-sitter-${grammarName}.wasm`,
    );
  }
}

async function ensureParser(): Promise<Parser> {
  if (!parserReady) {
    parserReady = Parser.init();
  }
  await parserReady;
  if (!parserInstance) {
    parserInstance = new Parser();
  }
  return parserInstance;
}

async function loadLanguage(grammarName: string): Promise<Parser.Language | null> {
  const cached = languageCache.get(grammarName);
  if (cached) return cached;

  try {
    const wasmPath = await grammarWasmPath(grammarName);
    const lang = await Parser.Language.load(wasmPath);
    languageCache.set(grammarName, lang);
    return lang;
  } catch {
    return null;
  }
}

function getOrCreateQuery(
  lang: Parser.Language,
  grammarName: string,
  querySource: string,
): Parser.Query | null {
  const cached = queryCache.get(grammarName);
  if (cached) return cached;

  try {
    const query = lang.query(querySource);
    queryCache.set(grammarName, query);
    return query;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Outline extraction
// ---------------------------------------------------------------------------

export interface OutlineEntry {
  /** Symbol/heading name */
  readonly name: string;
  /** 1-based start line */
  readonly startLine: number;
  /** 1-based end line */
  readonly endLine: number;
  /** Nesting depth (0 = top-level) */
  readonly depth: number;
}

/**
 * Extract outline items from a tree-sitter query match set.
 * Handles the @item / @name capture convention from Zed's queries.
 */
function extractOutlineEntries(matches: Parser.QueryMatch[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  for (const match of matches) {
    let itemNode: Parser.SyntaxNode | null = null;
    let nameText: string | null = null;

    for (const capture of match.captures) {
      if (capture.name === "item") {
        itemNode = capture.node;
      } else if (capture.name === "name") {
        nameText = capture.node.text;
      }
    }

    if (itemNode && nameText) {
      entries.push({
        name: nameText,
        startLine: itemNode.startPosition.row + 1,
        endLine: itemNode.endPosition.row + 1,
        depth: computeDepth(itemNode),
      });
    }
  }

  return entries;
}

/**
 * Compute a rough nesting depth for a node by walking up the tree
 * and counting "scope-like" parents.
 */
function computeDepth(node: Parser.SyntaxNode): number {
  let depth = 0;
  let current = node.parent;
  while (current) {
    const type = current.type;
    if (
      type === "class_body" ||
      type === "statement_block" ||
      type === "block" ||
      type === "module" ||
      type === "section"
    ) {
      depth++;
    }
    current = current.parent;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render outline entries into the text format returned to the agent.
 *
 * Example output:
 * ```
 * class MyClass [L1-25]
 *   constructor() [L3-8]
 *   doStuff() [L10-24]
 * const SOME_CONST [L27]
 * function helper() [L29-45]
 * ```
 */
function renderOutline(entries: readonly OutlineEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const indent = "  ".repeat(entry.depth);
    const lineRange =
      entry.startLine === entry.endLine
        ? `[L${entry.startLine}]`
        : `[L${entry.startLine}-${entry.endLine}]`;
    lines.push(`${indent}${entry.name} ${lineRange}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FileOutlineResult {
  /** Whether the file was condensed to an outline (true) or is small enough to return in full (false). */
  readonly condensed: boolean;
  /** The outline text (when condensed=true) or the original content (when condensed=false). */
  readonly content: string;
  /** Total line count of the original file. */
  readonly totalLines: number;
}

/**
 * Given a file's content and path, decide whether to condense it to an outline.
 *
 * - If the file is below the threshold, returns `{ condensed: false }` with the original content.
 * - If above the threshold and we have a grammar + query for it, returns `{ condensed: true }` with the outline.
 * - If above the threshold but we can't parse it, falls back to returning the first 1KB.
 */
export async function getFileOutlineOrContent(
  filePath: string,
  content: string,
): Promise<FileOutlineResult> {
  const totalLines = content.split("\n").length;
  const byteLength = Buffer.byteLength(content, "utf-8");

  if (byteLength < AUTO_OUTLINE_THRESHOLD_BYTES) {
    return { condensed: false, content, totalLines };
  }

  // Determine grammar from file extension
  const ext = extname(filePath);
  const grammarName = EXT_TO_GRAMMAR[ext];

  if (!grammarName) {
    // No grammar — fall back to first 1KB
    return {
      condensed: true,
      content: formatFallback(content, totalLines),
      totalLines,
    };
  }

  const querySource = OUTLINE_QUERIES[grammarName];

  // We have a grammar but no outline query — use fallback
  if (!querySource) {
    return {
      condensed: true,
      content: formatFallbackWithNote(content, totalLines, grammarName),
      totalLines,
    };
  }

  // Parse with tree-sitter
  const p = await ensureParser();
  const lang = await loadLanguage(grammarName);
  if (!lang) {
    return {
      condensed: true,
      content: formatFallback(content, totalLines),
      totalLines,
    };
  }

  p.setLanguage(lang);
  const tree = p.parse(content);

  const query = getOrCreateQuery(lang, grammarName, querySource);

  if (!query) {
    return {
      condensed: true,
      content: formatFallback(content, totalLines),
      totalLines,
    };
  }

  const matches = query.matches(tree.rootNode);
  const entries = extractOutlineEntries(matches);

  if (entries.length === 0) {
    return {
      condensed: true,
      content: formatFallback(content, totalLines),
      totalLines,
    };
  }

  const outline = renderOutline(entries);
  const header = `File outline (${totalLines} lines total). This file is too large to read all at once.\nUse the line numbers below to read specific sections with start_line and end_line parameters.\n`;

  return {
    condensed: true,
    content: `${header}\n${outline}`,
    totalLines,
  };
}

/**
 * Check whether a file would be condensed based on its byte size.
 * Useful for quick checks without reading the full content.
 */
export function wouldCondense(byteLength: number): boolean {
  return byteLength >= AUTO_OUTLINE_THRESHOLD_BYTES;
}

/**
 * Get the grammar name for a file extension, or null if unsupported.
 */
export function grammarForExtension(ext: string): string | null {
  return EXT_TO_GRAMMAR[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extname(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filePath.length - 1) return "";
  return filePath.slice(lastDot);
}

function formatFallback(content: string, totalLines: number): string {
  const first1KB = content.slice(0, 1024);
  const previewLines = first1KB.split("\n").length;
  return `File preview (${totalLines} lines total, showing first ~${previewLines} lines). This file is too large to read all at once.\nUse start_line and end_line parameters to read specific sections.\n\n${first1KB}`;
}

function formatFallbackWithNote(content: string, totalLines: number, grammarName: string): string {
  const first1KB = content.slice(0, 1024);
  const previewLines = first1KB.split("\n").length;
  return `File preview (${totalLines} lines total, showing first ~${previewLines} lines). Grammar "${grammarName}" has no outline query yet.\nUse start_line and end_line parameters to read specific sections.\n\n${first1KB}`;
}
