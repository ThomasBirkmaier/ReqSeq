// Loads the JSON Schemas of schemas/ and the command catalog for runtime validation (ADR-0003).
// Same Ajv options as scripts/contracts/load.mjs, so `pnpm schemas:check` and the runtime agree, except
// that the bundled schemas are not checked against the meta-schema again at run time (#178, `createAjv`).
// The schemas come from generated/contracts.json (pnpm contracts:generate; contracts:check keeps it
// equal to schemas/), so the package needs no schemas folder at run time (ADR-0014).
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JsonSchema } from "../catalog.js";
import bundle from "../generated/contracts.json" with { type: "json" };
import type { CommandCatalog } from "../generated/types.js";

/** `$id` prefix of every schema; an identifier only, never fetched (no network, N-047). */
export const SCHEMA_BASE = "https://reqseq.dev/schemas/";

/** One entry of the catalog, `schemas/commands/<name>.json` (shape checked by `catalog.meta.schema.json`). */
export type CatalogEntry = CommandCatalog["commands"][number];

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
  /** The `schemas/*.schema.json` that `$ref`s of the catalog resolve against (by `$id`). */
  readonly schemas: readonly JsonSchema[];
  entry(name: string): CatalogEntry | undefined;
  /**
   * Compiled validator of a command's input or output schema (compiled on first use).
   * The input validator fills in `default` values; the output validator changes nothing.
   */
  validator(name: string, part: SchemaPart): ValidateFunction;
}

export interface LoadContractsOptions {
  /** Use this catalog instead of the product catalog (tests with test-only commands). */
  readonly catalog?: unknown;
}

/** generated/contracts.json: every `schemas/*.schema.json`, `catalog.meta.schema.json` and the catalog. */
export interface ContractsBundle {
  readonly schemas: readonly JsonSchema[];
  readonly catalogMeta: JsonSchema;
  readonly catalog: unknown;
}

/** The schemas and the catalog of this version of ReqSeq. */
export const contractsBundle = bundle as unknown as ContractsBundle;

// `verbose` (input, and files that failed) gives each error its schema, which `inputViolations` reads for readable messages.
// `validateSchema` checks each schema against the JSON Schema meta-schema when it is added or compiled: off
// for the bundled schemas and catalog, which `pnpm schemas:check` compiles and checks on every pull
// request with the options of load.mjs (contracts:check keeps the bundle equal to schemas/), so a start
// does not pay for it on each Ajv instance (#178); on for a catalog passed in (tests).
const createAjv = (useDefaults: boolean, verbose = false, validateSchema = false): Ajv2020 => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allowUnionTypes: true,
    useDefaults,
    verbose,
    validateSchema,
  });
  addFormats.default(ajv);
  for (const schema of contractsBundle.schemas) {
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

/** The bundled schemas without defaults and `verbose`: file formats and command outputs share it. */
const plainSchemas = (): Ajv2020 => (fileSchemas ??= createAjv(false));

/**
 * Validator of a file format schema of `schemas/`, e.g. `workspace.schema.json` (ADR-0003), with
 * the Ajv options of `loadContracts`. Changes nothing (no defaults filled in). Throws a plain
 * `Error` for a name that is not a schema (a programming error).
 */
export function fileSchemaValidator(file: string): ValidateFunction {
  const validate = plainSchemas().getSchema(`${SCHEMA_BASE}${file}`);
  if (validate === undefined) {
    throw new Error(`no schema ${file} in schemas/`);
  }
  return validate;
}

// The same schemas with `verbose`, built only when a file failed (#160): `verbose` keeps each error's
// schema for `inputViolations`, and the plain validator stays on the hot paths (UUID checks).
let verboseFileSchemas: Ajv2020 | undefined;

/**
 * The errors of `data` against a file format schema, with each error's schema (Ajv `verbose`), for
 * `inputViolations` after `fileSchemaValidator(file)` refused `data` (#160). Empty when `data` is valid.
 */
export function fileSchemaErrors(file: string, data: unknown): readonly ErrorObject[] {
  verboseFileSchemas ??= createAjv(false, true);
  const validate = verboseFileSchemas.getSchema(`${SCHEMA_BASE}${file}`);
  if (validate === undefined) {
    throw new Error(`no schema ${file} in schemas/`);
  }
  // A refused value always has errors.
  return validate(data) === true ? [] : (validate.errors as readonly ErrorObject[]);
}

/**
 * Prepare validation for all schemas and the catalog. A catalog passed in (tests) is checked against
 * `catalog.meta.schema.json` here, and throws a plain `Error` when it does not match; the bundled one is
 * checked by `pnpm schemas:check` on every pull request, so a start does not check it again (#178).
 * Throws a plain `Error` when the catalog names a command twice. Both are programming errors, not user
 * errors. The validators are built on the first call of `validator` (#178): `--version` builds none.
 */
export function loadContracts(options: LoadContractsOptions = {}): Contracts {
  const given = options.catalog !== undefined;
  const catalog = options.catalog ?? contractsBundle.catalog;
  let inputAjv: Ajv2020 | undefined;
  let outputAjv: Ajv2020 | undefined;
  if (given) {
    outputAjv = createAjv(false, false, true);
    const checkCatalog = outputAjv.compile(contractsBundle.catalogMeta);
    if (!checkCatalog(catalog)) {
      throw new Error(
        `invalid command catalog: ${describeViolations(schemaViolations(checkCatalog.errors))}`,
      );
    }
  }
  const ajvOf = (part: SchemaPart): Ajv2020 =>
    part === "input" ? (inputAjv ??= createAjv(true, true, given)) : (outputAjv ??= plainSchemas());
  const commands = (catalog as CommandCatalog).commands;
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
    schemas: contractsBundle.schemas,
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
      // The output instance of the bundled catalog is shared by every `loadContracts()` of the process
      // (`plainSchemas`): a schema another one compiled already is taken as it is.
      const ajv = ajvOf(part);
      const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
      compiled.set(key, validate);
      return validate;
    },
  };
}
