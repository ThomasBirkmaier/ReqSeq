#!/usr/bin/env node
// Generates the OpenAPI description and the MCP tool list from the command catalog (ADR-0002, ADR-0009),
// the contracts bundle that @logreq/core validates with at run time (ADR-0003, ADR-0014) and the
// TypeScript types of all schemas and catalog commands (ADR-0003, types.mjs).
// Usage: generate.mjs [--check]   --check fails when a generated file is out of date.
import fs from "node:fs";
import path from "node:path";
import { loadContracts, root } from "./load.mjs";
import { generateTypes } from "./types.mjs";

const { catalog, schemas, meta } = loadContracts();
// The product version (root package.json), embedded so every access reports the same one (`logreq --version`).
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// Relative refs in the catalog point to ../<file>#/...; OpenAPI and MCP clients want self-contained
// documents, so shared schemas go into components and refs are rewritten.
const rewrite = (node, toRef) => {
  if (Array.isArray(node)) {
    return node.map((n) => rewrite(n, toRef));
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = k === "$ref" && typeof v === "string" ? toRef(v) : rewrite(v, toRef);
    }
    return out;
  }
  return node;
};
const component = (file) => file.replace(".schema.json", "");
// "../common.schema.json#/$defs/uuid" or "common.schema.json#/$defs/uuid" or "#/$defs/x" (inside file)
const refTo = (prefix, currentFile) => (ref) => {
  const m = ref.match(/^(?:\.\.\/)?([a-z-]+\.schema\.json)?(?:#(.*))?$/);
  if (!m) {
    throw new Error(`unsupported $ref ${ref}`);
  }
  const file = m[1] ?? currentFile;
  return `${prefix}${component(file)}${m[2] ?? ""}`;
};

const components = {};
for (const [file, s] of Object.entries(schemas)) {
  const { $schema, $id, ...rest } = s;
  components[component(file)] = rewrite(rest, refTo("#/components/schemas/", file));
}

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "LogReq local API",
    version,
    description:
      "Generated from schemas/commands/catalog.json. Listens on 127.0.0.1 and ::1 only (SR-079). Every request needs `Authorization: Bearer <token>` from api.json in the cache folder of the working copy (schemas/api-endpoint.schema.json, ADR-0009). One endpoint per command; same input, output and errors as CLI and MCP (SR-080).",
  },
  servers: [{ url: "http://127.0.0.1:{port}", variables: { port: { default: "0" } } }],
  security: [{ token: [] }],
  paths: {},
  components: {
    securitySchemes: { token: { type: "http", scheme: "bearer" } },
    schemas: components,
  },
};
const errorResponse = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/common/$defs/error" } } },
});
// Refusals before any command runs (ADR-0009): Host or Origin header, token.
const refusals = {
  401: errorResponse("Missing or wrong token"),
  403: errorResponse(
    "Host header not a loopback name with the port, or an Origin header (no browser access)",
  ),
};
// HTTP status of each error class (ADR-0009 "Errors"; `HTTP_STATUS_BY_CLASS` in packages/api).
const commandErrors = {
  400: errorResponse("Command error of class input (e.g. input.invalid), or a body that is not JSON"),
  404: errorResponse("Command error of class not-found"),
  409: errorResponse("Command error of class conflict"),
  413: errorResponse("Request body larger than 32 MiB (input.invalid)"),
  500: errorResponse("Command error of class internal"),
  501: errorResponse(
    "Command error of class not-implemented: a catalog command this version does not implement yet",
  ),
  503: errorResponse("Command error of class unavailable (e.g. git.unavailable)"),
};
const catalogEntry = rewrite(
  {
    ...meta.properties.commands.items,
    required: [...meta.properties.commands.items.required, "implemented"],
    properties: {
      ...meta.properties.commands.items.properties,
      implemented: { type: "boolean", description: "False for catalog commands of a later stage." },
    },
  },
  refTo("#/components/schemas/", "common.schema.json"),
);
openapi.paths["/v1/commands"] = {
  get: {
    operationId: "commands_list",
    summary: "The command catalog, each entry with whether this version implements it.",
    responses: {
      200: {
        description: "Catalog",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["commands"],
              properties: { commands: { type: "array", items: catalogEntry } },
              additionalProperties: false,
            },
          },
        },
      },
      ...refusals,
    },
  },
};
for (const cmd of catalog.commands) {
  const toRef = refTo("#/components/schemas/", "common.schema.json");
  openapi.paths[`/v1/commands/${cmd.name}`] = {
    post: {
      operationId: cmd.name.replace(".", "_"),
      summary: cmd.summary,
      tags: [cmd.name.split(".")[0]],
      "x-logreq-effect": cmd.effect,
      "x-logreq-stage": cmd.stage,
      "x-logreq-implements": cmd.implements,
      requestBody: { required: true, content: { "application/json": { schema: rewrite(cmd.input, toRef) } } },
      responses: {
        200: {
          description: "Result",
          content: { "application/json": { schema: rewrite(cmd.output, toRef) } },
        },
        ...refusals,
        ...commandErrors,
      },
    },
  };
}

// MCP: tools with self-contained input schemas; shared definitions inlined under $defs.
const mcpDefs = {};
for (const [file, s] of Object.entries(schemas)) {
  const { $schema, $id, ...rest } = s;
  mcpDefs[component(file)] = rewrite(rest, refTo("#/$defs/", file));
}
// Shared definitions appear once; the MCP server lists the implemented tools and attaches to each tool
// schema only the definitions it reaches, flat (`#/$defs/common.uuid`), so every schema it sends is
// self-contained and small (packages/mcp/src/tools.ts, #303).
const mcp = {
  description:
    "Generated from schemas/commands/catalog.json. The MCP server (stdio) lists those of these tools that the running version implements (ADR-0009). $refs point into the top-level $defs; the server sends each tool schema with only the definitions it uses.",
  $defs: mcpDefs,
  tools: catalog.commands.map((cmd) => {
    const toRef = refTo("#/$defs/", "common.schema.json");
    return {
      name: cmd.name.replace(".", "_"),
      title: cmd.title,
      description: cmd.summary,
      annotations: { readOnlyHint: cmd.effect === "read", destructiveHint: false, openWorldHint: false },
      inputSchema: rewrite(cmd.input, toRef),
      outputSchema: rewrite(cmd.output, toRef),
    };
  }),
};

// All schemas and the catalog in one JSON module, so core needs no schemas folder at run time
// (bundled app, CLI tarball) and works from src/ without a build.
const bundle = {
  description: "Generated by scripts/contracts/generate.mjs from schemas/. Do not edit.",
  schemas: Object.keys(schemas)
    .sort()
    .map((f) => schemas[f]),
  catalogMeta: meta,
  catalog,
};

// The standard model (D-037, D-059, D-060), shipped in core and written by workspace.init (SR-014). The
// example of the metamodel format is the source, so the shipped model and the example never differ.
const STANDARD_MODEL = "schemas/examples/metamodel/standard-model.yaml";
const standardModel = {
  description: `Generated by scripts/contracts/generate.mjs from ${STANDARD_MODEL}. Do not edit.`,
  file: path.posix.basename(STANDARD_MODEL),
  text: fs.readFileSync(path.join(root, STANDARD_MODEL), "utf8").replaceAll("\r\n", "\n"),
};

const json = (data) => JSON.stringify(data, null, 2) + "\n";
const files = {
  "schemas/generated/openapi.json": json(openapi),
  "schemas/generated/mcp-tools.json": json(mcp),
  "packages/core/src/generated/contracts.json": json(bundle),
  "packages/core/src/generated/product.json": json({
    description: "Generated by scripts/contracts/generate.mjs from package.json. Do not edit.",
    name: "LogReq",
    version,
  }),
  "packages/core/src/generated/standard-model.json": json(standardModel),
  "packages/core/src/generated/types.ts": generateTypes({ schemas, meta, catalog }),
};
if (process.argv.includes("--check")) {
  let stale = false;
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(root, f);
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content) {
      console.error(`error: ${f} is out of date; run pnpm contracts:generate`);
      stale = true;
    }
  }
  process.exit(stale ? 1 : 0);
}
for (const [f, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  fs.writeFileSync(path.join(root, f), content);
}
console.log(
  `generated ${Object.keys(files)
    .map((f) => path.basename(f))
    .join(", ")} for ${catalog.commands.length} commands`,
);
