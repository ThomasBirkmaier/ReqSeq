// Loads the JSON Schemas of schemas/ and the command catalog for runtime validation (ADR-0003).
// Same Ajv options as scripts/contracts/load.mjs, so `pnpm schemas:check` and the runtime agree.
// The schemas come from generated/contracts.json (pnpm contracts:generate; contracts:check keeps it
// equal to schemas/), so the package needs no schemas folder at run time (ADR-0014).
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { CommandEffect, JsonSchema } from "../catalog.js";
import bundle from "../generated/contracts.json" with { type: "json" };

/** `$id` prefix of every schema; an identifier only, never fetched (no network, N-047). */
export const SCHEMA_BASE = "https://logreq.dev/schemas/";

/**
 * One entry of `schemas/commands/catalog.json` (shape checked by `catalog.meta.schema.json`).
 * Hand-written until the types are generated from the schemas (ADR-0003, #134).
 */
export interface CatalogEntry {
  readonly name: string;
  readonly summary: string;
  readonly effect: CommandEffect;
  readonly stage: number;
  readonly implements: readonly string[];
  readonly input: JsonSchema;
  readonly output: JsonSchema;
}

export type SchemaPart = "input" | "output";

/** One failed schema check, as reported in `CommandError.details.errors`. */
export interface SchemaViolation {
  /** JSON Pointer into the checked value; `""` is the value itself. */
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface Contracts {
  /** All catalog entries in catalog order. */
  readonly commands: readonly CatalogEntry[];
  entry(name: string): CatalogEntry | undefined;
  /**
   * Compiled validator of a command's input or output schema (compiled on first use).
   * The input validator fills in `default` values; the output validator changes nothing.
   */
  validator(name: string, part: SchemaPart): ValidateFunction;
}

export interface LoadContractsOptions {
  /** Use this catalog instead of `commands/catalog.json` (tests with test-only commands). */
  readonly catalog?: unknown;
}

/** generated/contracts.json: every `schemas/*.schema.json`, `catalog.meta.schema.json` and the catalog. */
export interface ContractsBundle {
  readonly schemas: readonly JsonSchema[];
  readonly catalogMeta: JsonSchema;
  readonly catalog: unknown;
}

/** The schemas and the catalog of this version of LogReq. */
export const contractsBundle = bundle as unknown as ContractsBundle;

const createAjv = (useDefaults: boolean, schemas: readonly JsonSchema[]): Ajv2020 => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allowUnionTypes: true,
    useDefaults,
  });
  addFormats.default(ajv);
  for (const schema of schemas) {
    ajv.addSchema(schema);
  }
  return ajv;
};

/** Ajv errors as plain data for `CommandError.details`. */
export const schemaViolations = (errors: readonly ErrorObject[] | null | undefined): SchemaViolation[] =>
  (errors ?? []).map((e) => ({
    path: e.instancePath,
    keyword: e.keyword,
    message: e.message ?? e.keyword,
    params: e.params,
  }));

/** One line per violation, e.g. `/ref must match pattern "..."`. */
export const describeViolations = (violations: readonly SchemaViolation[]): string =>
  violations.map((v) => `${v.path === "" ? "(root)" : v.path} ${v.message}`).join("; ");

// Validators of the file format schemas. Compiled schemas only, never workspace state, so one
// instance per process is not a global in the sense of ADR-0002 rule 7 (like the command runtime).
let fileSchemas: Ajv2020 | undefined;

/**
 * Validator of a file format schema of `schemas/`, e.g. `workspace.schema.json` (ADR-0003), with
 * the Ajv options of `loadContracts`. Changes nothing (no defaults filled in). Throws a plain
 * `Error` for a name that is not a schema (a programming error).
 */
export function fileSchemaValidator(file: string): ValidateFunction {
  fileSchemas ??= createAjv(false, contractsBundle.schemas);
  const validate = fileSchemas.getSchema(`${SCHEMA_BASE}${file}`);
  if (validate === undefined) {
    throw new Error(`no schema ${file} in schemas/`);
  }
  return validate;
}

/**
 * Prepare validation for all schemas and the catalog. Throws a plain `Error` when the catalog does not match
 * `catalog.meta.schema.json` or names a command twice: that is a programming error, not a user error.
 */
export function loadContracts(options: LoadContractsOptions = {}): Contracts {
  const catalog = options.catalog ?? contractsBundle.catalog;
  const inputAjv = createAjv(true, contractsBundle.schemas);
  const outputAjv = createAjv(false, contractsBundle.schemas);
  const checkCatalog = outputAjv.compile(contractsBundle.catalogMeta);
  if (!checkCatalog(catalog)) {
    throw new Error(`invalid command catalog: ${describeViolations(schemaViolations(checkCatalog.errors))}`);
  }
  const commands = (catalog as { readonly commands: readonly CatalogEntry[] }).commands;
  const byName = new Map<string, CatalogEntry>();
  for (const entry of commands) {
    if (byName.has(entry.name)) {
      throw new Error(`invalid command catalog: ${entry.name} is listed twice`);
    }
    byName.set(entry.name, entry);
  }

  const compiled = new Map<string, ValidateFunction>();
  return {
    commands,
    entry: (name) => byName.get(name),
    validator(name, part) {
      const key = `${name}.${part}`;
      const cached = compiled.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const entry = byName.get(name);
      if (entry === undefined) {
        throw new Error(`no catalog entry ${name}`);
      }
      // Command schemas use refs relative to schemas/commands/, e.g. ../common.schema.json#/$defs/uuid.
      const schema = { ...entry[part], $id: `${SCHEMA_BASE}commands/${key}.json` };
      const validate = (part === "input" ? inputAjv : outputAjv).compile(schema);
      compiled.set(key, validate);
      return validate;
    },
  };
}
