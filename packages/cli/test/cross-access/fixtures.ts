// Fixtures and helpers that scenarios of more than one command use, and what they are built from
// (cross-access.test.ts). A fixture or helper that only one command uses lives in that command's module
// under scenarios/, and so does the setup of its template (`templateSetup`).
import { readFileSync } from "node:fs";
import type { FixtureOptions } from "@reqseq/testkit";
import type { Result } from "./scenario.js";

/** What element.create and element.update give, as far as the checks of their SR-064 scenarios read it. */
export interface Written {
  readonly element: { readonly properties: Readonly<Record<string, unknown>> };
  readonly files: readonly string[];
  readonly problems: readonly {
    readonly code: string;
    readonly severity: string;
    readonly message: string;
  }[];
}
/** The key a message of element.missing-required names: "Required property Title (title) of type …". */
export const requiredKey = (message: string): string | undefined =>
  /^Required property .+? \(([a-z-]+)\) of type /.exec(message)?.[1];

export const ONE_REPOSITORY: FixtureOptions = { fixture: "SR-004/one-repository", git: true };
/** SR-004/one-repository with the delivery and the saved mapping of fixtures/SR-053/delivery (SR-053). */
export const DELIVERY: FixtureOptions = {
  ...ONE_REPOSITORY,
  files: {
    "in/lieferung.reqif": readFileSync(
      new URL("../../../../fixtures/SR-053/delivery/lieferung.reqif", import.meta.url),
      "utf8",
    ),
    "reqif/kunde-a.yaml": readFileSync(
      new URL("../../../../fixtures/SR-053/delivery/kunde-a.yaml", import.meta.url),
      "utf8",
    ),
  },
};
/** DELIVERY with a mapping of the requirements and their name only, which leaves entries unmapped (SR-055). */
export const PARTIAL_MAPPING = [
  "reqseq-reqif-mapping: 1",
  "source: { name: Kunde A }",
  "types: [{ source: Customer Requirement, type: system-requirement }]",
  "attributes: [{ source: ReqIF.Name, property: title }]",
  "",
].join("\n");
export const PARTIAL_DELIVERY: FixtureOptions = {
  ...DELIVERY,
  files: { ...DELIVERY.files, "reqif/kunde-a.yaml": PARTIAL_MAPPING },
};
/** The fixture files of fixtures/SR-056 under `name`. */
const sr056 = (name: string): string =>
  readFileSync(new URL(`../../../../fixtures/SR-056/${name}`, import.meta.url), "utf8");
/** The UUID of REQ-n of delivery 1 as fixtures/SR-056/imported holds it. */
export const imported = (n: number): string => `6adc0560-0000-4000-8000-00000000000${String(n)}`;
/**
 * SR-004/one-repository after delivery 1 of fixtures/SR-056 was imported (fixtures/SR-056/imported,
 * REQ-3 changed locally since), with delivery 2 and the mapping: REQ-1 changed, REQ-3 a conflict,
 * REQ-4 dropped, REQ-5 new (SR-056).
 */
export const REPEATED: FixtureOptions = {
  ...ONE_REPOSITORY,
  files: {
    "in/2.reqif": sr056("delivery/lieferung-2.reqif"),
    "reqif/kunde-a.yaml": sr056("delivery/kunde-a.yaml"),
    ...Object.fromEntries(
      [1, 2, 3, 4].map((n) => [
        `Kunde-A/SR-00000000000${String(n)}.md`,
        sr056(`imported/Kunde-A/SR-00000000000${String(n)}.md`),
      ]),
    ),
  },
};
/**
 * DELIVERY after a first import of its two requirements (REQ-1 and REQ-2 of fixtures/SR-056/imported,
 * with fixed UUIDs, so every access compares the same files), so a command takes the same source again
 * (SR-054 AK2).
 */
export const FIRST_IMPORT: FixtureOptions = {
  ...DELIVERY,
  files: {
    ...DELIVERY.files,
    ...Object.fromEntries(
      [1, 2].map((n) => [
        `Kunde-A/SR-00000000000${String(n)}.md`,
        sr056(`imported/Kunde-A/SR-00000000000${String(n)}.md`),
      ]),
    ),
  },
};
export const REPEAT = { file: "in/2.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-12" };
/** The output of the core access. */
export const coreOutput = (results: Readonly<Record<string, Result>>): unknown =>
  (results["core"]?.outcome as { output: unknown }).output;
/** Needs, requirements, a decision and a package that point at each other (SR-024). */
export const AFFECTED: FixtureOptions = { fixture: "SR-024/affected", git: true };
/** Needs, system and component requirements and a variant (SR-022). */
export const CHAIN: FixtureOptions = { fixture: "SR-022/chain", git: true };
/** CHAIN with a system requirement based only on a decision, so without a parent, and a component requirement below it (SR-022 AK5, AK6). */
export const ORPHANED_CHAIN: FixtureOptions = {
  ...CHAIN,
  files: {
    "decisions/D-00000000e001.md":
      "---\nid: 5c0e1d2a-0022-4022-8022-00000000e001\ntype: decision\nstatus: draft\ntitle: Knots\n---\n",
    "requirements/SR-00000000b004.md":
      "---\nid: 5c0e1d2a-0022-4022-8022-00000000b004\ntype: system-requirement\nstatus: draft\ntitle: Show knots\n" +
      "based-on:\n  - { id: 5c0e1d2a-0022-4022-8022-00000000e001, version: n1:0000000000000000 }\n---\n",
    "components/CR-00000000c003.md":
      "---\nid: 5c0e1d2a-0022-4022-8022-00000000c003\ntype: component-requirement\nstatus: draft\ntitle: Convert to knots\n" +
      "derives-from:\n  - { id: 5c0e1d2a-0022-4022-8022-00000000b004, version: n1:0000000000000000 }\n---\n",
  },
};
/** Needs, requirements, variants and packages to filter (SR-069). */
export const FILTER: FixtureOptions = { fixture: "SR-069/filter", git: true };
/** SR-069/filter with saved filters, one written by hand with short IDs and comments, one faulty (SR-070). */
export const SAVED: FixtureOptions = {
  fixture: "SR-069/filter",
  files: {
    "filters/sensor-drafts.yaml":
      "# Drafts of the sensor package\nreqseq-filter: 1\nname: Sensor drafts\nwhere:\n  all:\n" +
      "    - { package: PKG-0000d1 }   # Sensors\n    - { status: [draft] }\nsort: [{ by: title, order: desc }]\n",
    "filters/mountain.yaml":
      "reqseq-filter: 1\nname: Mountain\nview: VAR-0000c2\nwhere: { type: [system-requirement] }\n",
    "filters/broken.yaml": "reqseq-filter: 1\nname: Broken\nwhere: { nope: 1 }\n",
  },
  git: true,
};
/** A metamodel in which the type Variant has a validity; B's validity names A by hand, C relates to A (SR-039). */
export const NESTED: FixtureOptions = { fixture: "SR-039/nested", git: true };
export const NESTED_A = "39039039-0000-4000-8000-0000000000a1";
/** Open hints of every kind of stage 2, among them outdated relations (SR-026). */
export const HINTS: FixtureOptions = { fixture: "SR-026/hints", git: true };

/**
 * HINTS with the standard model as shipped, which marks the acceptance criteria and the rationale as
 * Markdown, and links in acceptance criteria (SR-127, #444): SR-0000b1 holds one to a changed need
 * next to its relations, SR-0000b8 is only a criterion that references a need.
 */
export const IN_CRITERIA: FixtureOptions = {
  ...HINTS,
  files: {
    "metamodel/standard-model.yaml": readFileSync(
      new URL("../../../../schemas/examples/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    ),
    "requirements/SR-0000000000b1.md": readFileSync(
      new URL("../../../../fixtures/SR-026/hints/requirements/SR-0000000000b1.md", import.meta.url),
      "utf8",
    ).replace(
      "then the station shows it.",
      "then [the need](reqseq:26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000) shows it.",
    ),
    "requirements/SR-0000000000b8.md":
      "---\nid: 26a0b000-0000-4000-8000-0000000000b8\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nrequirement-type: functional\n" +
      "acceptance-criteria:\n  - Given a gust, then [the other need](reqseq:26a0b000-0000-4000-8000-0000000000a2?version=n1:1111111111111111) is shown.\n---\n\nGusts.\n",
  },
};

/** Spec IDs in a property with the meaning identifier (#305). */
export const IDENTIFIERS: FixtureOptions = { fixture: "enabler-305/identifiers", git: true };
export const MISSING_TARGETS: FixtureOptions = {
  fixture: "SR-089/missing-targets",
  git: ["system", "sensor"],
};
/** A workspace file that lists a second repository, `vault`, which is not on this machine (SR-006). */
export const WITH_VAULT =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  "metamodel: { repository: system, path: metamodel }\n";

/**
 * The requirement of SR-004/one-repository with an evidence location: one Markdown record and one
 * enriched JUnit file of SR-e88fb3 (#535). The stage 4 commands use it for their scenarios; the
 * records are read once SR-028 and SR-093 add their readers.
 */
export const EVIDENCE: FixtureOptions = { fixture: "enabler-535/evidence", git: true };
/** Requirements valid for the variants Pro and Basic, with records of the core and of Pro (SR-031, SR-047). */
export const STATUS: FixtureOptions = { fixture: "SR-031/status", git: true };

/** Requirements marked emergent, with and without own records, and their children (SR-035). */
export const EMERGENT: FixtureOptions = { fixture: "SR-035/emergent", git: true };
/** The example of SR-043: variant A (VAR-0000c1) replaces K1 by A1, excludes K2 and adds A2. */
export const VARIANT_VIEWS: FixtureOptions = { fixture: "SR-043/example", git: true };

/** A baseline R1 of Coast (VAR-0000c1) on fixtures/SR-103/since-baseline, then K1 (SR-0000a1) changed (SR-103). */
export const SINCE_BASELINE: FixtureOptions = {
  fixture: "SR-103/since-baseline",
  git: true,
  files: {
    "baselines/R1.yaml":
      "reqseq-baseline: 1\nname: R1\ndate: 2026-11-02T10:00:00Z\nselection:\n" +
      "  view: { id: 10310310-0000-4000-8000-0000000000c1, title: Coast }\nrepositories:\n" +
      `  - { name: system, commit: ${"a".repeat(40)} }\nelements:\n` +
      ["a1:c44c2a59a7eba159", "a2:b817003944c5d6fb", "b1:4a65c37394420816", "c1:878bca1d9503aac6"]
        .map(
          (e) => `  - { id: 10310310-0000-4000-8000-0000000000${e.slice(0, 2)}, version: n1${e.slice(2)} }\n`,
        )
        .join(""),
    "requirements/SR-0000000000a1.md":
      "---\nid: 10310310-0000-4000-8000-0000000000a1\ntype: system-requirement\nstatus: draft\ntitle: Wind speed every minute\n" +
      "requirement-type: functional\nacceptance-criteria:\n  - Given the station runs, when a minute passes, then it reports the wind speed.\n" +
      "---\n\nThe station reports the wind speed every 30 seconds.\n",
  },
};

/** A verification record of the example's `tail` with `result`, for `variant` when given (SR-047). */
const exampleRecord = (tail: string, result: string, variant?: string): string =>
  `---\nreqseq-record: 1\nkind: verification\nelement: 43043043-0000-4000-8000-0000000000${tail}\n` +
  `version: n1:67ebd0624004c969\nmethod: test\n${variant === undefined ? "" : `variant: 43043043-0000-4000-8000-0000000000${variant}\n`}` +
  `item: build-47\nresult: ${result}\ndate: 2026-11-01T10:00:00Z\n---\n`;

/** The example of SR-043 with an evidence location: K2, excluded in A, passed in the core and failed in B; K1 with a record for A, which replaces it (SR-047). */
export const VARIANT_EVIDENCE: FixtureOptions = {
  fixture: "SR-043/example",
  files: {
    "reqseq-workspace.yaml":
      "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
      "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n",
    "evidence/k2-core.md": exampleRecord("a2", "passed"),
    "evidence/k2-b.md": exampleRecord("a2", "failed", "c2"),
    "evidence/k1-a.md": exampleRecord("a1", "passed", "c1"),
  },
  git: true,
};

/** Requirements with every verification status, an indirect one, obsolete ones and three packages (SR-037). */
export const DEGREE: FixtureOptions = { fixture: "SR-037/degree", git: true };

/** Requirements with test cases from JUnit, an inspection record, an indirect and an obsolete one (SR-126). */
export const MATRIX_EVIDENCE: FixtureOptions = { fixture: "SR-126/matrix", git: true };

/** Two repositories with Markdown and JUnit records, variants, a package, a saved filter and baselines (SR-061). */
export const EXPORT: FixtureOptions = { fixture: "SR-061/export", git: ["system", "sensor"] };

/** The files of the `relation.target-superseded` hints in one access's output (SR-072 AK2). */
export const supersededHintFiles = (result: Result): (string | undefined)[] =>
  ((result.outcome as { output?: { problems?: { code: string; file?: string }[] } }).output?.problems ?? [])
    .filter((p) => p.code === "relation.target-superseded")
    .map((p) => p.file);
