// Cross-access test (ADR-0002 rule 8, ADR-0011, SR-080): every catalog command runs through core `invoke`,
// the CLI, the local API, the MCP server and the app on the same fixture workspace, and all five give the
// same result: the same output or the same error object, and the same files on disk afterwards. The app is
// its preload bridge and the core side of its IPC over a MessageChannel, the path every call of the
// renderer takes (ADR-0010); the Electron tests (packages/app/test) run it in the app itself. New catalog
// commands join automatically with a default scenario (input `{}`); add explicit scenarios below when a
// command is implemented.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { MessagePort } from "node:worker_threads";
import { promisify } from "node:util";
import { MessageChannel } from "node:worker_threads";
import { startApiServer } from "@reqseq/api";
import type { Channel, IpcRendererLike } from "@reqseq/app";
import { SAVE_CHANNEL, WORKSPACE_CHANNEL, createBridge, createCoreHost } from "@reqseq/app";
import type {
  BaselineGetOutput,
  CatalogEntry,
  CommandName,
  MetamodelGetOutput as MetamodelOutput,
  VariantDiffOutput,
} from "@reqseq/core";
import {
  CommandError,
  Workspace,
  createCommandRuntime,
  jsonChunks,
  jsonLines,
  rememberWorkspace,
} from "@reqseq/core";
import { LineTransport, serveMcp, toolName } from "@reqseq/mcp";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { EXIT, argvFor, runCli } from "../src/index.js";
import { YAML_OPTIONS, yamlPieces } from "../src/render.js";

/** The SHA-256 of SR-e88fb3 in SR-004/one-repository, as element.get gives it (`fileSha256`, SR-106). */
const WIND_SHA256 = createHash("sha256")
  .update(
    readFileSync(
      new URL("../../../fixtures/SR-004/one-repository/requirements/SR-6328cee88fb3.md", import.meta.url),
    ),
  )
  .digest("hex");

/** The product catalog and implementations; outputs are checked against the catalog (vitest.config.ts). */
const runtime = createCommandRuntime();

interface Scenario {
  readonly name: string;
  /** The fixture workspace; default: SR-004/one-repository as one Git repository. */
  readonly fixture?: FixtureOptions;
  /** Folder of the workspace inside the fixture; default its root. */
  readonly root?: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** The tag the test name starts with; default `[SR-080/AK2]`. */
  readonly tag?: string;
  /** What core gives; guards against a scenario that only ever compares the same error. */
  readonly expect: "output" | "error";
  /**
   * The output names a new element with a random UUID: its UUID, the 12 and 6 digit tails (file name,
   * short ID) and its version are replaced by placeholders in the outcome and the files before comparing.
   * For the new elements of an import (`created`), each UUID and its tails get a numbered placeholder,
   * and every version is replaced, as the planned versions hold the random UUIDs.
   */
  readonly newElement?: boolean;
  /**
   * Prepares state before each access, with the same result every time (the list of recent
   * workspaces in the OS cache folder, SR-131; a commit after a baseline, SR-051). A read command's
   * shared copy is prepared once more before its files are taken, so the preparation must be idempotent.
   */
  readonly prepare?: (copy: Copy) => Promise<void>;
  /** Parts of the outcome and the files that differ by call (an export time, a new UUID), each replaced by `<masked>`. */
  readonly masks?: readonly RegExp[];
  /** More checks on the results of all accesses, after they compared equal. */
  readonly check?: (results: Readonly<Record<string, Result>>) => void;
}

/** SR-094: the core output of a baseline.get scenario, its entries by the last two characters of their UUID. */
const baselineEntries = (
  results: Readonly<Record<string, Result>>,
): Readonly<Record<string, BaselineGetOutput["elements"][number]>> =>
  Object.fromEntries(
    (results["core"]?.outcome as { output: BaselineGetOutput }).output.elements.map((e) => [
      e.id.slice(-2),
      e,
    ]),
  );
/** SR-094: the rows of an entry as `view status`, the view by the last two characters of a variant's UUID. */
const baselineRows = (entry: BaselineGetOutput["elements"][number] | undefined): string[] | undefined =>
  entry?.verification?.map((r) => `${r.view === "core" ? "core" : r.view.slice(-2)} ${r.status}`);
const SR094: FixtureOptions = { fixture: "SR-094/baseline", git: true };

/** What element.create and element.update give, as far as the checks of their SR-064 scenarios read it. */
interface Written {
  readonly element: { readonly properties: Readonly<Record<string, unknown>> };
  readonly files: readonly string[];
  readonly problems: readonly {
    readonly code: string;
    readonly severity: string;
    readonly message: string;
  }[];
}
/** A level of evidence.coverage, as far as the SR-112 scenario reads it. */
interface CoverageLevel {
  readonly type: string;
  readonly total: number;
  readonly withEvidence?: number;
}
/** The key a message of element.missing-required names: "Required property Title (title) of type …". */
const requiredKey = (message: string): string | undefined =>
  /^Required property .+? \(([a-z-]+)\) of type /.exec(message)?.[1];

const ONE_REPOSITORY: FixtureOptions = { fixture: "SR-004/one-repository", git: true };
/** The metamodel of SR-004/one-repository as the fixture holds it (SR-054 AK3). */
const STANDARD_MODEL = readFileSync(
  new URL("../../../fixtures/SR-004/one-repository/metamodel/standard-model.yaml", import.meta.url),
  "utf8",
);
/** The saved mapping of DELIVERY without its entry for the source type Heading (SR-054 AK3). */
const WITHOUT_HEADING = [
  "reqseq-reqif-mapping: 1",
  "source: { name: Kunde A }",
  "types: [{ source: Customer Requirement, type: system-requirement }]",
  "attributes:",
  "  - { source: ReqIF.Name, property: title }",
  "  - { source: ReqIF.Text, property: text }",
  "  - { source: Priority, property: requirement-type, values: { High: functional, Low: quality } }",
  "  - { source: Internal Comment, omit: true }",
  "relations: [{ source: satisfies, kind: derives-from }]",
  "",
].join("\n");
/** SR-004/one-repository with the delivery and the saved mapping of fixtures/SR-053/delivery (SR-053). */
const DELIVERY: FixtureOptions = {
  ...ONE_REPOSITORY,
  files: {
    "in/lieferung.reqif": readFileSync(
      new URL("../../../fixtures/SR-053/delivery/lieferung.reqif", import.meta.url),
      "utf8",
    ),
    "reqif/kunde-a.yaml": readFileSync(
      new URL("../../../fixtures/SR-053/delivery/kunde-a.yaml", import.meta.url),
      "utf8",
    ),
  },
};
/** A package with requirements, a need and a decision, relations among them and to a missing element (SR-052). */
const REQIF_EXPORT: FixtureOptions = { fixture: "SR-052/package", git: true };
/** The package and a requirement of REQIF_EXPORT (SR-059). */
const PACKAGE_S6 = "52052052-0000-4000-8000-0000000052f1";
const WIND_S6 = "52052052-0000-4000-8000-0000000052a1";
/** REQIF_EXPORT with the mapping of a supplier it delivers to (SR-059 AK3). */
const SUPPLIER_MAPPING = "reqseq-reqif-mapping: 1\nsource: { name: Zulieferer }\n";
const SUPPLIER: FixtureOptions = { ...REQIF_EXPORT, files: { "reqif/zulieferer.yaml": SUPPLIER_MAPPING } };
/** A workspace with the standard model only, and an export of SR-052/package in folder in (SR-052). */
const ROUND_TRIP: FixtureOptions = { fixture: "SR-052/empty", git: true };
/** Elements imported from Kunde A with and without a statement, and its mappings (SR-058). */
const STATEMENTS: FixtureOptions = { fixture: "SR-058/statements", git: true };
/** The export time and the header IDENTIFIER of a ReqIF file ReqSeq writes. */
const EXPORT_MASKS: readonly RegExp[] = [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, /_hd-[0-9a-f-]{36}/g];
/** DELIVERY with a mapping of the requirements and their name only, which leaves entries unmapped (SR-055). */
const PARTIAL_MAPPING = [
  "reqseq-reqif-mapping: 1",
  "source: { name: Kunde A }",
  "types: [{ source: Customer Requirement, type: system-requirement }]",
  "attributes: [{ source: ReqIF.Name, property: title }]",
  "",
].join("\n");
const PARTIAL_DELIVERY: FixtureOptions = {
  ...DELIVERY,
  files: { ...DELIVERY.files, "reqif/kunde-a.yaml": PARTIAL_MAPPING },
};
/** The fixture files of fixtures/SR-056 under `name`. */
const sr056 = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/SR-056/${name}`, import.meta.url), "utf8");
/** The UUID of REQ-n of delivery 1 as fixtures/SR-056/imported holds it. */
const imported = (n: number): string => `6adc0560-0000-4000-8000-00000000000${String(n)}`;
/**
 * SR-004/one-repository after delivery 1 of fixtures/SR-056 was imported (fixtures/SR-056/imported,
 * REQ-3 changed locally since), with delivery 2 and the mapping: REQ-1 changed, REQ-3 a conflict,
 * REQ-4 dropped, REQ-5 new (SR-056).
 */
const REPEATED: FixtureOptions = {
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
const FIRST_IMPORT: FixtureOptions = {
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
const REPEAT = { file: "in/2.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-12" };
/** Every access left the files of delivery 1 as they were. */
const unchangedRepeat = (results: Readonly<Record<string, Result>>): void => {
  for (const result of Object.values(results)) {
    for (const n of [1, 2, 3, 4]) {
      const file = `Kunde-A/SR-00000000000${String(n)}.md`;
      expect(result.files[file]).toBe(REPEATED.files?.[file]);
    }
    expect(Object.keys(result.files).filter((f) => f.startsWith("Kunde-A/"))).toHaveLength(4);
  }
};
/** The output of the core access. */
const coreOutput = (results: Readonly<Record<string, Result>>): unknown =>
  (results["core"]?.outcome as { output: unknown }).output;

/** A refused import leaves every file as it was and writes no element file (SR-055 AK3). */
const unchangedDelivery =
  (mapping: string) =>
  (results: Readonly<Record<string, Result>>): void => {
    for (const result of Object.values(results)) {
      expect(Object.keys(result.files).filter((file) => file.startsWith("Kunde-A/"))).toEqual([]);
      expect(result.files["reqif/kunde-a.yaml"]).toBe(mapping);
      expect(result.files["in/lieferung.reqif"]).toBe(DELIVERY.files?.["in/lieferung.reqif"]);
    }
  };
/** Needs, requirements, a decision and a package that point at each other (SR-024). */
const AFFECTED: FixtureOptions = { fixture: "SR-024/affected", git: true };
/** Needs, system and component requirements and a variant (SR-022). */
const CHAIN: FixtureOptions = { fixture: "SR-022/chain", git: true };
/** Inheritance, per-type statuses, relation kinds open on a side or both (SR-130). */
const METAMODEL: FixtureOptions = { fixture: "SR-130/metamodel", git: true };
/** Needs, requirements, variants and packages to filter (SR-069). */
const FILTER: FixtureOptions = { fixture: "SR-069/filter", git: true };
/** SR-069/filter with saved filters, one written by hand with short IDs and comments, one faulty (SR-070). */
const SAVED: FixtureOptions = {
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
/**
 * SR-069/filter with a topic shared by a single value and a list, so that a value of a list property selects
 * its element (SR-132 AK2).
 */
const VALUES: FixtureOptions = {
  fixture: "SR-069/filter",
  git: true,
  files: {
    "requirements/SR-0000000000b6.md": `---\nid: 69069069-0000-4000-8000-0000000000b6\ntype: system-requirement\nstatus: draft\ntitle: Measure the rain\nrequirement-type: functional\nacceptance-criteria: [Given rain, then it holds.]\ntopic: Timing\n---\n`,
    "requirements/SR-0000000000b7.md": `---\nid: 69069069-0000-4000-8000-0000000000b7\ntype: system-requirement\nstatus: approved\ntitle: Measure the hail\nrequirement-type: functional\nacceptance-criteria: [Given hail, then it holds.]\ntopic: [Wind, Timing]\n---\n`,
  },
};
/** The list of the app (#418): by type, then by ID. */
const TYPE_AND_ID = [
  { by: "type", order: "asc" },
  { by: "identifier", order: "asc" },
];
/** Derivations with a diamond, choices, numbers and titles to sort by (SR-075). */
const SORT: FixtureOptions = { fixture: "SR-075/sort", git: true };
/** A metamodel in which the type Variant has a validity; B's validity names A by hand, C relates to A (SR-039). */
const NESTED: FixtureOptions = { fixture: "SR-039/nested", git: true };
const NESTED_A = "39039039-0000-4000-8000-0000000000a1";
/** Packages P1 and P2; R1 in both, R2 in P1, R3 in none (SR-048, SR-049). */
const PACKAGES: FixtureOptions = { fixture: "SR-048/packages", git: true };
/** Identifiers in natural order, a lower-case one and elements without one (#418). */
const NATURAL: FixtureOptions = { fixture: "enabler-418/natural", git: true };
/** Needs, requirements and their derivations (SR-023), shared so the fixture is built once. */
const RELATED: FixtureOptions = { fixture: "SR-023/related", git: true };
/** Open hints of every kind of stage 2, among them outdated relations (SR-026). */
const HINTS: FixtureOptions = { fixture: "SR-026/hints", git: true };
/** Where SR-0000b1 of HINTS stores its outdated relation and reference, as hint IDs name it (SR-025). */
const HINT_AT_B1 = `relation.outdated/system/${encodeURIComponent("requirements/SR-0000000000b1.md")}/26a0b000-0000-4000-8000-0000000000b1`;

/**
 * HINTS with the standard model as shipped, which marks the acceptance criteria and the rationale as
 * Markdown, and links in acceptance criteria (SR-127, #444): SR-0000b1 holds one to a changed need
 * next to its relations, SR-0000b8 is only a criterion that references a need.
 */
const IN_CRITERIA: FixtureOptions = {
  ...HINTS,
  files: {
    "metamodel/standard-model.yaml": readFileSync(
      new URL("../../../schemas/examples/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    ),
    "requirements/SR-0000000000b1.md": readFileSync(
      new URL("../../../fixtures/SR-026/hints/requirements/SR-0000000000b1.md", import.meta.url),
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
/** Where SR-0000b1 stores the link in its first acceptance criterion, as hint IDs name it (SR-127). */
const CRITERION_HINT = `${HINT_AT_B1}/@text:acceptance-criteria/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000&n=1`;

/** One finding of each kind (SR-019), then a second commit that changes one requirement (SR-092). */
const SECOND_COMMIT: FixtureOptions = { fixture: "SR-019/findings", git: true };

/** What is done to a template once it is built: more commits. */
const TEMPLATE_SETUP = new Map<FixtureOptions, (ws: FixtureWorkspace) => Promise<void>>([
  [
    SECOND_COMMIT,
    async (ws) => {
      const file = ws.path("requirements/SR-b00000000004.md");
      await fs.appendFile(file, "Changed in a second commit.\n");
      await ws.commit();
    },
  ],
]);

/** Every kind of link around a few elements: derivations, a package, an exclusion, inline references (SR-107). */
const NEIGHBOURHOOD: FixtureOptions = { fixture: "SR-107/neighbourhood", git: true };
/** An element with parents, children, a superseded and an outdated link and a variant (SR-111). */
const GRAPH: FixtureOptions = { fixture: "SR-111/graph", git: true };
/** The UUID prefix of GRAPH. */
const GR = "5e111a7d-2b4f-4c61-9d08-";
const NB = "5e107a7d-2b4f-4c61-9d08-";
/** Needs, a decision, packages and system requirements with current, outdated and missing relations (SR-125). */
const MATRIX: FixtureOptions = { fixture: "SR-125/matrix", git: true };
const MX = "5e125a7d-2b4f-4c61-9d08-";

/** Relations across repositories, one of them missing; no relation kind has the meaning derivation. */
/** Spec IDs in a property with the meaning identifier (#305). */
const IDENTIFIERS: FixtureOptions = { fixture: "enabler-305/identifiers", git: true };
/** Statuses per type (#306): glossary terms have no status, requirements require one. */
const STATUSES_PER_TYPE: FixtureOptions = { fixture: "enabler-306/statuses-per-type", git: true };
const MISSING_TARGETS: FixtureOptions = { fixture: "SR-089/missing-targets", git: ["system", "sensor"] };
/** A workspace file that lists a second repository, `vault`, which is not on this machine (SR-006). */
const WITH_VAULT =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  "metamodel: { repository: system, path: metamodel }\n";

/**
 * The requirement of SR-004/one-repository with an evidence location: one Markdown record and one
 * enriched JUnit file of SR-e88fb3 (#535). The stage 4 commands use it for their scenarios; the
 * records are read once SR-028 and SR-093 add their readers.
 */
const EVIDENCE: FixtureOptions = { fixture: "enabler-535/evidence", git: true };

/**
 * The #535 workspace with a JUnit file outside the evidence folder that is not enriched yet (SR-029,
 * plan review S3), so evidence.enrichJunit writes on every access.
 */
const RAW_JUNIT: FixtureOptions = {
  ...EVIDENCE,
  files: {
    "results/raw.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station" timestamp="2026-10-27T09:00:00">\n' +
      '    <testcase classname="station" name="[SR-e88fb3] shows the wind speed"/>\n' +
      '    <testcase classname="station" name="[SR-ffffff] names no element"/>\n' +
      "  </testsuite>\n</testsuites>\n",
  },
};

/** Parents verified indirectly through Markdown records of their children, missing children (SR-034). */
const INDIRECT: FixtureOptions = { fixture: "SR-034/indirect", git: true };
/** Requirements valid for the variants Pro and Basic, with records of the core and of Pro (SR-031, SR-047). */
const STATUS: FixtureOptions = { fixture: "SR-031/status", git: true };

/** Needs, requirements and a use case with validation and verification records (SR-038). */
const VALIDATION: FixtureOptions = { fixture: "SR-038/validation", git: true };

/** Requirements marked emergent, with and without own records, and their children (SR-035). */
const EMERGENT: FixtureOptions = { fixture: "SR-035/emergent", git: true };
/** The example of SR-043: variant A (VAR-0000c1) replaces K1 by A1, excludes K2 and adds A2. */
const VARIANT_VIEWS: FixtureOptions = { fixture: "SR-043/example", git: true };
/** SR-A (SR-0000b1, validity [VAR-0000c1]) replaces the core requirement SR-K (SR-0000a1), whose content changed (SR-045). */
const CORE_CHANGED: FixtureOptions = {
  fixture: "SR-045/core-changed",
  git: true,
  files: {
    "requirements/SR-0000000000a1.md": `---\nid: 45045045-0000-4000-8000-0000000000a1\ntype: system-requirement\nstatus: draft\ntitle: Response time at most 10 ms\nrequirement-type: functional\nacceptance-criteria:\n  - Given a request, when it is sent, then the answer comes within 12 ms.\n---\n\nThe station answers within 12 ms.\n`,
  },
};

/** A baseline R1 of Coast (VAR-0000c1) on fixtures/SR-103/since-baseline, then K1 (SR-0000a1) changed (SR-103). */
const SINCE_BASELINE: FixtureOptions = {
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
const VARIANT_EVIDENCE: FixtureOptions = {
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

/** SR-004/one-repository with an image to attach, whose name ReqSeq makes portable (SR-097). */
const WITH_IMAGE: FixtureOptions = {
  fixture: "SR-004/one-repository",
  files: { "incoming/Wind Läyout (v2).png": "an image", "incoming/notes.txt": "no image" },
  git: true,
};

/** Needs, requirements and a subtype in two repositories, an obsolete child, a saved filter (SR-036). */
const COVERAGE: FixtureOptions = { fixture: "SR-036/levels", git: ["system", "sensor"] };

/** Requirements with every verification status, an indirect one, obsolete ones and three packages (SR-037). */
const DEGREE: FixtureOptions = { fixture: "SR-037/degree", git: true };

/** Requirements with test cases from JUnit, an inspection record, an indirect and an obsolete one (SR-126). */
const MATRIX_EVIDENCE: FixtureOptions = { fixture: "SR-126/matrix", git: true };

/** Two repositories with Markdown and JUnit records, variants, a package, a saved filter and baselines (SR-061). */
const EXPORT: FixtureOptions = { fixture: "SR-061/export", git: ["system", "sensor"] };

const execFileAsync = promisify(execFile);

/**
 * In `system` of an EXPORT copy: the baseline „Release 2“ of SR-0000b1 at HEAD, then a commit that
 * changes SR-0000b1, with fixed author and dates, so every copy gets the same commits; once (SR-051 AK4).
 */
const changedSinceBaseline = async ({ root }: Copy): Promise<void> => {
  const date = "2026-11-03T10:00:00Z";
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
  };
  const git = (args: readonly string[]): Promise<{ stdout: string }> =>
    execFileAsync("git", args, {
      cwd: root,
      env: { ...env, GIT_COMMITTER_EMAIL: "t@example.com", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  const file = path.join(root, "baselines", "Release-2.yaml");
  if (
    await fs.stat(file).then(
      () => true,
      () => false,
    )
  ) {
    return;
  }
  const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
  await fs.writeFile(
    file,
    "reqseq-baseline: 1\nname: Release 2\ndate: 2026-11-02T13:00:00Z\nrepositories:\n" +
      `  - { name: system, commit: ${head} }\nelements:\n` +
      "  - { id: 61061061-0000-4000-8000-0000000000b1, version: n1:697a2ad17ed49170 }\n",
  );
  const b1 = path.join(root, "requirements", "SR-0000000000b1.md");
  await fs.writeFile(
    b1,
    (await fs.readFile(b1, "utf8")).replace("shows the speed.", "shows the speed in knots."),
  );
  await git(["commit", "-qam", "change"]);
};

/** Explicit scenarios per command, in addition to the default one with input `{}`. */
const SCENARIOS: Partial<Record<CommandName, readonly Scenario[]>> = {
  // The date of the baseline is checked to lie within each call and then masked (`withoutDate`).
  "baseline.compare": [
    {
      name: "the two commits and the Git command for a changed element (SR-051 AK4)",
      fixture: EXPORT,
      root: "system",
      input: { baseline: "Release 2", ref: "SR-0000b1" },
      tag: "[SR-051/AK4]",
      expect: "output",
      prepare: changedSinceBaseline,
    },
    {
      name: "a baseline whose commit is not here",
      fixture: EXPORT,
      root: "system",
      input: { baseline: "release-1", ref: "SR-0000b1" },
      expect: "error",
    },
  ],
  "baseline.get": [
    {
      name: "a baseline with the version and its date of each element (SR-051 AK1)",
      fixture: EXPORT,
      root: "system",
      input: { baseline: "release-1" },
      tag: "[SR-051/AK1]",
      expect: "output",
    },
    {
      name: "the evidence status of each requirement at its baseline version (SR-094 AK1)",
      fixture: SR094,
      input: { baseline: "Release 1", withEvidence: true },
      tag: "[SR-094/AK1]",
      expect: "output",
      check: (results) => {
        const e = baselineEntries(results);
        expect(Object.keys(e)).toEqual(["a1", "a2", "b1", "b2", "b3", "b5", "b6", "b7"]);
        expect(baselineRows(e["b1"])).toEqual(["core verified", "c1 verified", "c2 open"]);
      },
    },
    {
      name: "records dated after the baseline do not count and are named (SR-094 AK2)",
      fixture: SR094,
      input: { baseline: "Release 1", withEvidence: true, offset: 2, limit: 2 },
      tag: "[SR-094/AK2]",
      expect: "output",
      check: (results) => {
        const e = baselineEntries(results);
        expect(e["b1"]?.verification?.map((r) => [r.status, r.later?.map((l) => l.date)])).toEqual([
          ["verified", ["2026-11-02T15:00:00Z"]],
          ["verified", ["2026-11-02T16:00:00Z"]],
          ["open", undefined],
        ]);
        expect(e["b2"]?.verification?.[0]?.later?.map((l) => l.date)).toEqual(["2026-11-03T09:00:00Z"]);
      },
    },
    {
      name: "outdated with records of older versions only, else open (SR-094 AK3)",
      fixture: SR094,
      input: { baseline: "Release 1", withEvidence: true, offset: 3, limit: 2 },
      tag: "[SR-094/AK3]",
      expect: "output",
      check: (results) => {
        const e = baselineEntries(results);
        expect(baselineRows(e["b2"])?.[0]).toBe("core outdated");
        expect(baselineRows(e["b3"])?.[0]).toBe("core open");
      },
    },
    {
      name: "without a variant in the selection a row for the core and every variant it applies in (SR-094 AK4)",
      fixture: SR094,
      input: { baseline: "Release 1", withEvidence: true, offset: 3 },
      tag: "[SR-094/AK4]",
      expect: "output",
      check: (results) => {
        const e = baselineEntries(results);
        expect(baselineRows(e["b2"])).toEqual(["core outdated", "c1 open"]);
        expect(baselineRows(e["b3"])).toEqual(["core open", "c1 open"]);
        expect(baselineRows(e["b7"])).toEqual(["c2 verified"]);
      },
    },
    {
      name: "with a variant in the selection only that variant's row (SR-094 AK5)",
      fixture: SR094,
      input: { baseline: "Alpine 1", withEvidence: true },
      tag: "[SR-094/AK5]",
      expect: "output",
      check: (results) => {
        const e = baselineEntries(results);
        expect([baselineRows(e["b1"]), baselineRows(e["b4"])]).toEqual([["c1 verified"], ["c1 verified"]]);
      },
    },
    {
      name: "no indirect verification in a baseline (SR-094 AK6)",
      fixture: SR094,
      input: { baseline: "Release 1", withEvidence: true, offset: 5, limit: 2 },
      tag: "[SR-094/AK6]",
      expect: "output",
      check: (results) => {
        const e = baselineEntries(results);
        expect([baselineRows(e["b5"])?.[0], baselineRows(e["b6"])?.[0]]).toEqual([
          "core open",
          "core verified",
        ]);
      },
    },
    {
      name: "the validation status at the baseline version, without view (SR-094 AK7)",
      fixture: SR094,
      input: { baseline: "Release 1", withEvidence: true, limit: 3 },
      tag: "[SR-094/AK7]",
      expect: "output",
      check: (results) => {
        const e = baselineEntries(results);
        expect([e["a1"]?.validation, e["a1"]?.validationLater?.map((l) => l.date)]).toEqual([
          "validated",
          ["2026-11-02T15:00:00Z"],
        ]);
        expect([e["a2"]?.validation, e["b1"]?.validation]).toEqual(["open", undefined]);
      },
    },
  ],
  "baseline.list": [
    {
      name: "the valid baselines and the problems of a faulty file",
      fixture: EXPORT,
      root: "system",
      input: {},
      expect: "output",
    },
  ],
  "baseline.create": [
    {
      name: "a baseline file of a package with the commit and the elements (SR-050 AK1)",
      fixture: EXPORT,
      root: "system",
      input: { name: "Release 2", selection: { package: "PKG-0000d1" } },
      tag: "[SR-050/AK1]",
      expect: "output",
    },
    {
      name: "a name a baseline has, nothing written (SR-050 AK6)",
      fixture: EXPORT,
      root: "system",
      input: { name: "release 1", selection: { package: "PKG-0000d1" } },
      tag: "[SR-050/AK6]",
      expect: "error",
    },
  ],
  "data.export": [
    {
      name: "the whole workspace with record files",
      fixture: EXPORT,
      root: "system",
      input: {},
      tag: "[SR-061/AK1]",
      expect: "output",
    },
    {
      name: "a baseline by its file name and a variant view",
      fixture: EXPORT,
      root: "system",
      input: { selection: { baseline: "release-1", view: "VAR-0000c1" } },
      tag: "[SR-061/AK2]",
      expect: "output",
    },
    {
      name: "a baseline in a faulty file",
      fixture: EXPORT,
      root: "system",
      input: { selection: { baseline: "broken" } },
      expect: "error",
    },
  ],
  // The runner copies the template with `fs.cp`, so every tracked file is stat-dirty: the content check
  // (SR-062 K2, review S2) keeps the state clean, and the file is `<commit>.jsonl`, not `-dirty`.
  "data.store": [
    {
      name: "the whole workspace into out",
      fixture: EXPORT,
      root: "system",
      input: { folder: "out" },
      tag: "[SR-062/AK1]",
      expect: "output",
      check: (results) => {
        const written = (results["core"]?.outcome as { output?: { files?: string[] } }).output?.files ?? [];
        expect(written).toEqual([expect.stringMatching(/^out\/[0-9a-f]{40}\.jsonl$/)]);
      },
    },
  ],
  // `sourcePath` is a localPath, like `path` of workspace.init below: the same file through every access.
  "element.addAttachment": [
    {
      name: "an image into the folder next to the element file, with its Markdown (SR-097 AK1, AK2)",
      fixture: WITH_IMAGE,
      input: { ref: "SR-e88fb3", sourcePath: "incoming/Wind Läyout (v2).png" },
      expect: "output",
    },
    {
      name: "a file that is no image",
      fixture: WITH_IMAGE,
      input: { ref: "SR-e88fb3", sourcePath: "incoming/notes.txt" },
      expect: "error",
    },
    {
      name: "an image that is not there",
      fixture: WITH_IMAGE,
      input: { ref: "SR-e88fb3", sourcePath: "incoming/gone.png" },
      expect: "error",
    },
  ],
  "element.bulkUpdate": [
    {
      name: "a package reference that names no element is refused, nothing is written (#287)",
      fixture: FILTER,
      input: { selection: {}, property: "packages", operation: "add", value: "PKG-999999", confirm: true },
      expect: "error",
    },
    {
      name: "an origin property is refused: only reqif.import writes it",
      fixture: FILTER,
      input: { selection: {}, property: "delivery", operation: "set", value: "1", confirm: true },
      tag: "[SR-057/AK3]",
      expect: "error",
    },
    {
      name: "a variant is not given validity entries: the preview names it, the confirmation is refused",
      fixture: NESTED,
      input: {
        selection: { ids: ["VAR-0000c3"] },
        property: "validity",
        operation: "add",
        value: { id: NESTED_A },
      },
      tag: "[SR-039/AK2]",
      expect: "output",
    },
    {
      name: "a confirmation that would give a variant validity entries is refused (variant.nested)",
      fixture: NESTED,
      input: {
        selection: { ids: ["VAR-0000c3"] },
        property: "validity",
        operation: "add",
        value: { id: NESTED_A },
        confirm: true,
      },
      tag: "[SR-039/AK2]",
      expect: "error",
    },
    {
      name: "a preview: the number of affected elements and the skipped ones, nothing written (SR-071 AK2, AK3)",
      fixture: FILTER,
      input: { selection: {}, property: "priority", operation: "set", value: 4 },
      expect: "output",
    },
    {
      name: "add a package to a selection, confirmed with the count of the preview (SR-071 AK1, AK2)",
      fixture: FILTER,
      input: {
        selection: { where: { type: ["system-requirement"] } },
        property: "packages",
        operation: "add",
        value: { id: "69069069-0000-4000-8000-0000000000d2" },
        confirm: true,
        expected: 5,
      },
      expect: "output",
    },
    {
      name: "remove a property from elements named by short ID",
      fixture: FILTER,
      input: {
        selection: { ids: ["SR-0000b1", "SR-0000b2"] },
        property: "topic",
        operation: "remove",
        confirm: true,
      },
      expect: "output",
    },
    {
      name: "a confirmation whose count no longer holds (a choice by its display name)",
      fixture: FILTER,
      input: {
        selection: { ids: ["SR-0000b1"] },
        property: "verification-method",
        operation: "set",
        value: "Analysis",
        confirm: true,
        expected: 3,
      },
      expect: "error",
    },
    {
      name: "the status is never a bulk change (D-030)",
      fixture: FILTER,
      input: { selection: {}, property: "status", operation: "set", value: "approved", confirm: true },
      expect: "error",
    },
  ],
  "element.create": [
    {
      name: "relations by short ID are written into the new file with UUID and version (#175)",
      fixture: FILTER,
      input: {
        type: "system-requirement",
        title: "Survive hail",
        relations: { "derives-from": ["N-0000a1"], "based-on": ["D-0000e1"] },
      },
      expect: "output",
      newElement: true,
    },
    {
      name: "a variant is an element file of type variant in the workspace of the core",
      fixture: { fixture: "SR-040/validity", git: true },
      input: { type: "variant", title: "Valley" },
      tag: "[SR-039/AK1]",
      expect: "output",
      newElement: true,
    },
    {
      name: "a variant with validity entries is refused (variant.nested)",
      fixture: NESTED,
      input: { type: "variant", title: "South coast", properties: { validity: [{ id: NESTED_A }] } },
      tag: "[SR-039/AK2]",
      expect: "error",
    },
    {
      name: "new element in a new folder",
      input: {
        type: "system-requirement",
        title: "Show gusts",
        text: "The station shows gusts.\n",
        folder: "requirements/new",
        properties: {
          "requirement-type": "functional",
          "acceptance-criteria": ["Given a gust, then it is shown."],
        },
      },
      expect: "output",
      newElement: true,
    },
    { name: "unknown type", input: { type: "nope", title: "x" }, expect: "error" },
    {
      name: "required properties empty: saved, with the hint",
      input: { type: "system-requirement", title: "Show gusts" },
      tag: "[SR-064/AK2]",
      expect: "output",
      newElement: true,
      check: (results) => {
        const output = (results["core"]?.outcome as { output: Written }).output;
        expect(output.problems.map((p) => [p.code, p.severity, requiredKey(p.message)])).toEqual([
          ["element.missing-required", "warning", "requirement-type"],
          ["element.missing-required", "warning", "acceptance-criteria"],
        ]);
        // Saved: the file is on disk with only what was given, whatever the access (placeholders, newElement).
        const file = "system-requirement/SR-<tail12>.md";
        expect(output.files).toEqual([file]);
        expect(results["core"]?.files[file]).toBe(
          "---\nid: <id>\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\n---\n",
        );
      },
    },
    {
      name: "a package is an element file of type package",
      input: { type: "package", title: "Release 3" },
      tag: "[SR-048/AK1]",
      expect: "output",
      newElement: true,
      check: (results) => {
        const output = (results["core"]?.outcome as { output: Written }).output;
        const file = "package/PKG-<tail12>.md";
        expect(output.files).toEqual([file]);
        expect(results["core"]?.files[file]).toBe(
          "---\nid: <id>\ntype: package\nstatus: draft\ntitle: Release 3\n---\n",
        );
      },
    },
    {
      name: "choice values by display name, in any case, written as keys (#309)",
      input: {
        type: "system-requirement",
        title: "Show gusts",
        properties: { "requirement-type": "Functional", "verification-method": "TEST" },
      },
      expect: "output",
      newElement: true,
    },
    {
      name: "a choice value that is no choice is refused (#309, spec question #316)",
      input: {
        type: "system-requirement",
        title: "Show gusts",
        properties: { "requirement-type": "sometimes" },
      },
      expect: "error",
    },
    {
      name: "malformed input: readable messages, no regular expression (#309)",
      input: { type: "System Requirement", title: 3 },
      expect: "error",
    },
  ],
  "element.get": [
    {
      tag: "[SR-046/AK3]",
      name: "element.get names A as replacing and B as excluding variant",
      fixture: {
        ...VARIANT_VIEWS,
        files: {
          "variants/VAR-0000000000c2.md":
            "---\nid: 43043043-0000-4000-8000-0000000000c2\ntype: variant\nstatus: draft\ntitle: Mountain\n" +
            "excludes: [{ id: 43043043-0000-4000-8000-0000000000a1 }]\n---\n",
        },
      },
      input: { ref: "SR-0000a1" },
      expect: "output",
      check: (results) => {
        const { element } = (results["core"]?.outcome as { output: { element: Record<string, unknown> } })
          .output;
        const P = "43043043-0000-4000-8000-0000000000";
        expect([element["replacedBy"], element["excludedBy"]]).toEqual([
          [{ variant: `${P}c1`, replacement: `${P}b1` }],
          [`${P}c2`],
        ]);
      },
    },
    {
      name: "an element with a reference in an acceptance criterion: its outdated hint (SR-127 AK3)",
      fixture: IN_CRITERIA,
      input: { ref: "SR-0000b1" },
      expect: "output",
    },
    { name: "one element by short ID", input: { ref: "SR-e88fb3" }, expect: "output" },
    { name: "one element by a short ID in lower case (#309)", input: { ref: "sr-E88FB3" }, expect: "output" },
    {
      name: "a reference that names no element: no identifier SR-036 here (#305)",
      input: { ref: "SR-036" },
      expect: "error",
    },
    {
      name: "a malformed reference: spaces at its end (#309)",
      input: { ref: "SR-e88fb3 " },
      expect: "error",
    },
    {
      name: "one element by its identifier, in any case, with the identifiers it names (#305)",
      fixture: IDENTIFIERS,
      input: { ref: "sr-036" },
      expect: "output",
    },
    {
      name: "a short ID of one element that is the identifier of another is ambiguous (#305)",
      fixture: {
        ...IDENTIFIERS,
        files: {
          "decisions/D-0000000c0048.md":
            "---\nid: 30500000-0000-4000-8000-0000000c0048\ntype: decision\nstatus: draft\ntitle: Clash\nspec-id: SR-0b0037\n---\n",
        },
      },
      input: { ref: "SR-0b0037" },
      expect: "error",
    },
    {
      name: "an element with an outdated relation and reference, with dates (SR-026 AK3)",
      fixture: HINTS,
      input: { ref: "SR-0000b1", versionDate: true },
      expect: "output",
    },
    {
      name: "the outdated relation and reference of an element dated, not the element itself (SR-110 AK2)",
      fixture: HINTS,
      input: { ref: "SR-0000b1", hintDates: true },
      expect: "output",
    },
    {
      name: "one element with its version date (D-013)",
      input: { ref: "SR-e88fb3", versionDate: true },
      expect: "output",
    },
    {
      name: "superseded element with its successor (SR-072 AK3)",
      fixture: {
        fixture: "SR-072/supersede",
        git: true,
        files: {
          "needs/N-a1b2c3d4e5f6.md":
            "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6\ntype: need\nstatus: obsolete\ntitle: See the wind\n---\n",
          "needs/N-b2c3d4e5f6a7.md":
            "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7\ntype: need\nstatus: draft\ntitle: See wind and gusts\nsupersedes:\n  - { id: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6, version: n1:1111111111111111, title: See the wind }\n---\n",
        },
      },
      input: { ref: "N-d4e5f6" },
      expect: "output",
    },
    {
      name: "unknown type, read-only (SR-016 AK3)",
      fixture: { fixture: "SR-016/unknown", git: true },
      input: { ref: "2c9e4b71-6d58-4f03-a1e7-0f6a7b8c9d0e" },
      expect: "output",
    },
    {
      name: "relations across repositories, one missing (SR-005, SR-006)",
      fixture: MISSING_TARGETS,
      root: "system",
      input: { ref: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
      expect: "output",
    },
    { name: "unknown reference", input: { ref: "SR-ffffff" }, expect: "error" },
    { name: "view of a variant (stage 5)", input: { ref: "SR-e88fb3", view: "core" }, expect: "error" },
    {
      name: "one copy of a UUID two files share, by repository and file (SR-088, #255)",
      fixture: { fixture: "SR-088/copied-file", git: true },
      root: "system",
      input: {
        ref: "948a10f1-05c3-4212-bd19-00606ccf2661",
        repository: "system",
        file: "copies/N-00606ccf2661.md",
      },
      expect: "output",
    },
    {
      name: "a file that holds none of the elements ref names (#255)",
      fixture: { fixture: "SR-088/copied-file", git: true },
      root: "system",
      input: { ref: "948a10f1-05c3-4212-bd19-00606ccf2661", file: "needs/N-00606ccf2661.md" },
      expect: "error",
    },
  ],
  "element.list": [
    {
      tag: "[SR-041/AK1]",
      name: "the view of A lists A1 instead of K1",
      fixture: VARIANT_VIEWS,
      input: { selection: { view: "VAR-0000c1" } },
      expect: "output",
      check: (results) => {
        const output = (results["core"]?.outcome as { output: { elements: { shortId: string }[] } }).output;
        const shown = output.elements.map((e) => e.shortId);
        expect([shown.includes("SR-0000b1"), shown.includes("SR-0000a1")]).toEqual([true, false]);
      },
    },
    {
      tag: "[SR-043/AK1]",
      name: "the view of A holds K3, K4, A1 and A2 of the requirements",
      fixture: VARIANT_VIEWS,
      input: { selection: { view: "VAR-0000c1", where: { type: ["system-requirement"] } } },
      expect: "output",
      check: (results) => {
        const output = (results["core"]?.outcome as { output: { elements: { shortId: string }[] } }).output;
        expect(output.elements.map((e) => e.shortId)).toEqual([
          "SR-0000a3",
          "SR-0000a4",
          "SR-0000b1",
          "SR-0000b2",
        ]);
      },
    },
    {
      name: "requirements without child, combined, one page with text (SR-069 AK1 to AK3)",
      fixture: FILTER,
      input: {
        selection: {
          where: {
            all: [
              { type: ["system-requirement"] },
              { not: { status: ["obsolete"] } },
              { relation: { meaning: "derivation", direction: "down" }, exists: false },
            ],
          },
        },
        offset: 1,
        limit: 2,
        withText: true,
      },
      expect: "output",
    },
    {
      name: "a package, a filter on a property and a variant at once (SR-101 AK2)",
      fixture: FILTER,
      input: {
        selection: {
          package: "PKG-0000d1",
          view: "VAR-0000c1",
          where: {
            any: [{ property: "requirement-type", op: "eq", value: "Performance" }, { status: ["approved"] }],
          },
        },
      },
      expect: "output",
    },
    ...[
      { pkg: "PKG-0000d1", members: ["SR-0000b1", "SR-0000b2"] },
      { pkg: "PKG-0000d2", members: ["SR-0000b1"] },
    ].map(({ pkg, members }) => ({
      name: `a requirement in P1 and P2 appears in both: the elements of ${pkg}`,
      tag: "[SR-049/AK1]",
      fixture: PACKAGES,
      input: { selection: { package: pkg } },
      expect: "output" as const,
      check: (results: Readonly<Record<string, Result>>) => {
        const output = (results["core"]?.outcome as { output: { elements: { shortId: string }[] } }).output;
        expect(output.elements.map((e) => e.shortId)).toEqual(members);
      },
    })),
    {
      name: "the condition emergent (SR-035)",
      fixture: EMERGENT,
      input: { selection: { where: { all: [{ emergent: true }, { verification: ["open"] }] } } },
      expect: "output",
    },
    {
      name: "the elements with a topic, one item of a list included, as the app lists them (SR-132)",
      tag: "[SR-132/AK2]",
      fixture: VALUES,
      input: { selection: { where: { property: "topic", op: "eq", value: "Timing" } }, sort: TYPE_AND_ID },
      expect: "output",
    },
    {
      name: "the elements with a status as the condition property equals value (SR-132)",
      tag: "[SR-132/AK2]",
      fixture: VALUES,
      input: { selection: { where: { property: "status", op: "eq", value: "approved" } }, sort: TYPE_AND_ID },
      expect: "output",
    },
    {
      name: "the elements with the same package as target (SR-132)",
      tag: "[SR-132/AK3]",
      fixture: VALUES,
      input: {
        selection: { where: { property: "packages", op: "eq", value: "PKG-0000d1" } },
        sort: TYPE_AND_ID,
      },
      expect: "output",
    },
    {
      name: "short IDs in any case (SR-101 AK3)",
      fixture: FILTER,
      input: { selection: { ids: ["SR-0000b3", "sr-0000B1"] } },
      expect: "output",
    },
    {
      name: "sorted by a choice and then by a number descending, one page (SR-075 AK1)",
      fixture: SORT,
      input: { sort: [{ by: "requirement-type" }, { by: "priority", order: "desc" }], offset: 1, limit: 5 },
      expect: "output",
    },
    {
      name: "sorted by type and then by identifier, digit runs as numbers (SR-075 AK1)",
      fixture: NATURAL,
      input: { sort: [{ by: "type" }, { by: "identifier" }], limit: 100 },
      expect: "output",
    },
    {
      name: "the derivation tree with its places, siblings by title, one page (SR-075 AK2)",
      fixture: SORT,
      input: { sort: [{ by: "hierarchy" }, { by: "title" }], offset: 2, limit: 5 },
      expect: "output",
    },
    {
      name: "hierarchy after another sort key (SR-075)",
      fixture: SORT,
      input: { sort: [{ by: "title" }, { by: "hierarchy" }] },
      expect: "error",
    },
    {
      name: "a saved filter by name, in any case, with its sort (SR-070 AK3)",
      fixture: SAVED,
      input: { selection: { filter: "sensor DRAFTS" } },
      expect: "output",
    },
    {
      name: "a saved filter with its view, and another part of the selection (SR-070 AK3, SR-101 AK2)",
      fixture: SAVED,
      input: { selection: { filter: "Mountain", where: { status: ["approved"] } }, sort: [{ by: "id" }] },
      expect: "output",
    },
    {
      name: "a saved filter that is not there (SR-070)",
      fixture: SAVED,
      input: { selection: { filter: "Nope" } },
      expect: "error",
    },
    {
      name: "a saved filter in a faulty file (SR-070)",
      fixture: SAVED,
      input: { selection: { filter: "broken" } },
      expect: "error",
    },
    {
      name: "the condition text: what the full-text search finds, with a typo (SR-068)",
      fixture: FILTER,
      input: { selection: { where: { all: [{ text: "Mesure" }, { not: { type: ["need"] } }] } } },
      expect: "output",
    },
    {
      name: "a regular expression that is none",
      fixture: FILTER,
      input: { selection: { where: { property: "title", op: "matches", value: "(" } } },
      expect: "error",
    },
  ],
  "element.facets": [
    {
      name: "values of a filtered list (#425)",
      fixture: FILTER,
      input: { selection: { where: { type: ["system-requirement"] } } },
      expect: "output",
    },
    {
      name: "free text with a low maxValues (#425)",
      fixture: FILTER,
      input: { maxValues: 1 },
      expect: "output",
    },
    {
      name: "a selection that is not there yet (#425)",
      fixture: FILTER,
      input: { selection: { baseline: "v1" } },
      expect: "error",
    },
  ],
  "element.resolve": [
    {
      name: "short ID with an outdated version (SR-060)",
      input: { ref: "SR-e88fb3", version: "n1:0000000000000000" },
      expect: "output",
    },
    {
      name: "short ID with its version date (D-013)",
      input: { ref: "SR-e88fb3", versionDate: true },
      expect: "output",
    },
    { name: "unknown short ID (SR-060 AK3)", input: { ref: "SR-ffffff" }, expect: "error" },
    {
      name: "one copy of a UUID two files share, by file (SR-088, #255)",
      fixture: { fixture: "SR-088/copied-file", git: true },
      root: "system",
      input: { ref: "N-cf2661", file: "requirements/N-00606ccf2661.md" },
      expect: "output",
    },
    {
      name: "outdated prefix names the candidate (SR-060 AK3, #275)",
      fixture: {
        fixture: "SR-004/one-repository",
        git: true,
        files: {
          "requirements/SR-7a8b9c0d1e2f.md":
            "---\nid: 9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f\ntype: need\nstatus: draft\ntitle: Formerly a requirement\n---\n",
        },
      },
      input: { ref: "SR-0d1e2f" },
      expect: "error",
    },
    {
      name: "element without a version: current is unknown (#276)",
      fixture: {
        fixture: "SR-004/one-repository",
        git: true,
        files: {
          "requirements/SR-1d2e3f4a5b6c.md":
            "---\nid: 3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nrequirement-type: functional\nacceptance-criteria: .inf\n---\n",
        },
      },
      input: { ref: "SR-4a5b6c", version: "n1:0000000000000000", versionDate: true },
      expect: "output",
    },
  ],
  "element.setStatus": [
    { name: "approve one element", input: { refs: ["SR-e88fb3"], status: "approved" }, expect: "output" },
    {
      name: "a status by its display name, in any case (#309)",
      input: { refs: ["sr-e88fb3"], status: "APPROVED" },
      expect: "output",
    },
    {
      name: "status not in the metamodel",
      input: { refs: ["SR-e88fb3"], status: "released" },
      expect: "error",
    },
    {
      name: "remove a leftover status with status null: CLI via --input (#343)",
      fixture: STATUSES_PER_TYPE,
      input: { refs: ["T-eee002"], status: null },
      expect: "output",
    },
    {
      name: "remove the status of an element whose type requires one (#343)",
      fixture: STATUSES_PER_TYPE,
      input: { refs: ["SR-bbb001"], status: null },
      expect: "error",
    },
  ],
  "element.supersede": [
    {
      name: "supersede with a successor and hints",
      fixture: { fixture: "SR-072/supersede", git: true },
      input: { ref: "N-d4e5f6", status: "obsolete", successor: "N-e5f6a7" },
      expect: "output",
    },
    {
      name: "status not marked invalid",
      fixture: { fixture: "SR-072/supersede", git: true },
      input: { ref: "N-d4e5f6", status: "approved" },
      expect: "error",
    },
    {
      name: "several succession kinds fit (relation-ambiguous)",
      fixture: {
        fixture: "SR-072/supersede",
        git: true,
        // A second kind with the meaning succession next to `supersedes`.
        files: {
          "metamodel/succession.yaml":
            "reqseq-metamodel: 1\nrelations:\n  - { key: obsoletes, name: Obsoletes, meaning: succession }\n",
        },
      },
      input: { ref: "SR-f6a7b8", status: "obsolete", successor: "SR-a7b8c9" },
      expect: "error",
    },
  ],
  "element.search": [
    {
      name: "a word only in a property, with a typo, in another case (SR-068 AK1, AK2)",
      fixture: FILTER,
      input: { query: "SUPLIER" },
      expect: "output",
    },
    {
      name: "within a view and a filter, one page (SR-068 AK3)",
      fixture: FILTER,
      input: {
        query: "measure",
        selection: { view: "VAR-0000c1", where: { status: ["approved", "draft"] } },
        limit: 1,
        offset: 1,
      },
      expect: "output",
    },
    {
      name: "a short ID in lower case, in title and IDs only (SR-068 AK1, SR-066)",
      fixture: FILTER,
      input: { query: "sr-0000B2", fields: ["title", "id"] },
      expect: "output",
    },
    {
      name: "an identifier, first, with the words of its property (#305)",
      fixture: IDENTIFIERS,
      input: { query: "sr-036" },
      expect: "output",
    },
    {
      name: "within a saved filter with its view (SR-068 AK3, SR-070)",
      fixture: SAVED,
      input: { query: "measure", selection: { filter: "mountain" } },
      expect: "output",
    },
    {
      name: "a selection that is not there yet",
      fixture: FILTER,
      input: { query: "wind", selection: { baseline: "v1" } },
      expect: "error",
    },
    {
      name: "a target of a chosen relation kind: only its target types (SR-067 AK2)",
      fixture: FILTER,
      input: {
        query: "draft",
        selection: {
          where: { type: ["software-requirement", "need", "use-case", "system-requirement"] },
        },
      },
      expect: "output",
    },
  ],
  "element.update": [
    {
      name: "relations added and removed by short ID in the same write as a property (#175)",
      fixture: FILTER,
      input: {
        ref: "SR-0000b1",
        set: { topic: "Gusts" },
        addRelations: { "derives-from": ["N-0000a2"] },
        removeRelations: { "based-on": "D-0000e1" },
      },
      expect: "output",
    },
    {
      name: "a relation the metamodel does not allow is refused (#175)",
      fixture: FILTER,
      input: { ref: "SR-0000b1", addRelations: { "derives-from": ["PKG-0000d1"] } },
      expect: "error",
    },
    {
      name: "a reqseq: link by short ID is written as UUID and version, an unknown one is refused (#176)",
      fixture: {
        fixture: "SR-004/one-repository",
        git: true,
        files: {
          "requirements/SR-0000000b0176.md":
            "---\nid: 17600000-0000-4000-8000-0000000b0176\ntype: system-requirement\nstatus: draft\ntitle: Linking\n---\n",
        },
      },
      input: { ref: "SR-0b0176", text: "See [wind](reqseq:SR-e88fb3).\n" },
      expect: "output",
    },
    {
      name: "a reqseq: link whose short ID names no element is refused (#176)",
      input: { ref: "SR-e88fb3", text: "See [gone](reqseq:SR-999999).\n" },
      expect: "error",
    },
    {
      name: "packages given by short ID in { id } are written as UUID and version (#169, #196)",
      fixture: FILTER,
      input: { ref: "SR-0000b1", set: { packages: [{ id: "PKG-0000d2" }, { id: "pkg-0000D1" }] } },
      expect: "output",
    },
    {
      name: "setting an origin property is refused: only reqif.import writes it",
      input: { ref: "SR-e88fb3", set: { source: "Kunde B" } },
      tag: "[SR-057/AK3]",
      expect: "error",
    },
    {
      name: "a variant whose validity names a variant is refused (variant.nested)",
      fixture: NESTED,
      input: { ref: "VAR-0000b2", title: "North" },
      tag: "[SR-039/AK2]",
      expect: "error",
    },
    {
      name: "a relation between variants is allowed",
      fixture: NESTED,
      input: { ref: "VAR-0000c3", title: "Mountains" },
      tag: "[SR-039/AK2]",
      expect: "output",
    },
    {
      name: "update a superseded element with a successor: same view with the successor relation everywhere (consistency, SR-072 AK3)",
      fixture: {
        fixture: "SR-072/supersede",
        git: true,
        files: {
          "needs/N-a1b2c3d4e5f6.md":
            "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6\ntype: need\nstatus: obsolete\ntitle: See the wind\n---\n",
          "needs/N-b2c3d4e5f6a7.md":
            "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7\ntype: need\nstatus: draft\ntitle: See wind and gusts\nsupersedes:\n  - { id: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6, version: n1:1111111111111111, title: See the wind }\n---\n",
        },
      },
      input: { ref: "N-d4e5f6", text: "Changed.\n" },
      expect: "output",
    },
    {
      name: "update an element with a relation to a superseded element (SR-072 AK2 hint)",
      fixture: { fixture: "SR-019/findings", git: true },
      input: { ref: "2b2b2b2b-2222-4222-8222-b00000000008", text: "Changed.\n" },
      expect: "output",
    },
    {
      name: "update an element with a validity target, shown in relations (#187)",
      fixture: { fixture: "SR-019/findings", git: true },
      input: { ref: "2b2b2b2b-2222-4222-8222-b00000000009", text: "Changed.\n" },
      expect: "output",
    },
    {
      name: "rename and set a property",
      input: {
        ref: "SR-e88fb3",
        title: "Show the wind speed",
        text: "New text.\n",
        set: { rationale: "Pilots" },
      },
      expect: "output",
    },
    {
      name: "add a required and an optional property the element lacks; the hint of the filled one is gone",
      input: { ref: "SR-e88fb3", set: { "verification-method": "test", "requirement-type": "functional" } },
      tag: "[SR-064/AK3]",
      expect: "output",
      check: (results) => {
        const output = (results["core"]?.outcome as { output: Written }).output;
        expect(output.element.properties).toEqual({
          "requirement-type": "functional",
          "verification-method": "test",
        });
        expect(output.problems.map((p) => [p.code, requiredKey(p.message)])).toEqual([
          ["element.missing-required", "acceptance-criteria"],
        ]);
      },
    },
    { name: "unknown reference", input: { ref: "SR-ffffff", title: "x" }, expect: "error" },
    {
      name: "a save with the SHA-256 of the file as read is written (SR-106)",
      input: { ref: "SR-e88fb3", title: "Show the wind speed", expectedFileSha256: WIND_SHA256 },
      expect: "output",
    },
    {
      name: "a save with an old SHA-256 writes nothing: file.changed-on-disk (SR-106)",
      input: { ref: "SR-e88fb3", title: "Show the wind speed", expectedFileSha256: "0".repeat(64) },
      expect: "error",
    },
    {
      name: "change the text of an element two others point at: affected 2 (SR-024 AK2)",
      fixture: AFFECTED,
      input: { ref: "SR-00b001", text: "Changed.\n" },
      expect: "output",
    },
  ],
  "evidence.coverage": [
    {
      name: "the whole workspace in two repositories, with an obsolete child (SR-036)",
      fixture: COVERAGE,
      root: "system",
      input: {},
      expect: "output",
    },
    {
      name: "a saved filter in the core view (SR-036)",
      fixture: COVERAGE,
      root: "system",
      input: { selection: { filter: "Requirements", view: "core" } },
      expect: "output",
    },
    {
      name: "a package page counts 8 of 10 requirements with evidence, not its need",
      fixture: DEGREE,
      input: { selection: { package: "PKG-00d003" } },
      tag: "[SR-112/AK3]",
      expect: "output",
      check: (results) => {
        const { levels } = (results["core"]?.outcome as { output: { levels: readonly CoverageLevel[] } })
          .output;
        expect(levels.map(({ type, total, withEvidence }) => [type, total, withEvidence])).toEqual([
          ["need", 1, undefined],
          ["system-requirement", 10, 8],
        ]);
      },
    },
    {
      name: "an unknown package gives the same error (#535 fixture)",
      fixture: EVIDENCE,
      input: { selection: { package: "PKG-ffffff" } },
      expect: "error",
    },
    {
      name: "a workspace with an evidence location (#535)",
      fixture: EVIDENCE,
      input: { selection: { ids: ["SR-e88fb3"] } },
      expect: "output",
    },
  ],
  "evidence.degree": [
    {
      name: "a variant view names its variant (SR-037, #588)",
      fixture: STATUS,
      input: { selection: { view: "5e031a7d-2b4f-4c61-9d08-0c0000000001" } },
      expect: "output",
    },
    {
      name: "the whole workspace (SR-037)",
      fixture: DEGREE,
      input: {},
      expect: "output",
    },
    {
      name: "a package with an indirect requirement (SR-037 AK2)",
      fixture: DEGREE,
      input: { selection: { package: "PKG-00d002" } },
      expect: "output",
    },
    {
      name: "a package page counts 6 verified, 1 failed, 1 outdated and 2 open",
      fixture: DEGREE,
      input: { selection: { package: "PKG-00d003" } },
      tag: "[SR-112/AK3]",
      expect: "output",
      check: (results) => {
        expect((results["core"]?.outcome as { output: { degree: unknown } }).output.degree).toEqual({
          share: 0.6,
          total: 10,
          counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
        });
      },
    },
    {
      name: "a package with obsolete requirements in the core view (SR-037 AK3)",
      fixture: DEGREE,
      input: { selection: { package: "PKG-00d003", view: "core" } },
      expect: "output",
    },
    {
      name: "an unknown package gives the same error",
      fixture: DEGREE,
      input: { selection: { package: "PKG-ffffff" } },
      expect: "error",
    },
    {
      name: "a workspace with an evidence location (#535)",
      fixture: EVIDENCE,
      input: { selection: { ids: ["SR-e88fb3"] } },
      expect: "output",
    },
  ],
  // `file` and `output` are localPaths (see workspace.init below). The date is given: without it the
  // time of the call would differ between the accesses.
  "evidence.enrichJunit": [
    {
      name: "a JUnit file in place, with an unknown short ID listed (SR-029 AK1, AK2)",
      fixture: RAW_JUNIT,
      input: { file: "results/raw.xml", item: "build-513", date: "2026-10-27T10:00:00Z" },
      expect: "output",
    },
    {
      name: "a JUnit file into the evidence folder (SR-029 AK3)",
      fixture: RAW_JUNIT,
      input: {
        file: "results/raw.xml",
        item: "build-513",
        date: "2026-10-27T10:00:00Z",
        output: "evidence/ci/raw.xml",
      },
      expect: "output",
    },
    {
      name: "an enriched file is kept as it is (D-026)",
      fixture: EVIDENCE,
      input: { file: "evidence/ci/results.xml", item: "build-513", date: "2026-10-27T10:00:00Z" },
      expect: "output",
    },
    {
      name: "a file that is not there",
      fixture: EVIDENCE,
      input: { file: "results/gone.xml", item: "build-513" },
      expect: "error",
    },
  ],
  "evidence.list": [
    {
      name: "the records of a requirement with the baselines of their version, and a faulty baseline file (SR-032)",
      fixture: {
        ...EVIDENCE,
        files: {
          "baselines/release-1.0.yaml":
            "reqseq-baseline: 1\nname: Release 1.0\ndate: 2026-10-24T09:30:00Z\nrepositories:\n" +
            "  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }\nelements:\n" +
            "  - { id: e8df96ea-a168-4d90-8d65-6328cee88fb3, version: n1:11335f109ffb1a19 }\n",
          "baselines/broken.yaml": "reqseq-baseline: 1\nname: Broken\n",
        },
      },
      input: { ref: "SR-e88fb3" },
      expect: "output",
    },
    {
      name: "the records of the core of a requirement and its baselines (SR-032 AK2)",
      fixture: { fixture: "SR-032/baselines", git: true },
      input: { ref: "SR-0032a1", view: "core" },
      expect: "output",
    },
    {
      name: "an unknown element gives the same error",
      fixture: EVIDENCE,
      input: { ref: "SR-ffffff" },
      expect: "error",
    },
  ],
  // The date is given: without it the time of the call would differ between the accesses.
  "evidence.record": [
    {
      name: "a manual inspection record of a requirement in the evidence folder (SR-030 AK1, AK2)",
      fixture: EVIDENCE,
      input: {
        ref: "SR-e88fb3",
        kind: "verification",
        result: "passed",
        method: "inspection",
        item: "unit 7",
        date: "2026-10-27T10:00:00Z",
        evidence: "photos/unit-7.jpg",
      },
      expect: "output",
    },
    {
      name: "an unknown element gives the same error",
      fixture: EVIDENCE,
      input: { ref: "SR-ffffff", kind: "validation", result: "passed", date: "2026-10-27T10:00:00Z" },
      expect: "error",
    },
    {
      name: "a record for a variant that excludes the requirement is refused (SR-047 AK4)",
      fixture: VARIANT_EVIDENCE,
      input: {
        ref: "SR-0000a2",
        kind: "verification",
        method: "test",
        item: "build-47",
        result: "passed",
        variant: "VAR-0000c1",
      },
      tag: "[SR-047/AK4]",
      expect: "error",
    },
    {
      name: "a record for a variant that replaces the requirement is refused (SR-047 AK4)",
      fixture: VARIANT_EVIDENCE,
      input: {
        ref: "SR-0000a1",
        kind: "verification",
        method: "test",
        item: "build-47",
        result: "passed",
        variant: "VAR-0000c1",
      },
      tag: "[SR-047/AK4]",
      expect: "error",
    },
    {
      name: "a validation record with a variant is refused (SR-038 AK4)",
      fixture: VARIANT_EVIDENCE,
      input: {
        ref: "SR-0000a3",
        kind: "validation",
        result: "passed",
        variant: "VAR-0000c1",
        date: "2026-10-27T10:00:00Z",
      },
      tag: "[SR-038/AK4]",
      expect: "error",
    },
  ],
  "evidence.status": [
    {
      name: "no row for a variant that excludes or replaces the requirement (SR-047 AK3)",
      fixture: VARIANT_EVIDENCE,
      input: { selection: { ids: ["SR-0000a1", "SR-0000a2", "SR-0000b1"] } },
      tag: "[SR-047/AK3]",
      expect: "output",
    },
    {
      name: "the verification status of a workspace with an evidence location (#535, SR-031)",
      fixture: EVIDENCE,
      input: {},
      expect: "output",
    },
    {
      name: "the verification status per view of requirements valid for variants, one page (SR-031, SR-047)",
      fixture: FILTER,
      input: { selection: { where: { verification: ["open"] }, view: "VAR-0000c1" }, limit: 3, offset: 1 },
      expect: "output",
    },
    {
      name: "indirect verification and missing children (SR-034)",
      fixture: INDIRECT,
      input: {},
      expect: "output",
    },
    {
      name: "validation status apart from the verification status (SR-038)",
      fixture: VALIDATION,
      input: {},
      expect: "output",
    },
    {
      name: "emergent requirements need their own record (SR-035)",
      fixture: EMERGENT,
      input: {},
      expect: "output",
    },
    {
      name: "unknown element in the selection",
      fixture: EVIDENCE,
      input: { selection: { ids: ["SR-ffffff"] } },
      expect: "error",
    },
  ],
  "evidence.withoutPassedTest": [
    {
      name: "requirements without passed test, from JUnit runs with a skipped test case and an inspection (SR-120)",
      fixture: MATRIX_EVIDENCE,
      input: {},
      expect: "output",
    },
    {
      name: "one page in the order by type and identifier (SR-120)",
      fixture: MATRIX_EVIDENCE,
      input: { limit: 2, offset: 1 },
      expect: "output",
    },
    {
      name: "in a variant view, only the records for it count (SR-120, SR-047)",
      fixture: FILTER,
      input: { view: "VAR-0000c1" },
      expect: "output",
    },
    {
      name: "a workspace with an evidence location (#535)",
      fixture: EVIDENCE,
      input: {},
      expect: "output",
    },
    {
      name: "a view that is no variant gives the same error",
      fixture: EVIDENCE,
      input: { view: "SR-e88fb3" },
      expect: "error",
    },
  ],
  "filter.list": [
    {
      name: "hand-written filters with their definitions, and a faulty file (SR-070 AK2)",
      fixture: SAVED,
      input: {},
      expect: "output",
    },
  ],
  "filter.save": [
    {
      name: "a new filter as a YAML file, its references as UUIDs (SR-070 AK1)",
      fixture: SAVED,
      input: {
        name: "Coastal drafts",
        description: "Open work near the coast",
        view: "var-0000c1",
        where: { all: [{ status: ["draft"] }, { package: "pkg-0000d1" }] },
        sort: [{ by: "title" }],
      },
      expect: "output",
    },
    {
      name: "an existing name replaces that filter in its own file, keeping its comments (SR-070 AK1)",
      fixture: SAVED,
      input: {
        name: "SENSOR DRAFTS",
        where: { all: [{ package: "PKG-0000d1" }, { status: ["draft", "approved"] }] },
      },
      expect: "output",
    },
    {
      name: "a condition that is wrong",
      fixture: SAVED,
      input: { name: "Wrong", where: { package: "SR-0000b1" } },
      expect: "error",
    },
  ],
  "hint.list": [
    {
      name: "the outdated reference in an acceptance criterion, with its hint ID and line (SR-127 AK3)",
      fixture: IN_CRITERIA,
      input: { kind: ["relation.outdated"] },
      expect: "output",
    },
    {
      name: "every open hint with kind, element, target and reason, dates from Git (SR-026 AK1)",
      fixture: HINTS,
      input: {},
      expect: "output",
    },
    {
      name: "filtered by kind, type, package and variant (SR-026 AK2)",
      fixture: HINTS,
      input: {
        kind: ["element.unknown-property"],
        type: ["system-requirement"],
        package: "PKG-0000d1",
        variant: "VAR-0000c2",
      },
      expect: "output",
    },
    {
      name: "hints of one element (SR-026 AK3)",
      fixture: HINTS,
      input: { ref: "SR-0000b1" },
      expect: "output",
    },
    { name: "no package", fixture: HINTS, input: { package: "VAR-0000c1" }, expect: "error" },
    {
      tag: "[SR-045/AK1]",
      name: "a changed core requirement is one hint at its replacement, listed for the variant",
      fixture: CORE_CHANGED,
      input: { variant: "VAR-0000c1", kind: ["variant.core-changed", "relation.outdated"] },
      expect: "output",
      check: (results) => {
        const output = (
          results["core"]?.outcome as { output: { hints: { code: string; elementShortId: string }[] } }
        ).output;
        expect(output.hints.map((h) => [h.code, h.elementShortId])).toEqual([
          ["variant.core-changed", "SR-0000b1"],
          ["relation.outdated", "SR-0000b2"],
        ]);
      },
    },
    {
      tag: "[SR-103/AK1]",
      name: "a core requirement changed since the variant's newest baseline is a hint at the variant",
      fixture: SINCE_BASELINE,
      input: { variant: "VAR-0000c1" },
      expect: "output",
      check: (results) => {
        const output = (
          results["core"]?.outcome as { output: { hints: { code: string; elementShortId: string }[] } }
        ).output;
        expect(output.hints.map((h) => [h.code, h.elementShortId])).toEqual([
          ["variant.core-changed-since-baseline", "VAR-0000c1"],
        ]);
      },
    },
  ],
  "hint.confirm": [
    {
      name: "an inline reference in an acceptance criterion, and the same ID spelled again (SR-127 AK3)",
      fixture: IN_CRITERIA,
      input: { hintIds: [CRITERION_HINT, CRITERION_HINT] },
      expect: "output",
    },
    {
      name: "a relation and an inline reference at once, and IDs that confirm nothing (SR-027 AK1, AK2)",
      fixture: HINTS,
      input: {
        hintIds: [
          `${HINT_AT_B1}/derives-from/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000`,
          `${HINT_AT_B1}/@text/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000&n=1`,
          `${HINT_AT_B1}/derives-from/26a0b000-0000-4000-8000-0000000000a1?version=n1:1111111111111111`,
          "element.unknown-property",
        ],
      },
      expect: "output",
    },
    { name: "hint IDs that are not a list", fixture: HINTS, input: { hintIds: "x" }, expect: "error" },
    {
      name: "every open hint that points at an element (#310)",
      fixture: HINTS,
      input: { target: "N-0000a1" },
      expect: "output",
    },
    {
      name: "the hints of one element of one kind, together with a given ID (#310)",
      fixture: HINTS,
      input: {
        ref: "SR-0000b1",
        kind: ["relation.outdated"],
        hintIds: [`${HINT_AT_B1}/@text/26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000&n=1`],
      },
      expect: "output",
    },
    {
      name: "an element without a hint to confirm: a warning (#310)",
      fixture: HINTS,
      input: { ref: "N-0000a1" },
      expect: "output",
    },
    { name: "kind without ref or target (#310)", fixture: HINTS, input: { kind: ["x"] }, expect: "error" },
    {
      tag: "[SR-103/AK5]",
      name: "a since-baseline hint is refused: a new baseline settles it",
      fixture: SINCE_BASELINE,
      input: { ref: "VAR-0000c1", kind: ["variant.core-changed-since-baseline"] },
      expect: "output",
    },
  ],
  "trace.affected": [
    {
      name: "an element that an acceptance criterion references, with the criterion as the link (SR-127 AK3)",
      fixture: IN_CRITERIA,
      input: { ref: "N-0000a2" },
      expect: "output",
    },
    {
      name: "affected elements of a need, directly and through the chain (SR-024 AK1)",
      fixture: AFFECTED,
      input: { ref: "N-00a001" },
      expect: "output",
    },
    {
      name: "one page of the affected elements of a need",
      fixture: AFFECTED,
      input: { ref: "N-00a001", limit: 2, offset: 1 },
      expect: "output",
    },
    {
      name: "a relation that is no derivation, then the chain, and a repository that is not here (SR-006)",
      fixture: {
        ...AFFECTED,
        files: {
          "reqseq-workspace.yaml": WITH_VAULT,
        },
      },
      input: { ref: "D-00d001" },
      expect: "output",
    },
    {
      name: "no relation kind with the meaning derivation (SR-013 AK3)",
      fixture: MISSING_TARGETS,
      root: "system",
      input: { ref: "SR-c4d5e6" },
      expect: "error",
    },
    { name: "unknown reference", fixture: AFFECTED, input: { ref: "SR-ffffff" }, expect: "error" },
  ],
  "trace.chain": [
    {
      name: "the chain of a need named by its identifier, each node with its identifier (#305)",
      fixture: IDENTIFIERS,
      input: { ref: "N-001" },
      expect: "output",
    },
    {
      name: "a need down to its component requirements, with gaps (SR-022)",
      fixture: CHAIN,
      input: { ref: "N-00a001" },
      expect: "output",
    },
    {
      name: "the chain of a requirement with an executed and a skipped test case and an inspection (SR-033)",
      fixture: EVIDENCE,
      input: { ref: "SR-e88fb3" },
      expect: "output",
    },
    {
      name: "one page of a chain up and down (SR-082 AK4, spec-frage #290)",
      fixture: CHAIN,
      input: { ref: "SR-00b001", limit: 2, offset: 1 },
      expect: "output",
    },
    {
      name: "up from a component requirement to depth 1, in the core view",
      fixture: CHAIN,
      input: { ref: "CR-00c002", direction: "up", maxDepth: 1, view: "core" },
      expect: "output",
    },
    {
      name: "a cycle and a parent in a repository that is not here (SR-022 AK4, SR-006)",
      fixture: {
        fixture: "SR-022/chain",
        git: true,
        files: {
          "reqseq-workspace.yaml": WITH_VAULT,
          "components/CR-00000000c001.md":
            "---\nid: 5c0e1d2a-0022-4022-8022-00000000c001\ntype: component-requirement\nstatus: draft\ntitle: Count anemometer turns\n" +
            "derives-from:\n" +
            "  - { id: 5c0e1d2a-0022-4022-8022-00000000b001, version: n1:0000000000000000 }\n" +
            "  - { id: 5c0e1d2a-0022-4022-8022-00000000c002, version: n1:0000000000000000 }\n" +
            "  - { id: 5c0e1d2a-0022-4022-8022-00000000f001, version: n1:0000000000000000, repository: vault }\n" +
            "---\n",
        },
      },
      input: { ref: "SR-00b001" },
      expect: "output",
    },
    {
      name: "no relation kind with the meaning derivation (SR-013 AK3)",
      fixture: MISSING_TARGETS,
      root: "system",
      input: { ref: "SR-c4d5e6" },
      expect: "error",
    },
    { name: "unknown reference", fixture: CHAIN, input: { ref: "SR-ffffff" }, expect: "error" },
    {
      name: "view of no variant",
      fixture: CHAIN,
      input: { ref: "N-00a001", view: "N-00a002" },
      expect: "error",
    },
  ],
  "trace.neighbourhood": [
    {
      name: "the direct neighbours of a requirement over every kind (SR-107 AK2)",
      fixture: NEIGHBOURHOOD,
      input: { ref: `${NB}0b0000000001` },
      expect: "output",
    },
    {
      name: "children level by level, derivations only, one page (SR-107 AK2, AK3)",
      fixture: NEIGHBOURHOOD,
      input: {
        ref: `${NB}0a0000000001`,
        direction: "down",
        meanings: ["derivation"],
        maxDepth: 2,
        limit: 2,
        offset: 2,
      },
      expect: "output",
    },
    {
      name: "the whole way up along one relation kind (SR-107 AK1)",
      fixture: NEIGHBOURHOOD,
      input: { ref: `${NB}0c0000000001`, direction: "up", kinds: ["derives-from"], allLevels: true },
      expect: "output",
    },
    {
      name: "a key that is no relation kind",
      fixture: NEIGHBOURHOOD,
      input: { ref: `${NB}0b0000000001`, kinds: ["nope"] },
      expect: "error",
    },
    {
      name: "the element in the repository the app names (SR-107)",
      fixture: NEIGHBOURHOOD,
      input: { ref: `${NB}0b0000000001`, repository: "system", direction: "down", meanings: ["derivation"] },
      expect: "output",
    },
    {
      name: "a repository that holds no such element",
      fixture: NEIGHBOURHOOD,
      input: { ref: `${NB}0b0000000001`, repository: "vault" },
      expect: "error",
    },
    { name: "unknown reference", fixture: NEIGHBOURHOOD, input: { ref: "SR-ffffff" }, expect: "error" },
  ],
  "trace.graph": [
    {
      name: "the direct neighbours of a requirement over every kind, with marks (SR-111 AK1, AK4)",
      fixture: GRAPH,
      input: { ref: `${GR}0b0000000001` },
      expect: "output",
    },
    {
      name: "the whole derivation chain (SR-111 AK2, AK3)",
      fixture: GRAPH,
      input: { ref: `${GR}0b0000000001`, allLevels: true, meanings: ["derivation"] },
      expect: "output",
    },
    {
      name: "one relation kind in the repository the app names, two levels (SR-111 AK2, AK3)",
      fixture: GRAPH,
      input: { ref: `${GR}0b0000000001`, repository: "system", kinds: ["based-on"], maxDepth: 2 },
      expect: "output",
    },
    {
      name: "the core view, cut by limit (SR-111 AK2, SR-040)",
      fixture: GRAPH,
      input: { ref: `${GR}0b0000000001`, allLevels: true, view: "core", limit: 8 },
      expect: "output",
    },
    {
      name: "maxDepth and allLevels together",
      fixture: GRAPH,
      input: { ref: `${GR}0b0000000001`, maxDepth: 1, allLevels: true },
      expect: "error",
    },
    {
      name: "a key that is no relation kind",
      fixture: GRAPH,
      input: { ref: `${GR}0b0000000001`, kinds: ["nope"] },
      expect: "error",
    },
    { name: "unknown reference", fixture: GRAPH, input: { ref: "SR-ffffff" }, expect: "error" },
  ],
  "trace.matrix": [
    {
      tag: "[SR-125/AK6]",
      name: "a package gives the same rows, columns and cells",
      fixture: MATRIX,
      input: { selection: { package: "PKG-000001" } },
      expect: "output",
    },
    {
      tag: "[SR-125/AK6]",
      name: "a saved filter with its own sort",
      fixture: MATRIX,
      input: { selection: { filter: "Stage SRs" } },
      expect: "output",
    },
    {
      tag: "[SR-125/AK6]",
      name: "a list of IDs, the sort of the app's list",
      fixture: MATRIX,
      input: {
        selection: { ids: [`${MX}0b0000000005`, `${MX}0b0000000001`, `${MX}0a0000000001`] },
        sort: [
          { by: "type", order: "asc" },
          { by: "identifier", order: "asc" },
        ],
      },
      expect: "output",
    },
    {
      tag: "[SR-125/AK6]",
      name: "the derivation tree, one page, with the properties named",
      fixture: MATRIX,
      input: {
        selection: { package: "PKG-000001" },
        sort: [{ by: "hierarchy" }],
        kinds: ["packages", "derives-from"],
        limit: 2,
        offset: 1,
      },
      expect: "output",
    },
    {
      name: "relations seen through the core view (SR-125 AK3)",
      fixture: MATRIX,
      input: { selection: { package: "PKG-000001", view: "core" } },
      expect: "output",
    },
    {
      name: "the matrix of a selection with evidence (SR-126)",
      fixture: MATRIX_EVIDENCE,
      input: { selection: { where: { type: ["system-requirement"] } } },
      expect: "output",
    },
    {
      name: "one page of the matrix of a selection with evidence (SR-126)",
      fixture: MATRIX_EVIDENCE,
      input: { selection: { where: { type: ["system-requirement"] } }, limit: 3, offset: 2 },
      expect: "output",
    },
    {
      name: "the matrix in a variant view names its variant (SR-126, #588)",
      fixture: STATUS,
      input: { selection: { view: "5e031a7d-2b4f-4c61-9d08-0c0000000001" } },
      expect: "output",
    },
    {
      name: "a key that is no relation kind",
      fixture: MATRIX,
      input: { selection: { package: "PKG-000001" }, kinds: ["nope"] },
      expect: "error",
    },
    {
      name: "an unknown saved filter",
      fixture: MATRIX,
      input: { selection: { filter: "no such filter" } },
      expect: "error",
    },
  ],
  "trace.related": [
    {
      name: "children of two parents up to a depth, one page (SR-023 AK1, AK2)",
      fixture: RELATED,
      input: { refs: ["N-0000a1", "N-0000a2"], direction: "children", maxDepth: 2, offset: 1, limit: 2 },
      expect: "output",
    },
    {
      name: "parents of a selection in the core view (SR-023 AK3)",
      fixture: RELATED,
      input: { refs: ["SR-0000b4", "SR-0000b5"], direction: "parents", view: "core" },
      expect: "output",
    },
    {
      name: "metamodel without the meaning derivation (SR-013 AK3)",
      fixture: MISSING_TARGETS,
      root: "system",
      input: { refs: ["9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"], direction: "parents" },
      expect: "error",
    },
    {
      name: "children while a repository is missing, incomplete (SR-006 AK2)",
      fixture: {
        fixture: "SR-023/related",
        git: true,
        files: {
          "reqseq-workspace.yaml":
            "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
            '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
            '  - { name: away, url: "git@git.example.com:ws/away.git", path: ../away }\n' +
            "metamodel: { repository: system, path: metamodel }\n",
        },
      },
      input: { refs: ["SR-0000b1"], direction: "children" },
      expect: "output",
    },
    {
      name: "unknown reference",
      fixture: RELATED,
      input: { refs: ["N-ffffff"], direction: "children" },
      expect: "error",
    },
  ],
  "relation.options": [
    {
      name: "the kinds a system requirement may get, with their target types (SR-067 AK1)",
      fixture: FILTER,
      input: { ref: "SR-0000b1" },
      expect: "output",
    },
    {
      name: "one chosen kind, by a short ID in lower case (SR-067 AK2)",
      fixture: FILTER,
      input: { ref: "swr-0000f1", kind: "derives-from" },
      expect: "output",
    },
    {
      name: "a kind the type does not allow: none (SR-067 AK1)",
      fixture: FILTER,
      input: { ref: "N-0000a1", kind: "derives-from" },
      expect: "output",
    },
    {
      name: "a key that is no relation kind",
      fixture: FILTER,
      input: { ref: "N-0000a1", kind: "nope" },
      expect: "error",
    },
    { name: "unknown reference", fixture: FILTER, input: { ref: "SR-ffffff" }, expect: "error" },
  ],
  "relation.add": [
    {
      name: "a derivation that closes a cycle, with hints (SR-067 AK3)",
      fixture: { fixture: "SR-090/cycle", git: true },
      input: {
        source: "SR-b0000000001",
        kind: "derives-from",
        target: "5e9c0a7d-2b4f-4c61-9d08-0b0000000004",
      },
      expect: "output",
    },
    {
      name: "a relation across repositories (SR-005)",
      fixture: { fixture: "SR-021/targets", git: ["system", "sensor"] },
      root: "system",
      input: {
        source: "6e2f8a4c-1b3d-4c5e-9f7a-3d8b2c6e1f05",
        kind: "derives-from",
        target: "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21",
      },
      expect: "output",
    },
    {
      name: "a relation the metamodel does not allow",
      fixture: { fixture: "SR-090/cycle", git: true },
      input: { source: "N-a0000000001", kind: "derives-from", target: "SR-b0000000001" },
      expect: "error",
    },
    {
      name: "a stored relation without version gets its current version (#302)",
      fixture: {
        fixture: "SR-090/cycle",
        git: true,
        files: {
          "requirements/SR-0b0000000004.md":
            "---\nid: 5e9c0a7d-2b4f-4c61-9d08-0b0000000004\ntype: system-requirement\nstatus: draft\n" +
            "title: Show wind in large digits\nrequirement-type: functional\n" +
            "acceptance-criteria:\n  - Given wind, when it is measured, then the station shows it in large digits.\n" +
            'derives-from:\n  - { id: 5e9c0a7d-2b4f-4c61-9d08-0b0000000001, title: "Migrated" }\n---\n\nD.\n',
        },
      },
      input: { source: "SR-b0000000004", kind: "derives-from", target: "SR-b0000000001" },
      expect: "output",
    },
  ],
  "relation.remove": [
    {
      name: "a relation that closed a cycle",
      fixture: { fixture: "SR-090/cycle", git: true },
      input: { source: "SR-b0000000003", kind: "derives-from", target: "SR-b0000000001" },
      expect: "output",
    },
    {
      name: "only relations into the repository given",
      fixture: { fixture: "SR-090/cycle", git: true },
      input: {
        source: "SR-b0000000003",
        kind: "derives-from",
        target: "5e9c0a7d-2b4f-4c61-9d08-0b0000000001",
        repository: "system",
      },
      expect: "output",
    },
    {
      name: "no relation kind",
      fixture: { fixture: "SR-090/cycle", git: true },
      input: { source: "SR-b0000000003", kind: "nope", target: "SR-b0000000001" },
      expect: "error",
    },
  ],
  "reqif.export": [
    {
      tag: "[SR-052/AK1]",
      name: "a package as one ReqIF file, its relations as SPEC-RELATIONs and their targets outside it as stubs",
      fixture: REQIF_EXPORT,
      input: { output: "s6.reqif", selection: { package: "52052052-0000-4000-8000-0000000052f1" } },
      expect: "output",
      masks: EXPORT_MASKS,
    },
    {
      tag: "[SR-058/AK1]",
      name: "the statements of the mapping's source by their source IDENTIFIERs, one without counted",
      fixture: STATEMENTS,
      input: { output: "back.reqif", mapping: "reqif/kunde-a.yaml", statements: true },
      expect: "output",
      masks: EXPORT_MASKS,
    },
    {
      name: "a profile is refused: not available yet",
      fixture: REQIF_EXPORT,
      input: { output: "s6.reqif", profile: "stage-6" },
      expect: "error",
    },
    {
      tag: "[SR-054/AK2]",
      name: "an export to the same source through the saved mapping the command names, without a question on types and attributes",
      fixture: {
        ...FIRST_IMPORT,
        files: {
          ...FIRST_IMPORT.files,
          "reqif/kunde-a.yaml": `${String(DELIVERY.files?.["reqif/kunde-a.yaml"])}omit-properties: [delivery, import-date]\n`,
        },
      },
      input: { output: "kunde-a.reqif", mapping: "reqif/kunde-a.yaml" },
      expect: "output",
      masks: EXPORT_MASKS,
      check: (results) => {
        for (const { files } of Object.values(results)) {
          // The mapping's omitted properties are left out, and the mapping is used as saved.
          expect(files["kunde-a.reqif"]).toContain("Measure the wind");
          expect(files["kunde-a.reqif"]).not.toContain("Lastenheft 2026-11");
          expect(files["reqif/kunde-a.yaml"]).toContain("omit-properties: [delivery, import-date]");
        }
      },
    },
    {
      tag: "[SR-059/AK1]",
      name: "the properties to omit are missing from the file",
      fixture: REQIF_EXPORT,
      input: { output: "s6.reqif", selection: { package: PACKAGE_S6 }, omitProperties: ["rationale"] },
      expect: "output",
      masks: EXPORT_MASKS,
      check: (results) => {
        for (const result of Object.values(results)) {
          expect(result.files["s6.reqif"]).not.toContain("rationale");
        }
      },
    },
    {
      tag: "[SR-059/AK2]",
      name: "a target outside the export is a SPEC-OBJECT with IDENTIFIER and type only",
      fixture: REQIF_EXPORT,
      input: { output: "wind.reqif", selection: { ids: [WIND_S6] } },
      expect: "output",
      masks: EXPORT_MASKS,
      check: (results) => {
        for (const result of Object.values(results)) {
          expect(result.files["wind.reqif"]).toMatch(
            /<SPEC-OBJECT IDENTIFIER="_52052052-0000-4000-8000-0000000052d1" LAST-CHANGE="[^"]*"><TYPE>/,
          );
          expect(result.files["wind.reqif"]).not.toContain("Know the weather");
        }
      },
    },
    {
      tag: "[SR-059/AK3]",
      name: "the properties to omit are saved in the mapping of the target",
      fixture: SUPPLIER,
      input: { output: "s6.reqif", mapping: "reqif/zulieferer.yaml", omitProperties: ["rationale"] },
      expect: "output",
      masks: EXPORT_MASKS,
      check: (results) => {
        for (const result of Object.values(results)) {
          expect(result.files["reqif/zulieferer.yaml"]).toContain("omit-properties");
        }
      },
    },
    {
      tag: "[SR-059/AK3]",
      name: "a later delivery leaves out the properties the mapping saved",
      fixture: {
        ...SUPPLIER,
        files: { "reqif/zulieferer.yaml": `${SUPPLIER_MAPPING}omit-properties: [rationale]\n` },
      },
      input: { output: "s6.reqif", mapping: "reqif/zulieferer.yaml" },
      expect: "output",
      masks: EXPORT_MASKS,
      check: (results) => {
        for (const result of Object.values(results)) {
          expect(result.files["s6.reqif"]).not.toContain("rationale");
        }
      },
    },
  ],
  "reqif.analyze": [
    {
      tag: "[SR-055/AK1]",
      name: "a delivery without mapping: every type and relation type with its attributes is unmapped",
      fixture: DELIVERY,
      input: { file: "in/lieferung.reqif" },
      expect: "output",
    },
    {
      tag: "[SR-055/AK1]",
      name: "a delivery through a mapping that leaves entries unmapped: the list before any write",
      fixture: PARTIAL_DELIVERY,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml" },
      expect: "output",
    },
    {
      name: "a delivery through its saved mapping: the objects the import would create and its losses",
      fixture: DELIVERY,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml" },
      expect: "output",
    },
    {
      name: "a file that is no ReqIF is refused (reqif.invalid)",
      fixture: DELIVERY,
      input: { file: "reqif/kunde-a.yaml" },
      expect: "error",
    },
    {
      tag: "[SR-056/AK1]",
      name: "a repeated delivery: new, changed and dropped requirements and the conflicts, separately",
      fixture: REPEATED,
      input: { file: REPEAT.file, mapping: REPEAT.mapping },
      expect: "output",
      check: (results) => {
        const out = coreOutput(results) as {
          new: unknown;
          changed: unknown;
          dropped: unknown;
          conflicts: unknown;
        };
        expect([out.new, out.changed, out.dropped, out.conflicts]).toEqual([
          [{ identifier: "REQ-5" }],
          [
            { identifier: "REQ-1", id: imported(1) },
            { identifier: "REQ-3", id: imported(3) },
          ],
          [{ identifier: "REQ-4", id: imported(4) }],
          [{ identifier: "REQ-3", id: imported(3) }],
        ]);
      },
    },
  ],
  "reqif.import": [
    {
      tag: "[SR-052/AK3]",
      name: "a file of ReqSeq without a mapping: one to one, its mapping saved",
      fixture: ROUND_TRIP,
      input: { file: "in/all.reqif", delivery: "round trip" },
      expect: "output",
      newElement: true,
    },
    {
      tag: "[SR-053/AK1]",
      name: "a delivery through its saved mapping: new element files in a folder named after the source",
      fixture: DELIVERY,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" },
      expect: "output",
      newElement: true,
    },
    {
      tag: "[SR-056/AK4]",
      name: "a repeated delivery with a conflict and no choice is refused with reqif.conflict naming it",
      fixture: REPEATED,
      input: REPEAT,
      expect: "error",
      check: (results) => {
        const { error } = results["core"]?.outcome as {
          error: { code: string; details?: { conflicts?: unknown } };
        };
        expect([error.code, error.details?.conflicts]).toEqual([
          "reqif.conflict",
          [{ identifier: "REQ-3", id: imported(3) }],
        ]);
      },
    },
    {
      tag: "[SR-055/AK3]",
      name: "a repeated delivery refused for a conflict changes no file",
      fixture: REPEATED,
      input: REPEAT,
      expect: "error",
      check: unchangedRepeat,
    },
    {
      tag: "[SR-056/AK2]",
      name: "a repeated delivery with take updates the elements of the source in place and creates only the new one",
      fixture: REPEATED,
      input: { ...REPEAT, take: ["REQ-3"] },
      expect: "output",
      newElement: true,
      check: (results) => {
        const out = coreOutput(results) as {
          created: { identifier: string }[];
          updated: unknown;
          kept: unknown;
        };
        expect(out.created.map((c) => c.identifier)).toEqual(["REQ-5"]);
        expect(out.updated).toEqual(
          [1, 2, 3].map((n) => ({ identifier: `REQ-${String(n)}`, id: imported(n) })),
        );
        expect(out.kept).toEqual([]);
        for (const result of Object.values(results)) {
          expect(Object.keys(result.files).filter((f) => f.startsWith("Kunde-A/"))).toHaveLength(5);
          expect(result.files["Kunde-A/SR-000000000003.md"]).toContain("for 30 days.");
        }
      },
    },
    {
      tag: "[SR-056/AK3]",
      name: "a repeated delivery lists the dropped requirement and leaves its file as it was",
      fixture: REPEATED,
      input: { ...REPEAT, keep: ["REQ-3"] },
      expect: "output",
      newElement: true,
      check: (results) => {
        const out = coreOutput(results) as { dropped: unknown; kept: unknown };
        expect([out.dropped, out.kept]).toEqual([
          [{ identifier: "REQ-4", id: imported(4) }],
          [{ identifier: "REQ-3", id: imported(3) }],
        ]);
        for (const result of Object.values(results)) {
          // Versions are placeholders here (newElement); the rest of the file is as it was.
          const placeholder = (text: unknown): string =>
            String(text).replace(/n1:[0-9a-f]{16}/g, "<version>");
          expect(result.files["Kunde-A/SR-000000000004.md"]).toBe(
            placeholder(REPEATED.files?.["Kunde-A/SR-000000000004.md"]),
          );
          expect(result.files["Kunde-A/SR-000000000003.md"]).toContain("for a year.");
        }
      },
    },
    {
      tag: "[SR-055/AK3]",
      name: "a file that is no ReqIF is refused (reqif.invalid), changing no file",
      fixture: DELIVERY,
      input: { file: "reqif/kunde-a.yaml", mapping: "reqif/kunde-a.yaml", delivery: "x" },
      expect: "error",
      check: unchangedDelivery(String(DELIVERY.files?.["reqif/kunde-a.yaml"])),
    },
    {
      tag: "[SR-055/AK1]",
      name: "a mapping that leaves entries unmapped is refused with reqif.unmapped and the list of reqif.analyze",
      fixture: PARTIAL_DELIVERY,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
      expect: "error",
      check: (results) => {
        const error = (
          results["core"]?.outcome as { error?: { code: string; details?: { unmapped?: unknown } } }
        ).error;
        expect(error?.code).toBe("reqif.unmapped");
        expect(error?.details?.unmapped).toEqual([
          { kind: "attribute", source: "ReqIF.Text", sourceType: "Customer Requirement" },
          { kind: "attribute", source: "Priority", sourceType: "Customer Requirement" },
          { kind: "attribute", source: "Internal Comment", sourceType: "Customer Requirement" },
          { kind: "type", source: "Heading" },
          { kind: "attribute", source: "Heading Text", sourceType: "Heading" },
          { kind: "relation", source: "satisfies" },
        ]);
      },
    },
    {
      tag: "[SR-055/AK3]",
      name: "a refusal with reqif.unmapped changes no file",
      fixture: PARTIAL_DELIVERY,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
      expect: "error",
      check: unchangedDelivery(PARTIAL_MAPPING),
    },
    {
      tag: "[SR-055/AK2]",
      name: "after every entry is mapped or omitted in the mapping file, the import runs",
      fixture: DELIVERY,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "1" },
      expect: "output",
      newElement: true,
    },
    {
      tag: "[SR-054/AK2]",
      name: "the same source again through the saved mapping the command names, without a question on types and attributes",
      fixture: FIRST_IMPORT,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-12" },
      expect: "output",
      check: (results) => {
        const output = (coreOutput(results) as { updated: readonly { identifier: string }[] }).updated;
        expect(output.map((u) => u.identifier)).toEqual(["REQ-1", "REQ-2"]);
        for (const { files } of Object.values(results)) {
          // The mapping is used as saved, not rewritten.
          expect(files["reqif/kunde-a.yaml"]).toBe(DELIVERY.files?.["reqif/kunde-a.yaml"]);
          // Its attributes: the title from ReqIF.Name, Priority High as requirement-type functional,
          // Internal Comment omitted; its type: Customer Requirement as system-requirement.
          const first = files["Kunde-A/SR-000000000001.md"];
          expect(first).toContain("type: system-requirement");
          expect(first).toContain("title: Measure the wind");
          expect(first).toContain("requirement-type: functional");
          expect(first).toContain("delivery: Lastenheft 2026-12");
          expect(first).not.toContain("check with team");
          expect(Object.keys(files).filter((f) => f.startsWith("Kunde-A/"))).toHaveLength(2);
        }
      },
    },
    {
      tag: "[SR-054/AK3]",
      name: "reading the types and attributes of the source leaves the own metamodel as it was",
      fixture: DELIVERY,
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" },
      expect: "output",
      newElement: true,
      check: (results) => {
        for (const { files } of Object.values(results)) {
          expect(Object.keys(files).filter((f) => f.startsWith("metamodel/"))).toEqual([
            "metamodel/standard-model.yaml",
          ]);
          expect(files["metamodel/standard-model.yaml"]).toBe(STANDARD_MODEL);
        }
      },
    },
    {
      tag: "[SR-054/AK3]",
      name: "a source type the mapping does not name is refused (reqif.unmapped), the own metamodel unchanged",
      fixture: { ...DELIVERY, files: { ...DELIVERY.files, "reqif/kunde-a.yaml": WITHOUT_HEADING } },
      input: { file: "in/lieferung.reqif", mapping: "reqif/kunde-a.yaml", delivery: "Lastenheft 2026-11" },
      expect: "error",
      check: (results) => {
        for (const { outcome, files } of Object.values(results)) {
          expect(JSON.stringify(outcome)).toContain("reqif.unmapped");
          expect(files["metamodel/standard-model.yaml"]).toBe(STANDARD_MODEL);
        }
      },
    },
  ],
  "reqif.saveMapping": [
    {
      tag: "[SR-054/AK1]",
      name: "the mapping of a source as a YAML file in the folder reqif of the main repository",
      input: {
        mapping: {
          "reqseq-reqif-mapping": 1,
          source: { name: "Kunde A" },
          types: [{ source: "Customer Requirement", type: "system-requirement" }],
          attributes: [
            { source: "ReqIF.Name", property: "title" },
            { source: "Priority", property: "requirement-type", values: { High: "functional" } },
          ],
          relations: [{ source: "satisfies", kind: "derives-from" }],
        },
      },
      expect: "output",
    },
    {
      tag: "[SR-054/AK1]",
      name: "a mapping file outside the folder reqif",
      input: {
        file: "requirements/kunde-a.yaml",
        mapping: { "reqseq-reqif-mapping": 1, source: { name: "Kunde A" } },
      },
      expect: "error",
    },
  ],
  "variant.diff": [
    {
      tag: "[SR-044/AK1]",
      name: "A adds A2, replaces K1 by A1 and excludes K2",
      fixture: VARIANT_VIEWS,
      input: { variant: "VAR-0000c1" },
      expect: "output",
      check: (results) => {
        const output = (results["core"]?.outcome as { output: VariantDiffOutput }).output;
        const tail = (id: string): string => id.slice(-2);
        expect([
          output.added.map(tail),
          output.replaced.map((row) => [tail(row.core), tail(row.replacement)]),
          output.excluded.map(tail),
        ]).toEqual([["b2"], [["a1", "b1"]], ["a2"]]);
      },
    },
    {
      tag: "[SR-044/AK3]",
      name: "the replaced row names the IDs of core requirement and replacement",
      fixture: VARIANT_VIEWS,
      input: { variant: "VAR-0000c1" },
      expect: "output",
      check: (results) => {
        const output = (results["core"]?.outcome as { output: { replaced: unknown } }).output;
        expect(output.replaced).toEqual([
          {
            core: "43043043-0000-4000-8000-0000000000a1",
            replacement: "43043043-0000-4000-8000-0000000000b1",
          },
        ]);
      },
    },
    { name: "no variant", fixture: VARIANT_VIEWS, input: { variant: "SR-0000a1" }, expect: "error" },
  ],
  "variant.exclude": [
    {
      tag: "[SR-042/AK1]",
      name: "variant.exclude writes the exclusion of K3 into the file of A",
      fixture: VARIANT_VIEWS,
      input: { variant: "VAR-0000c1", refs: ["SR-0000a3"] },
      expect: "output",
      check: (results) => {
        const output = (results["core"]?.outcome as { output: { files: string[] } }).output;
        expect(output.files).toEqual(["variants/VAR-0000000000c1.md"]);
      },
    },
    {
      tag: "[SR-042/AK6]",
      name: "variant.exclude with undo removes the exclusion of K2 from the file of A",
      fixture: VARIANT_VIEWS,
      input: { variant: "VAR-0000c1", refs: ["SR-0000a2"], undo: true },
      expect: "output",
      check: (results) => {
        const output = (results["core"]?.outcome as { output: { files: string[]; problems: unknown[] } })
          .output;
        expect([output.files, output.problems]).toEqual([["variants/VAR-0000000000c1.md"], []]);
      },
    },
    {
      name: "a requirement with validity is refused (SR-042 AK4)",
      fixture: VARIANT_VIEWS,
      input: { variant: "VAR-0000c1", refs: ["SR-0000b2"] },
      expect: "error",
    },
  ],
  // `path` is a localPath: the CLI makes it absolute from its current folder (the root here), API and MCP
  // take it relative to the root, so all four write into the same folder of their copy.
  "workspace.init": [
    {
      name: "new folder",
      fixture: { files: { "new/.keep": "" } },
      input: { path: "new", name: "New" },
      expect: "output",
    },
    {
      name: "root of call",
      fixture: { files: { ".keep": "" } },
      input: { path: ".", name: "New" },
      expect: "output",
    },
    { name: "existing workspace", input: { path: ".", name: "Again" }, expect: "error" },
  ],
  "workspace.check": [
    {
      name: "a workspace with an evidence location (#535)",
      fixture: EVIDENCE,
      input: {},
      expect: "output",
    },
    {
      name: "duplicate identifiers within a type, with the identifier of each element (#305)",
      fixture: {
        ...IDENTIFIERS,
        files: {
          "requirements/SR-0000000b0038.md":
            "---\nid: 30500000-0000-4000-8000-0000000b0038\ntype: system-requirement\nstatus: draft\ntitle: Twin\nspec-id: SR-036\n---\n",
        },
      },
      input: {},
      expect: "output",
    },
    {
      name: "reqseq: links whose target is no UUID, with the element they name (#176)",
      fixture: {
        fixture: "SR-004/one-repository",
        git: true,
        files: {
          "requirements/SR-0000000b0176.md":
            "---\nid: 17600000-0000-4000-8000-0000000b0176\ntype: system-requirement\nstatus: draft\ntitle: Linking\n---\n\nSee [wind](reqseq:SR-e88fb3) and [gone](reqseq:SR-999999).\n",
        },
      },
      input: {},
      expect: "output",
    },
    {
      name: "one finding of each kind",
      fixture: { fixture: "SR-019/findings", git: true },
      input: {},
      expect: "output",
    },
    {
      name: "errors only",
      fixture: { fixture: "SR-019/findings", git: true },
      input: { severity: "error" },
      expect: "output",
    },
    {
      name: "warnings fail with failOn warning, errors only shown (#304)",
      fixture: { fixture: "SR-085/value-kinds" },
      root: "system",
      input: { severity: "error", failOn: "warning" },
      expect: "output",
    },
    {
      name: "warnings alone are ok by default (#304)",
      fixture: { fixture: "SR-085/value-kinds" },
      root: "system",
      input: {},
      expect: "output",
    },
    {
      name: "info only, a repository missing",
      fixture: MISSING_TARGETS,
      root: "system",
      input: {},
      expect: "output",
    },
    {
      name: "info fails with failOn info (#304)",
      fixture: MISSING_TARGETS,
      root: "system",
      input: { failOn: "info", severity: "warning" },
      expect: "output",
    },
    { name: "unknown failOn (#304)", input: { failOn: "hint" }, expect: "error" },
    {
      name: "restricted to changed files (SR-092)",
      fixture: { fixture: "SR-019/findings", git: true },
      input: { changedFiles: ["requirements/SR-b00000000002.md", "needs/N-a00000000002.md"] },
      expect: "output",
    },
    {
      name: "restricted to changes since the commit before (SR-092)",
      fixture: SECOND_COMMIT,
      input: { changedSince: "HEAD~1" },
      expect: "output",
    },
    {
      name: "a commit that is not here (SR-092 AK2)",
      input: { changedSince: "0123456789abcdef0123456789abcdef01234567" },
      expect: "error",
    },
  ],
  // The list belongs to the user (`<OS cache>/reqseq/recent-workspaces.json`), not to the workspace: the
  // app records it, every access reads the same list (SR-131, SR-080 AK4).
  "workspace.recent": [
    {
      name: "the recent workspaces, the last opened first, one gone and one without a workspace file",
      tag: "[SR-131/AK1]",
      input: {},
      expect: "output",
      prepare: async ({ top, root }) => {
        const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 10, minute));
        // A folder that held a workspace and is gone, and one inside the workspace without its own file.
        await rememberWorkspace(path.join(top, "gone"), { now: at(1) });
        await rememberWorkspace(path.join(root, "requirements"), { now: at(2) });
        await rememberWorkspace(root, { now: at(3) });
      },
    },
  ],
  "workspace.status": [
    { name: "one repository", input: {}, expect: "output" },
    {
      name: "three repositories, one missing",
      fixture: { fixture: "SR-004/three-repositories", git: ["system", "product"], files: {} },
      root: "system",
      input: {},
      expect: "output",
    },
    {
      name: "metamodel missing (read-only)",
      fixture: {
        files: {
          "reqseq-workspace.yaml":
            "reqseq-workspace: 1\nname: No model\nrepositories:\n" +
            '  - { name: main, url: "git@example.com:main.git", main: true }\n' +
            "metamodel: { repository: main, path: model }\n",
        },
        git: true,
      },
      input: {},
      expect: "output",
    },
    { name: "unknown input field", input: { extra: 1 }, expect: "error" },
  ],
  "metamodel.get": [
    {
      name: "the metamodel with the properties marked as Markdown (SR-127 AK5)",
      fixture: IN_CRITERIA,
      input: {},
      expect: "output",
    },
    // SR-130 AK6: the app's graph and text of the metamodel show this output alone.
    {
      name: "types with inheritance, per-type statuses and open relation kinds (SR-130)",
      fixture: METAMODEL,
      input: {},
      tag: "[SR-130/AK6]",
      expect: "output",
      check: (results) => {
        for (const [access, { outcome }] of Object.entries(results)) {
          const output = (outcome as { output: MetamodelOutput }).output;
          const type = (key: string) => output.types.find((candidate) => candidate.key === key);
          const kind = (key: string) => output.relations.find((candidate) => candidate.key === key);
          expect(
            output.types.map((candidate) => candidate.key),
            access,
          ).toEqual(["item", "requirement", "software-requirement", "decision", "package"]);
          expect(type("software-requirement")?.ancestors, access).toEqual(["requirement", "item"]);
          expect(type("software-requirement")?.properties, access).toEqual([
            "title",
            "rationale",
            "packages",
            "component",
          ]);
          expect(type("package")?.statuses, access).toEqual([]);
          expect(kind("based-on"), access).not.toHaveProperty("source-types");
          expect(kind("blocks")?.["source-types"], access).toEqual([]);
        }
      },
    },
    {
      name: "the standard model (SR-130)",
      fixture: CHAIN,
      input: {},
      tag: "[SR-130/AK6]",
      expect: "output",
    },
    {
      name: "a faulty metamodel file: the types of the valid files and the problem (SR-130)",
      fixture: {
        ...METAMODEL,
        files: { "model/broken.yaml": "reqseq-metamodel: 1\ntypes:\n  - { key: broken, name: Broken }\n" },
      },
      input: {},
      tag: "[SR-130/AK6]",
      expect: "output",
      check: (results) => {
        for (const [access, { outcome }] of Object.entries(results)) {
          const output = (outcome as { output: MetamodelOutput }).output;
          expect(output.types, access).toHaveLength(5);
          expect(output.problems, access).toMatchObject([
            { code: "metamodel.invalid", severity: "error", file: "model/broken.yaml" },
          ]);
        }
      },
    },
  ],
};

type Outcome = { readonly output: unknown } | { readonly error: unknown };

const errorOf = (error: unknown): unknown => (error instanceof CommandError ? error.toJSON() : error);

/**
 * #277: the pieces the CLI (`--json`, `--yaml`) and the API stream join to the whole text, on every
 * output of the suite: `jsonChunks` to `JSON.stringify` (small chunk lengths, so the walk descends),
 * `yamlPieces` to `stringify` with the same options.
 */
const expectWholeText = (name: string, output: unknown): void => {
  const value = output ?? null;
  for (const [indent, chunkLength] of [
    [0, 64],
    [2, 64],
    [2, 4096],
  ] as const) {
    const whole = indent === 0 ? JSON.stringify(value) : JSON.stringify(value, null, 2);
    expect([name, indent, chunkLength, [...jsonChunks(value, { indent, chunkLength })].join("")]).toEqual([
      name,
      indent,
      chunkLength,
      whole,
    ]);
  }
  expect([name, [...yamlPieces(output)].join("")]).toEqual([name, stringify(output, YAML_OPTIONS)]);
};

const viaCore = async (root: string, entry: CatalogEntry, input: object): Promise<Outcome> => {
  const workspace = new Workspace(root);
  try {
    const output = await runtime.invoke(entry.name, input, { workspace });
    expectWholeText(entry.name, output);
    return { output };
  } catch (error) {
    return { error: errorOf(error) };
  } finally {
    await workspace.close();
  }
};

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

const viaCli = async (
  root: string,
  entry: CatalogEntry,
  input: Record<string, unknown>,
): Promise<Outcome> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const argv = [...argvFor(entry, input, runtime.contracts.schemas), "--json", "--workspace", root];
  const code = await runCli({ argv, cwd: root, stdin: Readable.from([]), stdout, stderr, runtime });
  return code === EXIT.ok || code === EXIT.findings
    ? { output: JSON.parse(stdout.text) as unknown }
    : { error: JSON.parse(stderr.text) as unknown };
};

const viaApi = async (root: string, entry: CatalogEntry, input: object, cache: string): Promise<Outcome> => {
  const workspace = new Workspace(root);
  const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
  try {
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    const reply = await new Promise<{ status: number | undefined; body: unknown }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          method: "POST",
          path: `/v1/commands/${entry.name}`,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          });
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(input));
    });
    return reply.status === 200 ? { output: reply.body } : { error: reply.body };
  } finally {
    await server.close();
    await workspace.close();
  }
};

const viaMcp = async (
  root: string,
  entry: CatalogEntry,
  input: Record<string, unknown>,
): Promise<Outcome> => {
  const workspace = new Workspace(root);
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime,
    workspace,
    input: toServer,
    output: { write: (t) => toClient.write(t) },
  });
  const client = new Client({ name: "cross-access", version: "1" });
  try {
    await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
    const result = await client.callTool({ name: toolName(entry.name), arguments: input });
    if (result.isError !== true) {
      return { output: result.structuredContent };
    }
    // A tool error carries the error object as JSON text only (no structuredContent).
    const [content] = result.content as { type: string; text: string }[];
    return { error: JSON.parse(content?.text ?? "") as unknown };
  } finally {
    toServer.end();
    await served;
    await client.close();
    await workspace.close();
  }
};

/** The core side of the app's IPC on one end of a Node MessageChannel (Electron's port in the app). */
const nodeChannel = (port: MessagePort): Channel => ({
  post: (message) => {
    port.postMessage(message);
  },
  onMessage: (listener) => {
    port.on("message", listener);
  },
  onClose: (listener) => {
    port.on("close", listener);
  },
  close: () => {
    port.close();
  },
});

/**
 * The app on `workspace` without Electron: its preload bridge, connected to the core side of its IPC as
 * the main process connects them (a port per window). `close` closes the ports and the workspace.
 */
const connectApp = (
  workspace: Workspace,
): { bridge: ReturnType<typeof createBridge>; close: () => Promise<void> } => {
  const host = createCoreHost({ runtime, workspace });
  const { port1, port2 } = new MessageChannel();
  host.connect(nodeChannel(port1));
  let deliver: Parameters<IpcRendererLike["on"]>[1] | undefined;
  const bridge = createBridge({
    // The workspace of the window, and main's requests to save before a switch (SR-131), which no
    // command sends.
    on: (channel, listener) => {
      expect([WORKSPACE_CHANNEL, SAVE_CHANNEL]).toContain(channel);
      if (channel === WORKSPACE_CHANNEL) {
        deliver = listener;
      }
    },
    invoke: () => Promise.resolve(false),
    send: () => undefined,
  });
  deliver?.({ ports: [port2] }, { open: true });
  return { bridge, close: () => host.close() };
};

const viaApp = async (root: string, entry: CatalogEntry, input: object): Promise<Outcome> => {
  const app = connectApp(new Workspace(root));
  try {
    const result = await app.bridge.invoke(entry.name, input);
    return result.ok ? { output: result.output } : { error: result.error };
  } finally {
    await app.close();
  }
};

/** Absolute paths in the copy of the fixture as `<copy>/...`, so results of separate copies compare equal. */
const normalized = (value: unknown, top: string): unknown => {
  const text = JSON.stringify(value);
  const escaped = JSON.stringify(top).slice(1, -1);
  return JSON.parse(text.split(escaped).join("<copy>")) as unknown;
};

/**
 * What an access left on disk: every file of a copy except Git's own, as a path relative to the copy (with
 * `/`) and its text. Compared between the accesses, so a write must change the same files in the same way.
 */
const filesOf = async (top: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(top, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(top, path.join(e.parentPath, e.name)))
    .filter((relative) => !relative.split(path.sep).includes(".git"))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (relative) => [
        relative.split(path.sep).join("/"),
        await fs.readFile(path.join(top, relative), "utf8"),
      ]),
    ),
  ) as Record<string, string>;
};

/**
 * Every fixture a scenario uses, each once: building one spawns `git` several times, and many scenarios
 * share a fixture (a list with repeats built over a hundred, which ran past the hook timeout on Windows, #304).
 */
const FIXTURES: readonly FixtureOptions[] = [
  ...new Set([
    ONE_REPOSITORY,
    ...Object.values(SCENARIOS).flatMap((list) =>
      list.flatMap((s) => (s.fixture === undefined ? [] : [s.fixture])),
    ),
  ]),
];
const templates = new Map<FixtureOptions, FixtureWorkspace>();
const copies: string[] = [];
let cache: string;

// Building the templates spawns `git` three times per repository. On Windows runners that can take seconds.
// The OS cache folder (the model cache of every CLI command, SR-082) lies in a temporary folder on every OS.
let cacheHome = "";
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(cacheHome, { recursive: true, force: true });
});

/**
 * Templates built at the same time. Each one waits mostly for `git` to start; one after the other, the 70 of
 * them took over 120 s on a loaded windows-2025 runner (#423).
 */
const BUILD_CONCURRENCY = 8;

beforeAll(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cross-access-"));
  const queue = FIXTURES.values();
  const worker = async (): Promise<void> => {
    for (const options of queue) {
      const template = await createFixtureWorkspace(options);
      templates.set(options, template);
      await TEMPLATE_SETUP.get(options)?.(template);
    }
  };
  await Promise.all(Array.from({ length: BUILD_CONCURRENCY }, worker));
}, 120_000);

// Removes the templates and one copy per scenario (over 250 Git work trees): on Windows that takes longer
// than the default hook timeout of 30 s (#304).
afterAll(async () => {
  await Promise.all([...templates.values()].map((f) => f.cleanup()));
  templates.clear();
  await Promise.all(
    [cache, ...copies.splice(0)].map((folder) =>
      fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }),
    ),
  );
}, 120_000);

/** A copy of a fixture: its top folder, and the workspace root in it. */
interface Copy {
  readonly top: string;
  readonly root: string;
}

/**
 * A fresh copy of the scenario's fixture, Git repositories included. Copying the files is much cheaper
 * than building the fixture again with `git`. The copy has the same commits, so every access starts from
 * the same state.
 */
const copy = async (scenario: Scenario): Promise<Copy> => {
  const template = templates.get(scenario.fixture ?? ONE_REPOSITORY);
  if (template === undefined) {
    throw new Error(`No template for scenario ${scenario.name}`);
  }
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cross-access-copy-")));
  copies.push(base);
  const top = path.join(base, "workspace");
  // The templates have no sample hooks: the testkit runs `git init` without its template folder.
  await fs.cp(template.root, top, { recursive: true });
  return { top, root: scenario.root === undefined ? top : path.join(top, ...scenario.root.split("/")) };
};

/**
 * A test runs one command through all four accesses. A write command gets four copies. Each access may
 * read Git through a child process. On Linux and macOS a test takes well under a second. Process starts on
 * Windows runners vary from 0.1 s to more than 1 s, so the default limit of 5 s is too tight there. This
 * limit only catches a hang.
 */
const TEST_TIMEOUT = 30_000;

const ACCESSES = ["core", "cli", "api", "mcp", "app"] as const;

/**
 * Commands whose output has the time of the call at the top (`generated`, data-export.schema.json): it is
 * checked to lie within the call of each access and then replaced by `<generated>`, every other field compared.
 */
const GENERATED_AT_TOP: ReadonlySet<string> = new Set(["data.export"]);

/** `outcome` with its top-level `generated` replaced, after checking it lies between `start` and `end` (ms). */
const withoutGenerated = (access: string, outcome: Outcome, start: number, end: number): Outcome => {
  if (!("output" in outcome)) {
    return outcome;
  }
  const { generated, ...rest } = outcome.output as { generated?: unknown };
  expect([access, generated]).toEqual([access, expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)]);
  const time = Date.parse(String(generated));
  expect([access, time >= Math.floor(start / 1000) * 1000 && time <= end]).toEqual([access, true]);
  return { output: { ...rest, generated: "<generated>" } };
};

/**
 * `result` of baseline.create with the date of the baseline (output and file) replaced by `<date>`, after
 * checking it lies between `start` and `end` (ms); an error is left as it is.
 */
const withoutDate = (access: string, result: Result, start: number, end: number): Result => {
  const date = (result.outcome as { output?: { baseline?: { date?: string } } }).output?.baseline?.date;
  if (date === undefined) {
    return result;
  }
  const time = Date.parse(date);
  expect([access, time >= Math.floor(start / 1000) * 1000 && time <= end]).toEqual([access, true]);
  return JSON.parse(JSON.stringify(result).split(date).join("<date>")) as Result;
};

/** A fresh copy of the scenario's fixture, prepared. */
const preparedCopy = async (scenario: Scenario): Promise<Copy> => {
  const made = await copy(scenario);
  await scenario.prepare?.(made);
  return made;
};

/** The result of one access: its outcome, and the files of its copy afterwards. */
interface Result {
  readonly outcome: Outcome;
  readonly files: Record<string, string>;
}

/**
 * Run a scenario through all five accesses. A write command gets a fresh copy per access, so each one starts
 * from the same files. A read command, and a command without an implementation (it cannot write), share one
 * copy. Either way, the files of the copy are compared after each access.
 */
const runAll = async (entry: CatalogEntry, scenario: Scenario): Promise<Record<string, Result>> => {
  const unchanging = entry.effect === "read" || !runtime.commands.has(entry.name);
  const shared = unchanging ? await preparedCopy(scenario) : undefined;
  // The files of the prepared template: a read changes none of them, not even the same way on every access.
  const untouched = shared === undefined ? undefined : normalized(await filesOf(shared.top), shared.top);
  const results: Record<string, Result> = {};
  for (const access of ACCESSES) {
    const { top, root } = shared ?? (await copy(scenario));
    await scenario.prepare?.({ top, root });
    const input = { ...scenario.input };
    const start = Date.now();
    const called =
      access === "core"
        ? await viaCore(root, entry, input)
        : access === "cli"
          ? await viaCli(root, entry, input)
          : access === "api"
            ? await viaApi(root, entry, input, cache)
            : access === "mcp"
              ? await viaMcp(root, entry, input)
              : await viaApp(root, entry, input);
    const end = Date.now();
    const outcome = GENERATED_AT_TOP.has(entry.name) ? withoutGenerated(access, called, start, end) : called;
    // A data file of data.store holds no time of the call (#319): its bytes are compared as they are.
    const files = await filesOf(top);
    const result = withoutDate(access, normalized({ outcome, files }, top) as Result, start, end);
    if (untouched !== undefined) {
      expect([access, result.files]).toEqual([access, untouched]);
    }
    const masked = masks(result, scenario.masks ?? []);
    results[access] = scenario.newElement === true ? maskNewElement(masked) : masked;
  }
  return results;
};

/** `result` with each match of `patterns` replaced by `<masked>` (see `Scenario.masks`). */
const masks = (result: Result, patterns: readonly RegExp[]): Result =>
  patterns.length === 0
    ? result
    : (JSON.parse(
        patterns.reduce((text, pattern) => text.replace(pattern, "<masked>"), JSON.stringify(result)),
      ) as Result);

/** The id of the new element in `result` replaced everywhere by placeholders (see `Scenario.newElement`). */
const maskNewElement = (result: Result): Result => {
  const output = (
    result.outcome as {
      output?: { element?: { id?: string; version?: string }; created?: readonly { id?: string }[] };
    }
  ).output;
  if (output?.created !== undefined) {
    let text = JSON.stringify(result);
    for (const [index, { id = "" }] of output.created.entries()) {
      const tail = id.replaceAll("-", "");
      text = text
        .split(id)
        .join(`<id${String(index)}>`)
        .split(tail.slice(-12))
        .join(`<tail12-${String(index)}>`)
        .split(tail.slice(-6))
        .join(`<tail6-${String(index)}>`);
    }
    return JSON.parse(text.replace(/n1:[0-9a-f]{16}/g, "<version>")) as Result;
  }
  const element = output?.element;
  if (element?.id === undefined || element.version === undefined) {
    return result;
  }
  const digits = element.id.replaceAll("-", "");
  return JSON.parse(
    JSON.stringify(result)
      .split(element.id)
      .join("<id>")
      .split(element.version)
      .join("<version>")
      .split(digits.slice(-12))
      .join("<tail12>")
      .split(digits.slice(-6))
      .join("<tail6>"),
  ) as Result;
};

const DEFAULT: Scenario = { name: "default input {}", input: {}, expect: "output" };

describe(
  "cross-access: same result through core, CLI, API, MCP and the app",
  { timeout: TEST_TIMEOUT },
  () => {
    for (const entry of runtime.contracts.commands) {
      const explicit = SCENARIOS[entry.name as CommandName] ?? [];
      for (const scenario of [DEFAULT, ...explicit]) {
        it(`${scenario.tag ?? "[SR-080/AK2]"} ${entry.name}, ${scenario.name}`, async () => {
          const results = await runAll(entry, scenario);
          const core = results["core"];
          if (scenario !== DEFAULT) {
            expect(Object.keys(core?.outcome ?? {})).toEqual([scenario.expect]);
          }
          expect(Object.keys(core?.files ?? {}).length).toBeGreaterThan(0);
          expect(results).toEqual({ core, cli: core, api: core, mcp: core, app: core });
          scenario.check?.(results);
        });
      }
    }

    it("has scenarios only for catalog commands", () => {
      const names = new Set(runtime.contracts.commands.map((e) => e.name));
      expect(Object.keys(SCENARIOS).filter((name) => !names.has(name))).toEqual([]);
    });
  },
);

describe("every catalog command on every access", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-080/AK1] is a CLI subcommand, an API route, once implemented an MCP tool, and listed by the app", async () => {
    const { root } = await copy(DEFAULT);
    const names = runtime.contracts.commands.map((e) => e.name);
    for (const entry of runtime.contracts.commands) {
      const [group = "", action = ""] = argvFor(entry, {});
      const stdout = new Sink();
      const code = await runCli({
        argv: [group, action, "--help"],
        cwd: root,
        stdin: Readable.from([]),
        stdout,
        stderr: new Sink(),
        runtime,
      });
      expect([entry.name, code, stdout.text]).toEqual([
        entry.name,
        EXIT.ok,
        expect.stringContaining(`Usage: reqseq ${group} ${action} `),
      ]);
    }
    const workspace = new Workspace(root);
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const served = serveMcp({
      runtime,
      workspace,
      input: toServer,
      output: { write: (t) => toClient.write(t) },
    });
    const client = new Client({ name: "cross-access", version: "1" });
    await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
    // MCP lists only the implemented commands (#303): an agent puts the whole list into its context. A call to
    // one that is not listed still gives command.not-implemented, as every access (the scenarios above).
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(names.filter((n) => runtime.commands.has(n)).map(toolName));
    toServer.end();
    await served;
    await client.close();
    const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    const listed = await new Promise<unknown>((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: server.port,
            path: "/v1/commands",
            headers: { authorization: `Bearer ${token}` },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            });
          },
        )
        .on("error", reject);
    });
    expect((listed as { commands: { name: string }[] }).commands.map((c) => c.name)).toEqual(names);
    await server.close();
    // The app's bridge lists the catalog for the command palette (SR-073 AK2), as the API does.
    const app = connectApp(workspace);
    expect((await app.bridge.commands()).map((c) => c.name)).toEqual(names);
    await app.close();
  });
});

/** The text of a POST to the API of `root` with an `Accept` header, and its content type. */
const apiText = async (
  root: string,
  name: string,
  input: object,
  accept: string,
): Promise<{ readonly type: string | undefined; readonly text: string }> => {
  const workspace = new Workspace(root);
  const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
  try {
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          method: "POST",
          path: `/v1/commands/${name}`,
          headers: { authorization: `Bearer ${token}`, accept },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({ type: res.headers["content-type"], text: Buffer.concat(chunks).toString("utf8") });
          });
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(input));
    });
  } finally {
    await server.close();
    await workspace.close();
  }
};

describe("cross-access: JSON Lines (#319)", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-061/AK4] the CLI with --jsonl and the API with application/x-ndjson give the same lines, those of the core output", async () => {
    const lined = runtime.contracts.commands.filter((e) => e.jsonLines !== undefined);
    expect(lined.map((e) => e.name)).toEqual(["data.export"]);
    for (const entry of lined) {
      const spec = entry.jsonLines;
      if (spec === undefined) {
        continue;
      }
      for (const input of [{}, { selection: { package: "PKG-0000d1" } }]) {
        const { root } = await copy({
          name: "lines",
          fixture: EXPORT,
          root: "system",
          input,
          expect: "output",
        });
        const core = await viaCore(root, entry, input);
        const expected = [...jsonLines((core as { output: unknown }).output, spec)].join("");
        const items = ((core as { output: Record<string, unknown[]> }).output[spec.items] ?? []).length;
        expect([input, expected.split("\n").length - 1]).toEqual([input, items]);
        const stdout = new Sink();
        const stderr = new Sink();
        const argv = [...argvFor(entry, input, runtime.contracts.schemas), "--jsonl", "--workspace", root];
        const code = await runCli({ argv, cwd: root, stdin: Readable.from([]), stdout, stderr, runtime });
        expect([input, code, stderr.text, stdout.text]).toEqual([input, EXIT.ok, "", expected]);
        const api = await apiText(root, entry.name, input, "application/x-ndjson");
        expect([input, api]).toEqual([
          input,
          { type: "application/x-ndjson; charset=utf-8", text: expected },
        ]);
      }
    }
  });
});
