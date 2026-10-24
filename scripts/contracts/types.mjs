// Generates TypeScript types from the JSON Schemas and the command catalog (ADR-0003): every file
// format and `$defs` entry of schemas/*.schema.json, the catalog itself (catalog.meta.schema.json)
// and `<Name>Input`/`<Name>Output` of every catalog command, plus `CommandTypes`, the map from
// command name to both. Used by generate.mjs; the result is packages/core/src/generated/types.ts.
//
// Supported subset (what our schemas use): type (also as list), properties, required,
// additionalProperties, unevaluatedProperties: false, items, enum, const, anyOf, oneOf, allOf, $ref
// (`#`, `#/$defs/<name>`, `<file>.schema.json[#/$defs/<name>]`, relative to the schema's folder),
// `not: {}` (never valid). Input types fill in defaults (see `toNode`). Validation-only keywords (pattern, format, minimum, propertyNames, `not`
// with content, if/then/else, ...) do not change the type. Any other keyword fails the generation,
// so a new keyword is a conscious change here and not a silently wrong type.
import path from "node:path";

/** Names that differ from the derived ones: global names (Error, Date, Selection) and the catalog. */
export const RENAMES = {
  "common.schema.json#/$defs/error": "CommandErrorObject",
  "common.schema.json#/$defs/selection": "ElementSelection",
  "common.schema.json#/$defs/date": "IsoDate",
  "common.schema.json#/$defs/dateTime": "IsoDateTime",
  "commands/catalog.meta.schema.json#": "CommandCatalog",
};

/** Global names (ECMAScript and DOM, the app renderer has both) a generated type must never shadow. */
const RESERVED = new Set([
  "Blob",
  "Document",
  "Element",
  "Event",
  "File",
  "Headers",
  "History",
  "Location",
  "Node",
  "Range",
  "Request",
  "Response",
  "Selection",
  "Storage",
  "Text",
  "URL",
  "Window",
  "Array",
  "Boolean",
  "Date",
  "Error",
  "Function",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Partial",
  "Promise",
  "Readonly",
  "Record",
  "RegExp",
  "Required",
  "Set",
  "String",
  "Symbol",
]);

const TYPE_KEYWORDS = [
  "type",
  "properties",
  "required",
  "additionalProperties",
  "unevaluatedProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "$ref",
];
/** Keywords that only validate or annotate; the type stays as without them. */
const IGNORED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$defs",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  "dependentRequired",
  "minProperties",
  "maxProperties",
  "propertyNames",
  "if",
  "then",
  "else",
]);
const KNOWN_KEYWORDS = new Set([...TYPE_KEYWORDS, ...IGNORED_KEYWORDS]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const pascal = (s) =>
  s
    .split(/[-_.]/)
    .filter((p) => p !== "")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");

// Type nodes. `prim` is string, number, boolean, null, unknown or never.
const prim = (t) => ({ k: "prim", t });
const UNKNOWN = prim("unknown");
const NEVER = prim("never");
const lit = (v, at) => {
  if (v !== null && typeof v === "object") {
    throw new Error(`${at}: const or enum with an object or array value is not supported`);
  }
  return { k: "lit", v };
};

/**
 * Turns schemas into TypeScript source.
 * @param {{ schemas: Record<string, object>, meta: object, catalog: { commands: object[] } }} contracts
 *   `schemas` by file name (`common.schema.json`), `meta` = commands/catalog.meta.schema.json.
 * @param {{ renames?: Record<string, string> }} [options] `renames` replaces RENAMES (tests).
 * @returns {string}
 */
export function generateTypes({ schemas, meta, catalog }, { renames = RENAMES } = {}) {
  /**
   * key `<file>#` or `<file>#/$defs/<name>` -> { name, schema, file, node, building, and for
   * command input `withDefaults`, `fillName`, `fillNode`, `fillBuilding` }: the variant
   * `<name>WithDefaults` exists only when the schema reaches a `default`.
   */
  const named = new Map();
  const names = new Map();
  const claim = (name, owner) => {
    if (RESERVED.has(name)) {
      throw new Error(`${owner}: generated type name ${name} is a global name; add a rename`);
    }
    if (names.has(name)) {
      throw new Error(`${owner}: generated type name ${name} is also used by ${names.get(name)}`);
    }
    names.set(name, owner);
  };
  const register = (key, schema, file, defaultName) => {
    const name = renames[key] ?? defaultName;
    claim(name, key);
    named.set(key, { name, schema, file });
  };
  const hasType = (s) => s === false || (isObject(s) && TYPE_KEYWORDS.some((k) => k in s));

  const files = Object.keys(schemas).sort();
  for (const file of files) {
    const s = schemas[file];
    const base = pascal(file.replace(/\.schema\.json$/, ""));
    if (hasType(s)) {
      register(`${file}#`, s, file, `${base}File`);
    }
    for (const [def, ds] of Object.entries(s.$defs ?? {})) {
      register(
        `${file}#/$defs/${def}`,
        ds,
        file,
        file === "common.schema.json" ? pascal(def) : base + pascal(def),
      );
    }
  }
  const metaFile = "commands/catalog.meta.schema.json";
  register(`${metaFile}#`, meta, metaFile, "CatalogMeta");
  for (const key of Object.keys(renames)) {
    if (!named.has(key)) {
      throw new Error(`rename of ${key}: no such schema`);
    }
  }

  const resolveRef = (ref, file) => {
    const m = /^((?:\.\.\/)?[a-z][a-z.-]*\.schema\.json)?(?:#(\/\$defs\/[A-Za-z0-9_-]+)?)?$/.exec(ref);
    if (!m) {
      throw new Error(`${file}: unsupported $ref ${ref}`);
    }
    const target =
      m[1] === undefined ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
    const key = `${target}#${m[2] ?? ""}`;
    if (!named.has(key)) {
      throw new Error(`${file}: $ref ${ref} points to nothing (${key})`);
    }
    return key;
  };

  /** The node of a named schema or its input variant, built on first use (refs make the order arbitrary). */
  const nodeOf = (key, fill = false) => {
    const entry = named.get(key);
    const [nodeKey, flag] = fill ? ["fillNode", "fillBuilding"] : ["node", "building"];
    if (entry[nodeKey] === undefined && entry[flag] !== true) {
      entry[flag] = true;
      entry[nodeKey] = toNode(entry.schema, { file: entry.file, fill, at: key });
      entry[flag] = false;
    }
    return entry[nodeKey];
  };
  /** Whether Ajv (useDefaults) fills a `default` somewhere in `s`: properties, items, allOf, $ref. */
  const reachesDefault = (s, file, seen) => {
    if (!isObject(s)) {
      return false;
    }
    if (s.$ref !== undefined) {
      const key = resolveRef(s.$ref, file);
      if (!seen.has(key)) {
        seen.add(key);
        const entry = named.get(key);
        if (reachesDefault(entry.schema, entry.file, seen)) {
          return true;
        }
      }
    }
    const props = Object.values(s.properties ?? {});
    if (props.some((ps) => isObject(ps) && "default" in ps)) {
      return true;
    }
    return [...props, s.items, s.additionalProperties, ...(s.allOf ?? [])].some((sub) =>
      reachesDefault(sub, file, seen),
    );
  };
  /** Whether command input refers to `<name>WithDefaults` instead of the plain type. */
  const hasInputVariant = (key) => {
    const entry = named.get(key);
    if (entry.withDefaults === undefined) {
      entry.withDefaults = reachesDefault(entry.schema, entry.file, new Set([key]));
      if (entry.withDefaults) {
        entry.fillName = `${entry.name}WithDefaults`;
        claim(entry.fillName, `${key} with defaults`);
      }
    }
    return entry.withDefaults;
  };
  /** string/number/boolean/null when the node is that primitive or a ref chain to it. */
  const primOf = (node) => {
    if (node.k === "prim" && node.t !== "unknown" && node.t !== "never") {
      return node.t;
    }
    if (node.k === "ref") {
      const target = nodeOf(node.key, node.fill === true);
      return target === undefined ? undefined : primOf(target);
    }
    return undefined;
  };
  const litPrim = (v) => (v === null ? "null" : typeof v);

  // Unions and intersections are simplified the way the type checker sees them, so the output has
  // no redundant or duplicate constituents (typescript-eslint strict rules): `"core" | ElementRef`
  // is `string` when ElementRef is a string, `Uuid | ShortId` is `string`.
  const union = (members) => {
    let flat = members.flatMap((m) => (m.k === "union" ? m.members : [m]));
    if (flat.some((m) => m.k === "prim" && m.t === "unknown")) {
      return UNKNOWN;
    }
    flat = flat.filter((m) => !(m.k === "prim" && m.t === "never"));
    for (const p of ["string", "number", "boolean", "null"]) {
      const group = flat.filter((m) => primOf(m) === p);
      if (group.length === 0) {
        continue;
      }
      flat = flat.filter((m) => !(m.k === "lit" && litPrim(m.v) === p));
      if (group.length > 1) {
        const first = flat.indexOf(group[0]);
        flat = flat.filter((m, i) => i === first || !group.includes(m));
        flat[first] = prim(p);
      }
    }
    flat = dedupe(flat);
    return flat.length === 0 ? NEVER : flat.length === 1 ? flat[0] : { k: "union", members: flat };
  };
  const intersection = (parts) => {
    let flat = parts.flatMap((p) => (p.k === "inter" ? p.parts : [p]));
    if (flat.some((p) => p.k === "prim" && p.t === "never")) {
      return NEVER;
    }
    flat = dedupe(flat.filter((p) => !(p.k === "prim" && p.t === "unknown")));
    return flat.length === 0 ? UNKNOWN : flat.length === 1 ? flat[0] : { k: "inter", parts: flat };
  };
  const dedupe = (nodes) => {
    const seen = new Set();
    return nodes.filter((n) => {
      const text = print(n, 0);
      if (seen.has(text)) {
        return false;
      }
      seen.add(text);
      return true;
    });
  };

  const checkKeywords = (s, at) => {
    for (const k of Object.keys(s)) {
      if (!KNOWN_KEYWORDS.has(k)) {
        throw new Error(`${at}: keyword ${k} is not supported by scripts/contracts/types.mjs`);
      }
    }
  };

  /**
   * ctx.file: the schema file refs are relative to. ctx.fill (command input): `default` makes a
   * property required, because the input validator fills it in (Ajv useDefaults), also through
   * allOf and $ref: a referenced schema that reaches a default is used as `<name>WithDefaults`.
   * Off below anyOf and oneOf, where Ajv does not apply defaults.
   */
  function toNode(s, ctx) {
    if (s === true) {
      return UNKNOWN;
    }
    if (s === false) {
      return NEVER;
    }
    checkKeywords(s, ctx.at);
    if (s.not === true || (isObject(s.not) && Object.keys(s.not).length === 0)) {
      return NEVER;
    }
    if (s.allOf !== undefined && s.unevaluatedProperties === false) {
      return mergedObject(s, ctx);
    }
    const parts = [refNode(s, ctx), valueNode(s, ctx)].filter((p) => p !== undefined);
    const branch = { ...ctx, fill: false };
    for (const k of ["anyOf", "oneOf"]) {
      if (s[k] !== undefined) {
        parts.push(union(s[k].map((x, i) => toNode(x, { ...branch, at: `${ctx.at}/${k}/${i}` }))));
      }
    }
    if (s.allOf !== undefined) {
      parts.push(...s.allOf.map((x, i) => toNode(x, { ...ctx, at: `${ctx.at}/allOf/${i}` })));
    }
    return intersection(parts);
  }

  /** `$ref`, to the input variant where command input reaches a default through it. */
  function refNode(s, ctx) {
    if (s.$ref === undefined) {
      return undefined;
    }
    const key = resolveRef(s.$ref, ctx.file);
    return ctx.fill && hasInputVariant(key) ? { k: "ref", key, fill: true } : { k: "ref", key };
  }

  /** const, else enum, else the type keywords; undefined when the schema has none of them. */
  function valueNode(s, ctx) {
    if ("const" in s) {
      return lit(s.const, ctx.at);
    }
    if (s.enum !== undefined) {
      return union(s.enum.map((v) => lit(v, ctx.at)));
    }
    const typed = ["type", "properties", "required", "additionalProperties", "items"].some((k) => k in s);
    return typed ? baseNode(s, ctx) : undefined;
  }

  function baseNode(s, ctx) {
    let types = s.type === undefined ? [] : [s.type].flat();
    if (types.length === 0) {
      types = "items" in s ? ["array"] : ["object"];
    }
    return union(
      types.map((t) => {
        switch (t) {
          case "string":
          case "number":
          case "boolean":
          case "null":
            return prim(t);
          case "integer":
            return prim("number");
          case "array":
            return {
              k: "array",
              item: s.items === undefined ? UNKNOWN : toNode(s.items, { ...ctx, at: `${ctx.at}/items` }),
            };
          case "object":
            return objectNode(
              s,
              ctx,
              Object.entries(s.properties ?? {}).map(([n, ps]) => [n, ps, ctx]),
              s.required,
            );
          default:
            throw new Error(`${ctx.at}: unknown type ${t}`);
        }
      }),
    );
  }

  /** props: [name, schema, ctx] so merged properties keep the file they came from. */
  function objectNode(s, ctx, props, required = []) {
    const req = new Set(required);
    const ap = s.additionalProperties;
    const closed = ap === false || s.unevaluatedProperties === false;
    // Type of a property that `properties` does not list.
    const other = closed
      ? NEVER
      : ap === undefined || ap === true
        ? UNKNOWN
        : toNode(ap, { ...ctx, at: `${ctx.at}/additionalProperties` });
    const nodes = props.map(([name, ps, pctx]) => ({
      name,
      doc: isObject(ps) ? ps.description : undefined,
      type: toNode(ps, { ...pctx, at: `${pctx.at}/properties/${name}` }),
      optional: !req.has(name) && !(pctx.fill && isObject(ps) && "default" in ps),
    }));
    for (const name of req) {
      if (!nodes.some((p) => p.name === name)) {
        nodes.push({ name, doc: undefined, type: other, optional: false });
      }
    }
    // Only `required` (a oneOf branch next to `properties`): a constraint on the object it is
    // combined with, so no index signature of its own.
    const constraintOnly = !("type" in s) && !("properties" in s) && ap === undefined;
    let index;
    if (!closed && !constraintOnly) {
      index = other;
      if (nodes.length > 0) {
        index = union([index, ...nodes.map((p) => p.type)]);
      }
    }
    if (nodes.length === 0) {
      return { k: "record", value: index ?? NEVER };
    }
    return { k: "object", props: nodes, index };
  }

  /**
   * allOf of object schemas with `unevaluatedProperties: false` is one closed object with the
   * properties of all parts (metamodel types: `named` plus their own keys).
   */
  function mergedObject(s, ctx) {
    const own = ["$ref", "anyOf", "oneOf", "enum", "const", "items"].filter((k) => k in s);
    if (own.length > 0) {
      throw new Error(`${ctx.at}: allOf with unevaluatedProperties and ${own.join(", ")} is not supported`);
    }
    const props = new Map();
    const required = new Set();
    s.allOf.forEach((part, i) => {
      let schema = part;
      let pctx = { ...ctx, at: `${ctx.at}/allOf/${i}` };
      if (isObject(part) && part.$ref !== undefined && Object.keys(part).length === 1) {
        const key = resolveRef(part.$ref, ctx.file);
        const entry = named.get(key);
        schema = entry.schema;
        pctx = { file: entry.file, fill: ctx.fill, at: key };
      }
      // additionalProperties in a part would reject or constrain the properties of the other parts.
      const nested = [
        "$ref",
        "anyOf",
        "oneOf",
        "allOf",
        "enum",
        "const",
        "items",
        "additionalProperties",
      ].filter((k) => isObject(schema) && k in schema);
      if (!isObject(schema) || nested.length > 0) {
        throw new Error(`${pctx.at}: allOf with unevaluatedProperties needs plain object schemas`);
      }
      checkKeywords(schema, pctx.at);
      for (const [n, ps] of Object.entries(schema.properties ?? {})) {
        props.set(n, [n, ps, pctx]);
      }
      for (const r of schema.required ?? []) {
        required.add(r);
      }
    });
    for (const [n, ps] of Object.entries(s.properties ?? {})) {
      // `key: true` only declares the key as evaluated; the part already gives its type.
      if (!(ps === true && props.has(n))) {
        props.set(n, [n, ps, ctx]);
      }
    }
    for (const r of s.required ?? []) {
      required.add(r);
    }
    return objectNode({ additionalProperties: false }, ctx, [...props.values()], [...required]);
  }

  // Printing.
  const indent = (level) => "  ".repeat(level);
  const doc = (text, level, extra) => {
    const lines = [text, extra].filter((l) => l !== undefined && l !== "");
    if (lines.length === 0) {
      return "";
    }
    const body = lines.map((l) => l.replaceAll("*/", "*\\/").replace(/\s*\n\s*/g, " "));
    return body.length === 1
      ? `${indent(level)}/** ${body[0]} */\n`
      : `${indent(level)}/**\n${body.map((l) => `${indent(level)} * ${l}\n`).join("")}${indent(level)} */\n`;
  };
  /** ` text`, or `text` when it starts on a new line (multi-line union). */
  const after = (text) => (text.startsWith("\n") ? text : ` ${text}`);
  const propName = (n) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n) ? n : JSON.stringify(n));
  const members = (node, level) => {
    const lines = node.props.map(
      (p) =>
        `${doc(p.doc, level)}${indent(level)}readonly ${propName(p.name)}${p.optional ? "?" : ""}:${after(print(p.type, level))};\n`,
    );
    if (node.index !== undefined) {
      lines.push(`${indent(level)}readonly [key: string]:${after(print(node.index, level))};\n`);
    }
    return lines.join("");
  };
  const wrap = (node, level, kinds) =>
    kinds.includes(node.k) ? `(${print(node, level)})` : print(node, level);
  function print(node, level) {
    switch (node.k) {
      case "prim":
        return node.t;
      case "lit":
        return JSON.stringify(node.v);
      case "ref":
        return node.fill === true ? named.get(node.key).fillName : named.get(node.key).name;
      case "array":
        return `readonly ${wrap(node.item, level, ["union", "inter", "array"])}[]`;
      case "record":
        return `Readonly<Record<string,${after(print(node.value, level))}>>`;
      case "object":
        return `{\n${members(node, level + 1)}${indent(level)}}`;
      case "union": {
        const parts = node.members.map((m) => wrap(m, level + 1, ["inter"]));
        const oneLine = parts.join(" | ");
        // Long or multi-line unions get one member per line, each starting with `|`.
        return oneLine.length > 80 || oneLine.includes("\n")
          ? parts.map((p) => `\n${indent(level + 1)}| ${p}`).join("")
          : oneLine;
      }
      case "inter":
        return node.parts.map((p) => wrap(p, level, ["union"])).join(" & ");
      default:
        throw new Error(`unknown node ${node.k}`);
    }
  }
  const declare = (name, node, docText, source) => {
    const head = doc(docText, 0, `Schema: \`${source}\`.`);
    return node.k === "object"
      ? `${head}export interface ${name} {\n${members(node, 1)}}\n`
      : `${head}export type ${name} =${after(print(node, 0))};\n`;
  };

  // Build everything before printing: command inputs and input variants ask for further variants.
  for (const key of named.keys()) {
    nodeOf(key);
  }
  /** [name, node, doc, source] of a command's input or output type. */
  const commandType = (cmd, part) => {
    const name = `${pascal(cmd.name)}${pascal(part)}`;
    claim(name, `${cmd.name} ${part}`);
    const at = `commands/catalog.json ${cmd.name}.${part}`;
    const node = toNode(cmd[part], { file: "commands/catalog.json", fill: part === "input", at });
    const note =
      part === "input"
        ? `Input of \`${cmd.name}\` as \`run\` gets it: validated, properties with a \`default\` filled in.`
        : `Output of \`${cmd.name}\`.`;
    return [name, node, `${note} ${cmd.summary}`, `schemas/commands/catalog.json ${cmd.name} ${part}`];
  };
  const commandDecls = [];
  const map = [];
  for (const cmd of catalog.commands) {
    const [input, output] = [commandType(cmd, "input"), commandType(cmd, "output")];
    commandDecls.push(input, output);
    map.push(
      `  readonly ${JSON.stringify(cmd.name)}: { readonly input: ${input[0]}; readonly output: ${output[0]} };\n`,
    );
  }
  const unbuilt = () =>
    [...named.keys()].filter(
      (k) => named.get(k).withDefaults === true && named.get(k).fillNode === undefined,
    );
  for (let pending = unbuilt(); pending.length > 0; pending = unbuilt()) {
    pending.forEach((k) => nodeOf(k, true));
  }

  /** The type of a named schema, followed by its input variant if it has one. */
  const namedDecls = ([key, entry]) => {
    const plain = declare(
      entry.name,
      entry.node,
      entry.schema.description ?? entry.schema.title,
      `schemas/${key}`,
    );
    if (entry.withDefaults !== true) {
      return [plain];
    }
    const note = `\`${entry.name}\` in command input: properties with a \`default\` filled in (Ajv useDefaults).`;
    return [plain, declare(entry.fillName, entry.fillNode, note, `schemas/${key}`)];
  };
  const out = [...named].flatMap(namedDecls);
  out.push(...commandDecls.map((d) => declare(...d)));
  out.push(
    `/** Input and output type of every catalog command, by name (\`defineCommand\` in catalog.ts). */\nexport interface CommandTypes {\n${map.join("")}}\n`,
  );
  return [
    "// Generated by scripts/contracts/generate.mjs from schemas/ (ADR-0003). Do not edit:",
    "// change the schema or the catalog and run `pnpm contracts:generate`.\n",
    ...out,
  ].join("\n");
}
