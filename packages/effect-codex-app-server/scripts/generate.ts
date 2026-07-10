#!/usr/bin/env node

declare const Bun: {
  spawnSync(command: ReadonlyArray<string>, options: { readonly stdout: "pipe"; readonly stderr: "pipe" }): {
    readonly exitCode: number;
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
  };
};

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { make as makeJsonSchemaGenerator } from "@effect/openapi-generator/JsonSchemaGenerator";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const CODEX_BINARY = process.env.CODEX_BINARY ?? "codex";

const JsonSchemaDocument = Schema.StructWithRest(
  Schema.Struct({
    definitions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
const decodeJsonSchemaDocument = Schema.decodeEffect(Schema.fromJsonString(JsonSchemaDocument));

interface GeneratedPaths {
  readonly generatedDir: string;
  readonly schemaOutputPath: string;
  readonly metaOutputPath: string;
  readonly namespacesOutputPath: string;
}

interface MethodEntry {
  readonly method: string;
  readonly paramsType?: string;
}

interface JsonSchemaFile {
  readonly namespace?: string;
  readonly exportName: string;
  readonly fileName: string;
  readonly path: string;
  readonly qualifiedName: string;
}

interface ProtocolBundle {
  readonly tempDir: string;
  readonly jsonSchemaDir: string;
  readonly typescriptDir: string;
  readonly sourceLabel: string;
}

class GeneratorError extends Schema.TaggedErrorClass<GeneratorError>()("GeneratorError", {
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message() {
    return this.detail;
  }
}

const ManualSchemas: Record<string, typeof Schema.Json.Type> = {
  GetAuthStatusParams: {
    type: "object",
    title: "GetAuthStatusParams",
    properties: {
      includeToken: {
        anyOf: [{ type: "boolean" }, { type: "null" }],
      },
      refreshToken: {
        anyOf: [{ type: "boolean" }, { type: "null" }],
      },
    },
  },
  GetConversationSummaryParams: {
    title: "GetConversationSummaryParams",
    oneOf: [
      {
        type: "object",
        properties: {
          rolloutPath: { type: "string" },
        },
        required: ["rolloutPath"],
      },
      {
        type: "object",
        properties: {
          conversationId: { type: "string" },
        },
        required: ["conversationId"],
      },
    ],
  },
  GetConversationSummaryResponse: {
    type: "object",
    title: "GetConversationSummaryResponse",
    properties: {
      summary: {},
    },
    required: ["summary"],
  },
  GitDiffToRemoteParams: {
    type: "object",
    title: "GitDiffToRemoteParams",
    properties: {
      cwd: { type: "string" },
    },
    required: ["cwd"],
  },
  GitDiffToRemoteResponse: {
    type: "object",
    title: "GitDiffToRemoteResponse",
    properties: {
      sha: { type: "string" },
      diff: { type: "string" },
    },
    required: ["sha", "diff"],
  },
  GetAuthStatusResponse: {
    type: "object",
    title: "GetAuthStatusResponse",
    properties: {
      authMethod: {
        anyOf: [{}, { type: "null" }],
      },
      authToken: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      requiresOpenaiAuth: {
        anyOf: [{ type: "boolean" }, { type: "null" }],
      },
    },
    required: ["authMethod", "authToken", "requiresOpenaiAuth"],
  },
};

const getGeneratedPaths = Effect.fn("getGeneratedPaths")(function* () {
  const path = yield* Path.Path;
  const generatedDir = path.join(import.meta.dirname, "..", "src", "_generated");
  return {
    generatedDir,
    schemaOutputPath: path.join(generatedDir, "schema.gen.ts"),
    metaOutputPath: path.join(generatedDir, "meta.gen.ts"),
    namespacesOutputPath: path.join(generatedDir, "namespaces.gen.ts"),
  } satisfies GeneratedPaths;
});

const ensureGeneratedDir = Effect.fn("ensureGeneratedDir")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { generatedDir } = yield* getGeneratedPaths();
  yield* fs.makeDirectory(generatedDir, { recursive: true });
});

const readFileString = Effect.fn("readFileString")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(filePath).pipe(
    Effect.mapError(
      (cause) =>
        new GeneratorError({
          detail: `Failed to read ${filePath}`,
          cause,
        }),
    ),
  );
});

const runCodexCommand = Effect.fn("runCodexCommand")(function* (
  args: ReadonlyArray<string>,
  description: string,
) {
  const result = Bun.spawnSync([CODEX_BINARY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    return yield* new GeneratorError({
      detail: `Failed to ${description} using ${CODEX_BINARY}: ${new TextDecoder().decode(result.stderr)}`,
    });
  }
  return new TextDecoder().decode(result.stdout);
});

const generateProtocolBundle = Effect.fn("generateProtocolBundle")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = yield* fs.makeTempDirectoryScoped({
    prefix: "effect-codex-app-server-",
  });
  const jsonSchemaDir = path.join(tempDir, "json-schema");
  const typescriptDir = path.join(tempDir, "typescript");
  yield* fs.makeDirectory(jsonSchemaDir, { recursive: true });
  yield* fs.makeDirectory(typescriptDir, { recursive: true });

  const version = yield* runCodexCommand(["--version"], "read Codex CLI version").pipe(
    Effect.map((output) => output.trim()),
  );
  yield* runCodexCommand(
    ["app-server", "generate-json-schema", "--experimental", "--out", jsonSchemaDir],
    "generate Codex App Server JSON Schema",
  );
  yield* runCodexCommand(
    ["app-server", "generate-ts", "--experimental", "--out", typescriptDir],
    "generate Codex App Server TypeScript bindings",
  );

  return {
    tempDir,
    jsonSchemaDir,
    typescriptDir,
    sourceLabel: version || `${CODEX_BINARY} app-server generator`,
  } satisfies ProtocolBundle;
});



function collectSchemaEntries(
  chunk: string,
): ReadonlyArray<{ readonly name: string; readonly code: string }> {
  const lines = chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  const entries: Array<{ name: string; code: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const typeLine = lines[index];
    if (!typeLine?.startsWith("export type ")) {
      continue;
    }

    const constLine = lines[index + 1];
    if (!constLine?.startsWith("export const ")) {
      throw new Error(`Malformed generator output near: ${typeLine}`);
    }

    const match = /^export type ([A-Za-z0-9_]+)/.exec(typeLine);
    if (!match?.[1]) {
      throw new Error(`Could not extract schema name from: ${typeLine}`);
    }

    entries.push({
      name: match[1],
      code: `${typeLine}\n${constLine}`,
    });
    index += 1;
  }

  return entries;
}

function normalizeNullableTypes(value: typeof Schema.Json.Type): typeof Schema.Json.Type {
  if (Array.isArray(value)) {
    return value.map(normalizeNullableTypes);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const normalizedEntries = Object.entries(value).map(([key, child]) => [
    key,
    normalizeNullableTypes(child),
  ]);
  const normalizedObject = Object.fromEntries(normalizedEntries) as Record<
    string,
    typeof Schema.Json.Type
  >;
  const typeValue = normalizedObject.type;

  if (!Array.isArray(typeValue)) {
    return normalizedObject;
  }

  const normalizedTypes = typeValue.filter((entry): entry is string => typeof entry === "string");
  if (normalizedTypes.length !== typeValue.length || !normalizedTypes.includes("null")) {
    return normalizedObject;
  }

  const nonNullTypes = normalizedTypes.filter((entry) => entry !== "null");
  if (nonNullTypes.length !== 1) {
    return normalizedObject;
  }
  const nonNullType = nonNullTypes[0]!;

  const nextObject: Record<string, typeof Schema.Json.Type> = {};
  for (const [key, child] of Object.entries(normalizedObject)) {
    if (key !== "type") {
      nextObject[key] = child;
    }
  }

  return {
    anyOf: [
      {
        ...nextObject,
        type: nonNullType,
      },
      { type: "null" },
    ],
  };
}

function stripNullDefaults(value: typeof Schema.Json.Type): typeof Schema.Json.Type {
  if (Array.isArray(value)) {
    return value.map(stripNullDefaults);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !(key === "default" && child === null))
      .map(([key, child]) => [key, stripNullDefaults(child)]),
  ) as typeof Schema.Json.Type;
}

function toPascalCaseMethod(method: string) {
  return method
    .split("/")
    .flatMap((segment) => segment.split(/(?=[A-Z])/))
    .flatMap((segment) => segment.split(/[-_]/))
    .filter(Boolean)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join("");
}

function parseRequestEntries(fileContents: string): ReadonlyArray<MethodEntry> {
  const entryPattern = /\{\s*"method":\s*"([^"]+)",\s*id:\s*RequestId,\s*params:\s*([^,}]+)/g;
  const entries: Array<MethodEntry> = [];
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(fileContents)) !== null) {
    entries.push({
      method: match[1]!,
      paramsType: match[2]!.trim(),
    });
  }
  return entries;
}

function parseNotificationEntries(fileContents: string): ReadonlyArray<MethodEntry> {
  const entryPattern = /\{\s*"method":\s*"([^"]+)"(?:,\s*"params":\s*([^ }]+))?\s*\}/g;
  const entries: Array<MethodEntry> = [];
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(fileContents)) !== null) {
    entries.push({
      method: match[1]!,
      ...(match[2] ? { paramsType: match[2].trim() } : {}),
    });
  }
  return entries;
}

function splitNullableTypeName(rawTypeName: string): {
  readonly typeName: string;
  readonly nullable: boolean;
} {
  const match = /^(.*)\s+\|\s+null$/.exec(rawTypeName);
  return match?.[1] ? { typeName: match[1].trim(), nullable: true } : { typeName: rawTypeName, nullable: false };
}

function resolveSchemaTypeName(rawTypeName: string, generatedSchemaNames: ReadonlySet<string>): string {
  const { typeName } = splitNullableTypeName(rawTypeName);
  if (typeName === "undefined") {
    return "undefined";
  }

  const candidates = [
    typeName,
    `V2${typeName}`,
    `V1${typeName}`,
    `SerdeJson${typeName}`,
    `Nullable${typeName}`,
    `V2Nullable${typeName}`,
    `V1Nullable${typeName}`,
    `SerdeJsonNullable${typeName}`,
  ];
  for (const candidate of candidates) {
    if (generatedSchemaNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve schema type name: ${rawTypeName}`);
}

function renderRawSchemaTypeReference(
  rawTypeName: string,
  generatedSchemaNames: ReadonlySet<string>,
): string {
  const { nullable } = splitNullableTypeName(rawTypeName);
  const schemaName = resolveSchemaTypeName(rawTypeName, generatedSchemaNames);
  const baseReference = renderSchemaTypeReference(schemaName);
  return nullable ? `${baseReference} | null` : baseReference;
}

function renderResolvedSchemaExpression(schemaName: string): string {
  return schemaName === "undefined" ? "undefined" : `CodexSchema.${schemaName}`;
}

function renderRawSchemaExpression(
  rawTypeName: string,
  generatedSchemaNames: ReadonlySet<string>,
): string {
  const { nullable } = splitNullableTypeName(rawTypeName);
  const schemaName = resolveSchemaTypeName(rawTypeName, generatedSchemaNames);
  const baseExpression = renderResolvedSchemaExpression(schemaName);
  return nullable ? `Schema.Union([${baseExpression}, Schema.Null])` : baseExpression;
}

function resolveResponseTypeName(
  method: string,
  paramsType: string | undefined,
  generatedSchemaNames: ReadonlySet<string>,
): string {
  const overrides: Record<string, string> = {
    "account/logout": "LogoutAccountResponse",
    "account/rateLimits/read": "GetAccountRateLimitsResponse",
    "account/usage/read": "GetAccountTokenUsageResponse",
    "account/workspaceMessages/read": "GetWorkspaceMessagesResponse",
    "config/batchWrite": "ConfigWriteResponse",
    "config/mcpServer/reload": "McpServerRefreshResponse",
    "config/value/write": "ConfigWriteResponse",
    "configRequirements/read": "ConfigRequirementsReadResponse",
    "externalAgentConfig/import/readHistories": "ExternalAgentConfigImportHistoriesReadResponse",
  };

  const override = overrides[method];
  if (override) {
    return resolveSchemaTypeName(override, generatedSchemaNames);
  }

  const normalizedParamsType = paramsType ? splitNullableTypeName(paramsType).typeName : undefined;
  if (normalizedParamsType && normalizedParamsType !== "undefined") {
    const fromParams = normalizedParamsType.replace(/Params$/, "Response");
    try {
      return resolveSchemaTypeName(fromParams, generatedSchemaNames);
    } catch {
      // Fall through to method-based lookup.
    }
  }

  return resolveSchemaTypeName(`${toPascalCaseMethod(method)}Response`, generatedSchemaNames);
}

function renderMethodConstants(constantName: string, entries: ReadonlyArray<MethodEntry>) {
  return [
    `export const ${constantName} = {`,
    ...entries.map(
      (entry) => `  ${JSON.stringify(entry.method)}: ${JSON.stringify(entry.method)},`,
    ),
    "} as const;",
    "",
  ].join("\n");
}

function renderTypeInterface(
  interfaceName: string,
  entries: ReadonlyArray<MethodEntry>,
  typeName: (entry: MethodEntry) => string,
) {
  return [
    `export interface ${interfaceName} {`,
    ...entries.map((entry) => `  readonly ${JSON.stringify(entry.method)}: ${typeName(entry)};`),
    "}",
    "",
  ].join("\n");
}

function renderSchemaMap(
  constantName: string,
  entries: ReadonlyArray<MethodEntry>,
  schemaExpression: (entry: MethodEntry) => string,
) {
  return [
    `export const ${constantName} = {`,
    ...entries.map((entry) => `  ${JSON.stringify(entry.method)}: ${schemaExpression(entry)},`),
    "} as const;",
    "",
  ].join("\n");
}

function renderSchemaTypeReference(schemaName: string) {
  return schemaName === "undefined" ? "undefined" : `typeof CodexSchema.${schemaName}.Type`;
}

function exportNameForPath(filePath: string): string {
  const relative = filePath.replace(/^schema\/json\//, "").replace(/\.json$/, "");
  if (!relative.includes("/")) {
    return relative;
  }

  const [namespace, name] = relative.split("/", 2) as [string, string];
  const namespacePrefix = namespace
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join("");
  return `${namespacePrefix}${name}`;
}

function collectJsonSchemaPaths(
  rootDir: string,
): Effect.Effect<ReadonlyArray<string>, GeneratorError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* fs.readDirectory(rootDir).pipe(
      Effect.mapError(
        (cause) =>
          new GeneratorError({
            detail: `Failed to read schema directory ${rootDir}`,
            cause,
          }),
      ),
    );
    const schemaPaths: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(rootDir, entry);
      const metadata = yield* fs.stat(entryPath).pipe(
        Effect.mapError(
          (cause) =>
            new GeneratorError({
              detail: `Failed to stat schema path ${entryPath}`,
              cause,
            }),
        ),
      );
      if (metadata.type === "Directory") {
        schemaPaths.push(...(yield* collectJsonSchemaPaths(entryPath)));
      } else if (
        metadata.type === "File" &&
        entry.endsWith(".json") &&
        !entry.startsWith("codex_app_server_protocol.")
      ) {
        schemaPaths.push(entryPath);
      }
    }
    return schemaPaths;
  });
}

function buildJsonSchemaFiles(
  rootDir: string,
): Effect.Effect<ReadonlyArray<JsonSchemaFile>, GeneratorError, FileSystem.FileSystem | Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const schemaPaths = yield* collectJsonSchemaPaths(rootDir);
    return schemaPaths.map((filePath): JsonSchemaFile => {
      const relative = path.relative(rootDir, filePath).replaceAll("\\", "/");
      const fileName = path.basename(filePath);
      const parts = relative.split("/");
      if (parts.length > 1) {
        return {
          namespace: parts[0]!,
          exportName: exportNameForPath(relative),
          fileName,
          path: filePath,
          qualifiedName: relative.replace(/\.json$/, ""),
        };
      }
      return {
        exportName: exportNameForPath(relative),
        fileName,
        path: filePath,
        qualifiedName: relative.replace(/\.json$/, ""),
      };
    });
  });
}

function rewriteExternalRefs(
  value: typeof Schema.Json.Type,
  localDefinitionNames: ReadonlyMap<string, string>,
  currentNamespace: string | undefined,
  exportNameByQualifiedName: ReadonlyMap<string, string>,
): typeof Schema.Json.Type {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      rewriteExternalRefs(entry, localDefinitionNames, currentNamespace, exportNameByQualifiedName),
    );
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/definitions/")) {
        const definitionName = child.slice("#/definitions/".length);
        const localRewrite = localDefinitionNames.get(definitionName);
        if (localRewrite) {
          return [key, `#/definitions/${localRewrite}`];
        }

        const candidates = [
          ...(currentNamespace ? [`${currentNamespace}/${definitionName}`] : []),
          definitionName,
          definitionName.replace(/^v[12]\//, ""),
          definitionName.replace(/^serde_json\//, ""),
          `v2/${definitionName}`,
          `v1/${definitionName}`,
          `serde_json/${definitionName}`,
        ];

        const rewritten = candidates
          .map((candidate) => exportNameByQualifiedName.get(candidate))
          .find((candidate) => candidate !== undefined);

        if (!rewritten) {
          throw new Error(`Missing rewritten definition for ref: ${child}`);
        }

        return [key, `#/definitions/${rewritten}`];
      }

      return [
        key,
        rewriteExternalRefs(
          child,
          localDefinitionNames,
          currentNamespace,
          exportNameByQualifiedName,
        ),
      ];
    }),
  ) as typeof Schema.Json.Type;
}

const generateFiles = Effect.fn("generateFiles")(function* () {
  yield* ensureGeneratedDir();

  const protocolBundle = yield* generateProtocolBundle();
  const jsonSchemaFiles = (yield* buildJsonSchemaFiles(protocolBundle.jsonSchemaDir)).toSorted(
    (left, right) => left.exportName.localeCompare(right.exportName),
  );

  const exportNameByQualifiedName = new Map(
    jsonSchemaFiles.map((file) => [file.qualifiedName, file.exportName]),
  );
  const aggregateSchemas: Record<string, typeof Schema.Json.Type> = {};

  for (const file of jsonSchemaFiles) {
    const raw = yield* readFileString(file.path);
    const parsed = yield* decodeJsonSchemaDocument(raw);
    const localDefinitionNames = new Map(
      Object.keys(parsed.definitions ?? {}).map((definitionName) => [
        definitionName,
        `${file.exportName}__${definitionName.replace(/[^A-Za-z0-9]/g, "")}`,
      ]),
    );

    for (const [definitionName, definitionSchema] of Object.entries(parsed.definitions ?? {})) {
      aggregateSchemas[localDefinitionNames.get(definitionName)!] = stripNullDefaults(
        normalizeNullableTypes(
          rewriteExternalRefs(
            definitionSchema,
            localDefinitionNames,
            file.namespace,
            exportNameByQualifiedName,
          ),
        ),
      );
    }

    const topLevelSchema: Record<string, typeof Schema.Json.Type> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== "definitions") {
        topLevelSchema[key] = value;
      }
    }

    aggregateSchemas[file.exportName] = stripNullDefaults(
      normalizeNullableTypes(
        rewriteExternalRefs(
          topLevelSchema,
          localDefinitionNames,
          file.namespace,
          exportNameByQualifiedName,
        ),
      ),
    );
  }

  for (const [name, schema] of Object.entries(ManualSchemas)) {
    if (!(name in aggregateSchemas)) {
      aggregateSchemas[name] = stripNullDefaults(normalizeNullableTypes(schema));
    }
  }

  const generator = makeJsonSchemaGenerator();
  for (const [name, schema] of Object.entries(aggregateSchemas).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    generator.addSchema(name, schema as never);
  }

  const generatedEntries = new Map<string, string>();
  const output = generator.generate("openapi-3.1", aggregateSchemas as never, false).trim();
  if (output.length > 0) {
    for (const entry of collectSchemaEntries(output)) {
      if (!generatedEntries.has(entry.name)) {
        generatedEntries.set(entry.name, entry.code);
      }
    }
  }

  const generatedSchemaNames = new Set(generatedEntries.keys());
  const path = yield* Path.Path;
  const clientRequestRaw = yield* readFileString(
    path.join(protocolBundle.typescriptDir, "ClientRequest.ts"),
  );
  const clientNotificationRaw = yield* readFileString(
    path.join(protocolBundle.typescriptDir, "ClientNotification.ts"),
  );
  const serverRequestRaw = yield* readFileString(
    path.join(protocolBundle.typescriptDir, "ServerRequest.ts"),
  );
  const serverNotificationRaw = yield* readFileString(
    path.join(protocolBundle.typescriptDir, "ServerNotification.ts"),
  );

  const clientRequestEntries = parseRequestEntries(clientRequestRaw);
  const clientNotificationEntries = parseNotificationEntries(clientNotificationRaw);
  const serverRequestEntries = parseRequestEntries(serverRequestRaw);
  const serverNotificationEntries = parseNotificationEntries(serverNotificationRaw);

  const prelude = [
    "// This file is generated by the effect-codex-app-server package. Do not edit manually.",
    `// Protocol source: ${protocolBundle.sourceLabel}`,
    "// Generator command: codex app-server generate-json-schema/generate-ts --experimental",
    "",
  ];

  const schemaOutput = [
    ...prelude,
    'import * as Schema from "effect/Schema";',
    "",
    [...generatedEntries.values()].join("\n\n"),
    "",
  ].join("\n");

  const metaOutput = [
    ...prelude,
    'import * as Schema from "effect/Schema";',
    'import * as CodexSchema from "./schema.gen.ts";',
    "",
    renderMethodConstants("CLIENT_REQUEST_METHODS", clientRequestEntries),
    renderMethodConstants("CLIENT_NOTIFICATION_METHODS", clientNotificationEntries),
    renderMethodConstants("SERVER_REQUEST_METHODS", serverRequestEntries),
    renderMethodConstants("SERVER_NOTIFICATION_METHODS", serverNotificationEntries),
    "export type ClientRequestMethod = keyof typeof CLIENT_REQUEST_METHODS;",
    "export type ClientNotificationMethod = keyof typeof CLIENT_NOTIFICATION_METHODS;",
    "export type ServerRequestMethod = keyof typeof SERVER_REQUEST_METHODS;",
    "export type ServerNotificationMethod = keyof typeof SERVER_NOTIFICATION_METHODS;",
    "",
    renderTypeInterface("ClientRequestParamsByMethod", clientRequestEntries, (entry) =>
      renderRawSchemaTypeReference(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderTypeInterface("ClientRequestResponsesByMethod", clientRequestEntries, (entry) =>
      renderSchemaTypeReference(
        resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
      ),
    ),
    renderTypeInterface("ClientNotificationParamsByMethod", clientNotificationEntries, (entry) =>
      renderRawSchemaTypeReference(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderTypeInterface("ServerRequestParamsByMethod", serverRequestEntries, (entry) =>
      renderRawSchemaTypeReference(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderTypeInterface("ServerRequestResponsesByMethod", serverRequestEntries, (entry) =>
      renderSchemaTypeReference(
        resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
      ),
    ),
    renderTypeInterface("ServerNotificationParamsByMethod", serverNotificationEntries, (entry) =>
      renderRawSchemaTypeReference(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderSchemaMap("CLIENT_REQUEST_PARAMS", clientRequestEntries, (entry) =>
      renderRawSchemaExpression(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderSchemaMap("CLIENT_REQUEST_RESPONSES", clientRequestEntries, (entry) =>
      renderResolvedSchemaExpression(
        resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
      ),
    ),
    renderSchemaMap("CLIENT_NOTIFICATION_PARAMS", clientNotificationEntries, (entry) =>
      renderRawSchemaExpression(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderSchemaMap("SERVER_REQUEST_PARAMS", serverRequestEntries, (entry) =>
      renderRawSchemaExpression(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
    renderSchemaMap("SERVER_REQUEST_RESPONSES", serverRequestEntries, (entry) =>
      renderResolvedSchemaExpression(
        resolveResponseTypeName(entry.method, entry.paramsType, generatedSchemaNames),
      ),
    ),
    renderSchemaMap("SERVER_NOTIFICATION_PARAMS", serverNotificationEntries, (entry) =>
      renderRawSchemaExpression(entry.paramsType ?? "undefined", generatedSchemaNames),
    ),
  ].join("\n");

  const namespaceGroups = new Map<string, Array<JsonSchemaFile>>();
  for (const file of jsonSchemaFiles) {
    if (!file.namespace) {
      continue;
    }
    const current = namespaceGroups.get(file.namespace) ?? [];
    current.push(file);
    namespaceGroups.set(file.namespace, current);
  }

  const namespacesOutput = [
    ...prelude,
    'import * as CodexSchema from "./schema.gen.ts";',
    "",
    ...[...namespaceGroups.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([namespace, files]) => {
        const constantName = namespace.replace(/[^A-Za-z0-9]/g, "");
        return [
          `export const ${constantName} = {`,
          ...files
            .toSorted((left, right) => left.fileName.localeCompare(right.fileName))
            .map(
              (file) =>
                `  ${JSON.stringify(file.fileName.replace(/\.json$/, ""))}: CodexSchema.${file.exportName},`,
            ),
          "} as const;",
          "",
        ].join("\n");
      }),
  ].join("\n");

  const fs = yield* FileSystem.FileSystem;
  const { generatedDir, metaOutputPath, namespacesOutputPath, schemaOutputPath } =
    yield* getGeneratedPaths();
  yield* fs.writeFileString(schemaOutputPath, schemaOutput);
  yield* fs.writeFileString(metaOutputPath, metaOutput);
  yield* fs.writeFileString(namespacesOutputPath, namespacesOutput);

  yield* Effect.log(`Generated Codex App Server schemas from ${protocolBundle.sourceLabel}`);

  yield* Effect.service(ChildProcessSpawner.ChildProcessSpawner).pipe(
    Effect.flatMap((spawner) => spawner.spawn(ChildProcess.make("bun", ["oxfmt", generatedDir]))),
    Effect.flatMap((child) => child.exitCode),
    Effect.tap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new GeneratorError({
              detail: `oxfmt failed with exit code ${code}`,
            }),
          ),
    ),
  );
});

generateFiles().pipe(
  Effect.scoped,
  Effect.provide(
    Layer.mergeAll(
      Logger.layer([Logger.consolePretty()]),
      NodeServices.layer,
    ),
  ),
  NodeRuntime.runMain,
);
