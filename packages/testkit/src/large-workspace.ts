// Generator for large workspaces (ADR-0011, D-055, N-036): by default 50,000 elements with 200,000
// relations of the standard model in four repositories, the same bytes for the same seed on every
// machine. Large workspaces are generated, never committed (fixtures/README.md).
// This package is test tooling and never shipped; it cannot import `@reqseq/core` (core's tests
// import the testkit), so the caller passes the version function (ADR-0005), and core's tests
// check that what core reads back matches it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FixtureWorkspace } from "./fixture-workspace.js";
import { createFixtureWorkspace, initRepository } from "./fixture-workspace.js";

/** The standard model as shipped (`schemas/examples/metamodel/standard-model.yaml`). */
export const defaultStandardModelFile: string = fileURLToPath(
  new URL("../../../schemas/examples/metamodel/standard-model.yaml", import.meta.url),
);

/** The identifier property the generator adds to the metamodel it writes (#305), as the ReqSeq spec has it. */
export const SPEC_ID_KEY = "spec-id";

const TOP_PROPERTIES = "\nproperties:\n";

/**
 * `model` (metamodel file text) with the property `spec-id` of meaning `identifier` (#305) added to
 * the property list and first to every type's `properties`, so that the elements the generator
 * writes carry a spec ID such as `SR-036` and the performance runs cover identifiers. Unchanged
 * when the text has no top-level `properties:` list or a property with that meaning already.
 */
export const withSpecIdProperty = (model: string): string => {
  const at = model.indexOf(TOP_PROPERTIES);
  if (at < 0 || model.includes("meaning: identifier")) {
    return model;
  }
  const types = model.slice(0, at).replace(/(\bproperties:\s*\[\s*)/g, `$1${SPEC_ID_KEY}, `);
  return `${types}${TOP_PROPERTIES}  - { key: ${SPEC_ID_KEY}, name: Spec ID, kind: text, meaning: identifier }\n${model.slice(at + TOP_PROPERTIES.length)}`;
};

/** Default seed of the performance runs (N-036). */
export const DEFAULT_SEED = 36;
/** Element and relation counts of N-036, SR-020 and SR-082. */
export const DEFAULT_ELEMENTS = 50_000;
export const DEFAULT_RELATIONS = 200_000;

/** What the version of an element is computed from (ADR-0005). */
export interface VersionSubject {
  readonly type: string;
  /** The Markdown text below the frontmatter, exactly as written into the file. */
  readonly text: string;
  /**
   * The frontmatter values except relation kinds, which never count to the version (ADR-0005):
   * `id`, `type`, `status`, the properties and the relation-valued properties (`validity`, `packages`).
   */
  readonly properties: Readonly<Record<string, unknown>>;
}

/** The version (ADR-0005) of an element; core's tests pass `computeVersion` with the metamodel. */
export type VersionFunction = (element: VersionSubject) => string;

export interface LargeWorkspaceOptions {
  /** Computes the version that relations store for their target. */
  readonly version: VersionFunction;
  /** Default `DEFAULT_SEED`. The same seed always gives the same files. */
  readonly seed?: number;
  /** Number of elements, at least 6 (one of each type). Default 50,000. */
  readonly elements?: number;
  /**
   * Number of relation targets in all files: relation kinds and relation-valued properties
   * (`validity`, `packages`), which carry a version like any relation (ADR-0004). Default 200,000.
   */
  readonly relations?: number;
  /** Text of the metamodel file. Default: the standard model (`defaultStandardModelFile`). */
  readonly metamodel?: string;
}

export interface GeneratedRepository {
  /** Workspace name. */
  readonly name: string;
  /** Folder relative to the root of the generated tree. */
  readonly folder: string;
}

export interface GeneratedElement {
  readonly id: string;
  readonly type: string;
  readonly repository: string;
  /** Relative to its repository, `/` as separator. */
  readonly file: string;
  readonly title: string;
  readonly version: string;
}

export interface GeneratedWorkspace {
  readonly seed: number;
  /** Folder of the main repository (with `reqseq-workspace.yaml`), relative to the root of the tree. */
  readonly main: string;
  readonly repositories: readonly GeneratedRepository[];
  /** In generation order: needs, use cases, decisions, variants, packages, system requirements. */
  readonly elements: readonly GeneratedElement[];
  /** Number of relation targets written. */
  readonly relations: number;
  /** Number of inline references written in the texts (about 2 per element, ADR-0004). */
  readonly references: number;
  /**
   * Number of inline references written in acceptance criteria (SR-127, `withCriterionReference`):
   * one in every tenth system requirement, in addition to `references`.
   */
  readonly criterionReferences: number;
  /** Every file: path relative to the root of the tree (`/` as separator) to content, in path order. */
  readonly files: ReadonlyMap<string, string>;
  /** SHA-256 over all paths and contents; equal digests mean equal trees. */
  readonly digest: string;
}

const REPOSITORIES: readonly GeneratedRepository[] = [
  { name: "system", folder: "system" },
  { name: "product", folder: "product" },
  { name: "sensor", folder: "sensor" },
  { name: "display", folder: "display" },
];

/** At most this many elements per folder, so that no folder holds tens of thousands of files. */
const FOLDER_SIZE = 1000;

/** Seeded PRNG (mulberry32): the same sequence on every platform. Also used by `withEvidenceRecords`. */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [0, bound). */
  below(bound: number): number {
    return Math.floor(this.next() * bound);
  }

  /** One of `items`, which must not be empty. */
  pick<T>(items: readonly T[]): T {
    return this.pickBefore(items, items.length);
  }

  /** One of `items[0 .. end)`, which must not be empty. */
  pickBefore<T>(items: readonly T[], end: number): T {
    return items[this.below(end)] as T;
  }

  /** A lower-case UUID version 4 that ends with the 12 hex digits of `stem`. */
  uuid(stem: bigint): string {
    const digits = Array.from({ length: 20 }, () => this.below(16).toString(16));
    digits[12] = "4";
    digits[16] = "89ab".charAt(this.below(4));
    const d = digits.join("");
    const end = stem.toString(16).padStart(12, "0");
    return `${d.slice(0, 8)}-${d.slice(8, 12)}-${d.slice(12, 16)}-${d.slice(16, 20)}-${end}`;
  }
}

const MASK_48 = (1n << 48n) - 1n;

/**
 * A bijection on 48 bits (xorshifts and odd multipliers): distinct inputs give distinct file name
 * stems (D-056) and so distinct UUIDs, while the last 6 digits still collide now and then, as those
 * of random UUIDs do, so some short IDs get longer (SR-084).
 */
const mix48 = (value: bigint): bigint => {
  let x = value & MASK_48;
  x ^= x >> 23n;
  x = (x * 0x9e3779b97f4bn) & MASK_48;
  x ^= x >> 25n;
  x = (x * 0xc2b2ae3d27d5n) & MASK_48;
  return x ^ (x >> 24n);
};

const VERBS = [
  "Show",
  "Record",
  "Report",
  "Store",
  "Check",
  "Send",
  "Compute",
  "Display",
  "Log",
  "Warn about",
];
const NOUNS = [
  "wind speed",
  "wind direction",
  "gusts",
  "air pressure",
  "temperature",
  "humidity",
  "rainfall",
  "battery level",
  "sensor state",
  "solar radiation",
];
const PLACES = ["on the display", "in the log", "to the server", "in the app", "at the mast", "every minute"];
const REQUIREMENT_TYPES = ["functional", "quality", "performance", "interface", "constraint"];
const METHODS = ["test", "analysis", "inspection", "demonstration"];

interface Draft {
  readonly id: string;
  readonly spec: TypeSpec;
  /** Index among the elements of its type, in generation order. */
  readonly position: number;
  /** A system requirement that never gets a validity, so variants may exclude it (SR-042). */
  readonly core: boolean;
  readonly repository: string;
  readonly file: string;
  readonly title: string;
  /** Gets the inline references once the versions of their targets are known (`withReferences`). */
  text: string;
  /** `id`, `type`, `status`, the title and the other properties, in file order. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Relation key to targets, in the order added. */
  readonly relations: Map<string, Draft[]>;
  /** Set once the targets of its relation-valued properties have theirs. */
  version: string;
}

/** The elements by type, in generation order. */
interface Pools {
  readonly need: Draft[];
  readonly useCase: Draft[];
  readonly decision: Draft[];
  readonly variant: Draft[];
  readonly package: Draft[];
  readonly requirement: Draft[];
  /** The system requirements without validity (core requirements, D-020), in generation order. */
  readonly core: Draft[];
}

/** A relation a source may get: `key` with a target from `targets[0 .. before)`. */
interface RelationChoice {
  readonly key: string;
  readonly weight: number;
  readonly targets: readonly Draft[];
  /** Derivations point only at earlier elements, so there are no cycles. */
  readonly before: number;
}

/** A type of the standard model and how the generator fills it. */
interface TypeSpec {
  readonly key: string;
  readonly prefix: string;
  readonly pool: keyof Pools;
  /** Share of all elements; the system requirements, last, take the rest. */
  readonly share: number;
  readonly repository: (random: Random) => string;
  /** The relations an element of this type may get in the standard model. */
  readonly choices: (draft: Draft, pools: Pools, random: Random) => readonly RelationChoice[];
}

/** A relation that may point at any element of `targets`. */
const any = (key: string, weight: number, targets: readonly Draft[]): RelationChoice => ({
  key,
  weight,
  targets,
  before: targets.length,
});

const inProduct = (): string => "product";
const inSystem = (): string => "system";

/** In generation order: targets of relation-valued properties (variants, packages) come before their sources. */
const TYPES: readonly TypeSpec[] = [
  {
    key: "need",
    prefix: "N",
    pool: "need",
    share: 0.1,
    repository: inProduct,
    choices: (draft, pools) => [
      { key: "refines", weight: 1, targets: pools.need, before: draft.position },
      any("based-on", 1, pools.decision),
    ],
  },
  {
    key: "use-case",
    prefix: "UC",
    pool: "useCase",
    share: 0.06,
    repository: inProduct,
    choices: (_, pools) => [any("refines", 1, pools.need), any("based-on", 1, pools.decision)],
  },
  {
    key: "decision",
    prefix: "D",
    pool: "decision",
    share: 0.06,
    repository: inSystem,
    choices: (draft, pools) => [
      { key: "based-on", weight: 1, targets: pools.decision, before: draft.position },
    ],
  },
  {
    key: "variant",
    prefix: "VAR",
    pool: "variant",
    share: 0.002,
    repository: inSystem,
    choices: (_, pools) => [any("excludes", 1, pools.core)],
  },
  {
    key: "package",
    prefix: "PKG",
    pool: "package",
    share: 0.002,
    repository: inSystem,
    choices: (_, pools) => [any("based-on", 1, pools.decision)],
  },
  {
    key: "system-requirement",
    prefix: "SR",
    pool: "requirement",
    share: 0,
    repository: (random) => random.pick(["system", "system", "sensor", "sensor", "display"]),
    choices: (draft, pools, random) => {
      // Derives from an earlier requirement, a need or a use case.
      const parents = random.pick([pools.requirement, pools.requirement, pools.need, pools.useCase]);
      const before = parents === pools.requirement ? draft.position : parents.length;
      return [
        { key: "derives-from", weight: 6, targets: parents, before },
        any("based-on", 1, pools.decision),
        // Only requirements that are not core requirements hold a validity (D-020).
        any("validity", 1, draft.core ? [] : pools.variant),
        any("packages", 1, pools.package),
      ];
    },
  },
];

/** Properties of a new element besides `id`, `type`, `status` and `title` (standard model). */
const propertiesFor = (spec: TypeSpec, title: string, random: Random): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};
  // Variants and packages have only a title in the standard model.
  if (random.next() < 0.3 && spec.pool !== "variant" && spec.pool !== "package") {
    properties["rationale"] = `Needed so that ${random.pick(NOUNS)} stays visible ${random.pick(PLACES)}`;
  }
  if (spec.pool !== "requirement") {
    return properties;
  }
  properties["requirement-type"] = random.pick(REQUIREMENT_TYPES);
  properties["acceptance-criteria"] = Array.from(
    { length: 1 + random.below(3) },
    (_, n) =>
      `Given the station runs, when ${random.pick(NOUNS)} changes, then ${title.toLowerCase()} within ${String(n + 1)} s`,
  );
  properties["verification-method"] = random.pick(METHODS);
  if (random.next() < 0.1) {
    properties["emergent"] = random.pick(["yes", "no"]);
  }
  return properties;
};

const draftsFor = (elements: number, random: Random, specIds: boolean): Pools => {
  const offset = BigInt(random.below(2 ** 32));
  const pools: Pools = {
    need: [],
    useCase: [],
    decision: [],
    variant: [],
    package: [],
    requirement: [],
    core: [],
  };
  const shareOf = (spec: TypeSpec): number => Math.max(1, Math.floor(elements * spec.share));
  // The system requirements (share 0) take the rest.
  const rest =
    elements - TYPES.filter((spec) => spec.share > 0).reduce((sum, spec) => sum + shareOf(spec), 0);
  let index = 0;
  for (const spec of TYPES) {
    const pool = pools[spec.pool];
    const count = spec.share === 0 ? rest : shareOf(spec);
    for (let position = 0; position < count; position++, index++) {
      const id = random.uuid(mix48(offset + BigInt(index)));
      const title = `${random.pick(VERBS)} ${random.pick(NOUNS)} ${random.pick(PLACES)} ${String(index)}`;
      const folder = `${spec.key}/${String(Math.floor(index / FOLDER_SIZE)).padStart(3, "0")}`;
      const more = random.next() < 0.5 ? "" : `\n\nThis keeps ${random.pick(NOUNS)} in view.`;
      // Most requirements are core requirements (no validity, D-020); variants exclude only those (SR-042).
      const core = spec.pool === "requirement" && random.next() < 0.8;
      const draft: Draft = {
        id,
        spec,
        position,
        core,
        repository: spec.repository(random),
        file: `${folder}/${spec.prefix}-${id.slice(-12)}.md`,
        title,
        text: `\nThe station shall ${title.toLowerCase()}.${more}\n`,
        properties: {
          id,
          type: spec.key,
          status: random.next() < 0.7 ? "draft" : "approved",
          title,
          // A spec ID unique per type (#305); no random draw, so everything else stays as it was.
          ...(specIds ? { [SPEC_ID_KEY]: `${spec.prefix}-${String(position + 1).padStart(3, "0")}` } : {}),
          ...propertiesFor(spec, title, random),
        },
        relations: new Map(),
        version: "",
      };
      pool.push(draft);
      if (core) {
        pools.core.push(draft);
      }
    }
  }
  return pools;
};

/** One of `choices` (not empty) by weight. */
const weighted = (choices: readonly RelationChoice[], random: Random): RelationChoice => {
  let roll = random.next() * choices.reduce((sum, c) => sum + c.weight, 0);
  // Walks on while the roll is past the weight of the choice so far; once it is not, the roll
  // becomes -Infinity and that choice is kept to the end.
  return choices.reduce((chosen, choice) => {
    if (roll < chosen.weight) {
      roll = -Infinity;
      return chosen;
    }
    roll -= chosen.weight;
    return choice;
  });
};

/** Adds exactly `count` distinct relation targets, or throws when they do not fit. */
const addRelations = (drafts: readonly Draft[], pools: Pools, count: number, random: Random): void => {
  const limit = count * 50 + 1000;
  let added = 0;
  for (let attempt = 0; added < count; attempt++) {
    if (attempt > limit) {
      throw new Error(
        `cannot place ${String(count)} distinct relations among ${String(drafts.length)} elements`,
      );
    }
    const source = random.pick(drafts);
    const choice = weighted(source.spec.choices(source, pools, random), random);
    const target = choice.before === 0 ? undefined : choice.targets[random.below(choice.before)];
    const list = source.relations.get(choice.key) ?? [];
    if (target !== undefined && !list.includes(target)) {
      list.push(target);
      source.relations.set(choice.key, list);
      added++;
    }
  }
};

/**
 * Adds 0 to 4 inline references (about 2 on average) to the text of `draft`, which is
 * `drafts[index]`, each to an earlier element, whose version is already known (ADR-0004, D-058):
 * `[<title>](reqseq:<uuid>?version=<version>)` within the source's repository,
 * `[<prefix>-<6 digits>](…&repository=<name>)` across. Returns how many were added. So the cold
 * load and the cache measure reading references too (#240).
 */
const withReferences = (draft: Draft, drafts: readonly Draft[], index: number, random: Random): number => {
  const count = index === 0 ? 0 : random.below(5);
  const links = Array.from({ length: count }, () => {
    const target = random.pickBefore(drafts, index);
    const destination = `reqseq:${target.id}?version=${target.version}`;
    return target.repository === draft.repository
      ? `[${target.title}](${destination})`
      : `[${target.spec.prefix}-${target.id.slice(-6)}](${destination}&repository=${target.repository})`;
  });
  if (count > 0) {
    draft.text = `${draft.text}\nSee ${links.join(" and ")}.\n`;
  }
  return count;
};

/** `items[index]`, which the caller knows exists. */
const itemAt = <T>(items: readonly T[], index: number): T => items[index] as T;

/** Every this many system requirements, one acceptance criterion holds a reference (SR-127). */
const CRITERION_EVERY = 10;
/** The element after which the performance suites change a text: every this many (`outdated-relations`). */
const CHANGED_EVERY = 100;

/**
 * Adds one inline reference to the first acceptance criterion of every tenth system requirement
 * (SR-127), so that the cold load, the cache and the checks measure references in a property that
 * the metamodel marks `markdown`. The target is an earlier element, chosen without a random draw
 * (so every other file of a seed stays as it was): by a hash of the position, and for every third
 * criterion an element the outdated-relations suite changes (every 100th). Returns 1 when added.
 */
const withCriterionReference = (draft: Draft, drafts: readonly Draft[], index: number): number => {
  const criteria = draft.properties["acceptance-criteria"];
  if (index === 0 || !Array.isArray(criteria) || draft.position % CRITERION_EVERY !== 0) {
    return 0;
  }
  const hashed = Math.floor((((index * 2_654_435_761) % 4_294_967_296) / 4_294_967_296) * index);
  const at = draft.position % (3 * CRITERION_EVERY) === 0 ? hashed - (hashed % CHANGED_EVERY) : hashed;
  const target = itemAt(drafts, at);
  const destination = `reqseq:${target.id}?version=${target.version}`;
  const link =
    target.repository === draft.repository
      ? `[${target.title}](${destination})`
      : `[${target.spec.prefix}-${target.id.slice(-6)}](${destination}&repository=${target.repository})`;
  criteria[0] = `${String(criteria[0])}, see ${link}`;
  return 1;
};

/** Relation keys in file order: relation-valued properties first, then relation kinds. */
const RELATION_KEYS = ["validity", "packages", "derives-from", "refines", "based-on", "excludes"];
/** Relation-valued properties count to the version with their target IDs; relation kinds never do (ADR-0005). */
const RELATION_PROPERTIES = new Set(["validity", "packages"]);

type StoredTarget = Readonly<Record<string, string>>;

/** A target as the source stores it (D-058): `title` within its repository, `repository` across. */
const targetOf = (source: Draft, target: Draft): StoredTarget =>
  target.repository === source.repository
    ? { id: target.id, version: target.version, title: target.title }
    : { id: target.id, version: target.version, repository: target.repository };

/** The relations of `draft` in file order, with their targets as stored. */
const relationsOf = (draft: Draft): (readonly [string, StoredTarget[]])[] =>
  [...draft.relations]
    .sort(([a], [b]) => RELATION_KEYS.indexOf(a) - RELATION_KEYS.indexOf(b))
    .map(([key, targets]) => [key, targets.map((target) => targetOf(draft, target))] as const);

/** One line per relation target (ADR-0004): a flow mapping. */
const flowMapping = (target: StoredTarget): string =>
  `{ ${Object.entries(target)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ")} }`;

/** One YAML line or block per key; values are plain scalars by construction (no `: `, `,`, `#`). */
const yamlEntry = (key: string, value: unknown): string => {
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) =>
      typeof item === "string" ? `  - ${item}` : `  - ${flowMapping(item as StoredTarget)}`,
    );
    return `${key}:\n${items.join("\n")}\n`;
  }
  // `yes` and `no` are text in YAML 1.2; quoted they read the same in every YAML version.
  return key === "emergent" ? `${key}: "${String(value)}"\n` : `${key}: ${String(value)}\n`;
};

const workspaceFile = (seed: number): string => {
  const lines = REPOSITORIES.map((r) =>
    r.name === "system"
      ? `  - { name: ${r.name}, url: "git@git.example.com:generated/${r.name}.git", main: true }`
      : `  - { name: ${r.name}, url: "git@git.example.com:generated/${r.name}.git", path: ../${r.folder} }`,
  );
  return [
    "reqseq-workspace: 1",
    `name: Generated workspace (seed ${String(seed)})`,
    "repositories:",
    ...lines,
    "metamodel: { repository: system, path: metamodel }",
    "",
  ].join("\n");
};

/** The frontmatter values of `draft` that count to its version: all but the relation kinds. */
const versionProperties = (draft: Draft): Record<string, unknown> => {
  const values: Record<string, unknown> = { ...draft.properties };
  for (const [key, targets] of relationsOf(draft)) {
    if (RELATION_PROPERTIES.has(key)) {
      values[key] = targets;
    }
  }
  return values;
};

const elementFile = (draft: Draft): string => {
  const entries = Object.entries(draft.properties).map(([key, value]) => yamlEntry(key, value));
  for (const [key, targets] of relationsOf(draft)) {
    entries.push(yamlEntry(key, targets));
  }
  return `---\n${entries.join("")}---\n${draft.text}`;
};

/** `files` in path order and the SHA-256 over all paths and contents (`GeneratedWorkspace.digest`). */
export const sortedTree = (
  files: ReadonlyMap<string, string>,
): { readonly files: ReadonlyMap<string, string>; readonly digest: string } => {
  const sorted = new Map([...files].sort(([a], [b]) => Number(a > b) - Number(a < b)));
  const hash = createHash("sha256");
  for (const [file, content] of sorted) {
    hash.update(`${file}\0${content}\0`);
  }
  return { files: sorted, digest: hash.digest("hex") };
};

/**
 * Generates a workspace in memory: the workspace file and the metamodel in `system`, element files
 * in all four repositories (needs and use cases in `product`; decisions, variants and packages in
 * `system`; system requirements spread over `system`, `sensor` and `display`), each repository in
 * the folder of its name. Relations are written only in the source file, one target per line
 * (ADR-0004); derivations always point at an earlier element, so there are no cycles. Texts hold
 * about 2 inline references per element to earlier elements, some across repositories. Every
 * target stores the version `options.version` gives for it.
 */
export function generateLargeWorkspace(options: LargeWorkspaceOptions): GeneratedWorkspace {
  const seed = options.seed ?? DEFAULT_SEED;
  const count = options.elements ?? DEFAULT_ELEMENTS;
  if (!Number.isInteger(count) || count < TYPES.length) {
    throw new Error(
      `at least ${String(TYPES.length)} elements are needed, one of each type: ${String(count)}`,
    );
  }
  const random = new Random(seed);
  const metamodel = withSpecIdProperty(options.metamodel ?? readFileSync(defaultStandardModelFile, "utf8"));
  const pools = draftsFor(count, random, metamodel.includes(`key: ${SPEC_ID_KEY},`));
  const drafts = TYPES.flatMap((spec) => pools[spec.pool]);
  addRelations(drafts, pools, options.relations ?? DEFAULT_RELATIONS, random);
  // Relation-valued properties point at variants and packages only, which come before every element
  // that has them, so their versions are set before an element needs them.
  // The inline references of an element point at earlier ones, whose versions are set by then.
  let references = 0;
  let criterionReferences = 0;
  drafts.forEach((draft, index) => {
    references += withReferences(draft, drafts, index, random);
    criterionReferences += withCriterionReference(draft, drafts, index);
    draft.version = options.version({
      type: draft.spec.key,
      text: draft.text,
      properties: versionProperties(draft),
    });
  });
  // Relation kinds may point at later elements (a variant excludes requirements), so the files are
  // written once every version is known.
  const files = new Map<string, string>([
    ["system/reqseq-workspace.yaml", workspaceFile(seed)],
    ["system/metamodel/standard-model.yaml", metamodel],
    ...drafts.map((draft) => [`${draft.repository}/${draft.file}`, elementFile(draft)] as const),
  ]);
  const { files: sorted, digest } = sortedTree(files);
  return {
    seed,
    main: "system",
    repositories: REPOSITORIES,
    elements: drafts.map((d) => ({
      id: d.id,
      type: d.spec.key,
      repository: d.repository,
      file: d.file,
      title: d.title,
      version: d.version,
    })),
    relations: drafts.reduce(
      (sum, d) => sum + [...d.relations.values()].reduce((n, list) => n + list.length, 0),
      0,
    ),
    references,
    criterionReferences,
    files: sorted,
    digest,
  };
}

export interface LargeFixtureWorkspace extends FixtureWorkspace {
  readonly generated: GeneratedWorkspace;
  /** Absolute path of the main repository: pass it to `new Workspace(workspaceRoot)`. */
  readonly workspaceRoot: string;
}

export interface WriteLargeWorkspaceOptions {
  /** Make each repository a Git repository with one commit of all its files. Default false. */
  readonly git?: boolean;
  /** Parent of the temporary folder. Default: the OS temp folder. */
  readonly tempDir?: string;
}

/** Files written at the same time; bounded so 50,000 files do not exhaust file handles. */
const WRITE_CONCURRENCY = 64;

/**
 * Writes a generated workspace into a new temporary folder (see `createFixtureWorkspace`), one
 * sibling folder per repository. Call `cleanup()` when done.
 */
export async function writeLargeWorkspace(
  generated: GeneratedWorkspace,
  options: WriteLargeWorkspaceOptions = {},
): Promise<LargeFixtureWorkspace> {
  const fixture = await createFixtureWorkspace(
    options.tempDir === undefined ? {} : { tempDir: options.tempDir },
  );
  try {
    const repositories = options.git === true ? generated.repositories : [];
    const inRepository = (file: string): GeneratedRepository | undefined =>
      repositories.find((r) => file.startsWith(`${r.folder}/`));
    // Git writes the files of its repositories itself (below); the others are written here.
    const own = [...generated.files].filter(([file]) => inRepository(file) === undefined);
    const folders = new Set(own.map(([file]) => path.posix.dirname(file)));
    for (const folder of folders) {
      await fs.mkdir(fixture.path(folder), { recursive: true });
    }
    const queue = own.values();
    const worker = async (): Promise<void> => {
      for (const [file, content] of queue) {
        await fs.writeFile(fixture.path(file), content);
      }
    };
    await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker));
    // One commit per repository in one `git fast-import` (a single pack), then one checkout that writes the
    // work tree and the index. `git add` wrote one loose object per file instead, so twice as many files,
    // and on a windows-2025 runner every new file costs a virus scan (#423).
    for (const repository of repositories) {
      const prefix = `${repository.folder}/`;
      const files = Object.fromEntries(
        [...generated.files]
          .filter(([file]) => inRepository(file) === repository)
          .map(([file, content]) => [file.slice(prefix.length), content]),
      );
      await fs.mkdir(fixture.path(repository.folder), { recursive: true });
      await initRepository(fixture, repository.folder);
      await fixture.commitHistory([{ name: "generated", files }], {
        repository: repository.folder,
        branch: "main",
      });
      // `checkout.workers=0`: one worker per processor writes the files.
      await fixture.git(["-c", "checkout.workers=0", "reset", "--hard", "--quiet"], repository.folder);
    }
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
  return { ...fixture, generated, workspaceRoot: fixture.path(generated.main) };
}
