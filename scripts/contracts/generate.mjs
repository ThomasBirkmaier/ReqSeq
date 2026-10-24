#!/usr/bin/env node
// Generates the OpenAPI description and the MCP tool list from the command catalog (ADR-0002, ADR-0009).
// Usage: generate.mjs [--check]   --check fails when schemas/generated/ is out of date.
import fs from "node:fs";
import path from "node:path";
import { loadContracts, schemasDir } from "./load.mjs";

const { catalog, schemas } = loadContracts();
const outDir = path.join(schemasDir, "generated");

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
    version: "0.0.0",
    description:
      "Generated from schemas/commands/catalog.json. Listens on 127.0.0.1 only (SR-079). Every request needs `Authorization: Bearer <token>` from the token file of the running instance (ADR-0009). One endpoint per command; same input, output and errors as CLI and MCP (SR-080).",
  },
  servers: [{ url: "http://127.0.0.1:{port}", variables: { port: { default: "0" } } }],
  security: [{ token: [] }],
  paths: {},
  components: {
    securitySchemes: { token: { type: "http", scheme: "bearer" } },
    schemas: components,
  },
};
const errorResponse = {
  description: "Command error",
  content: { "application/json": { schema: { $ref: "#/components/schemas/common/$defs/error" } } },
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
        400: errorResponse,
        401: { description: "Missing or wrong token" },
        404: errorResponse,
        409: errorResponse,
        500: errorResponse,
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
// Shared definitions appear once; the MCP server attaches the referenced ones to each tool schema
// at runtime, so every schema it sends is self-contained.
const mcp = {
  description:
    "Generated from schemas/commands/catalog.json. The MCP server (stdio) offers exactly these tools (ADR-0009). $refs point into the top-level $defs.",
  $defs: mcpDefs,
  tools: catalog.commands.map((cmd) => {
    const toRef = refTo("#/$defs/", "common.schema.json");
    return {
      name: cmd.name.replace(".", "_"),
      description: cmd.summary,
      annotations: { readOnlyHint: cmd.effect === "read", destructiveHint: false, openWorldHint: false },
      inputSchema: rewrite(cmd.input, toRef),
      outputSchema: rewrite(cmd.output, toRef),
    };
  }),
};

const files = {
  "openapi.json": JSON.stringify(openapi, null, 2) + "\n",
  "mcp-tools.json": JSON.stringify(mcp, null, 2) + "\n",
};
if (process.argv.includes("--check")) {
  let stale = false;
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(outDir, f);
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== content) {
      console.error(`error: schemas/generated/${f} is out of date; run pnpm contracts:generate`);
      stale = true;
    }
  }
  process.exit(stale ? 1 : 0);
}
fs.mkdirSync(outDir, { recursive: true });
for (const [f, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, f), content);
}
console.log(`generated ${Object.keys(files).join(", ")} for ${catalog.commands.length} commands`);
