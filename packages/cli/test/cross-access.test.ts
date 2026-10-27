// Cross-access test (ADR-0002 rule 8, ADR-0011, SR-080): every catalog command runs through core `invoke`,
// the CLI, the local API, the MCP server and the app on the same fixture workspace, and all five give the
// same result: the same output or the same error object, and the same files on disk afterwards. The app is
// its preload bridge and the core side of its IPC over a MessageChannel, the path every call of the
// renderer takes (ADR-0010); the Electron tests (packages/app/test) run it in the app itself. New catalog
// commands join automatically with a default scenario (input `{}`); add explicit scenarios below when a
// command is implemented.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { startApiServer } from "@logreq/api";
import type { Channel, IpcRendererLike } from "@logreq/app";
import { SAVE_CHANNEL, WORKSPACE_CHANNEL, createBridge, createCoreHost } from "@logreq/app";
import type { CatalogEntry, CommandName } from "@logreq/core";
import { CommandError, Workspace, createCommandRuntime, rememberWorkspace } from "@logreq/core";
import { LineTransport, serveMcp, toolName } from "@logreq/mcp";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT, argvFor, runCli } from "../src/index.js";

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
   */
  readonly newElement?: boolean;
  /**
   * Prepares state outside the copy before each access, with the same result every time (the list of
   * recent workspaces in the OS cache folder, SR-131).
   */
  readonly prepare?: (copy: Copy) => Promise<void>;
}

const ONE_REPOSITORY: FixtureOptions = { fixture: "SR-004/one-repository", git: true };
/** Needs, requirements, a decision and a package that point at each other (SR-024). */
const AFFECTED: FixtureOptions = { fixture: "SR-024/affected", git: true };
/** Needs, system and component requirements and a variant (SR-022). */
const CHAIN: FixtureOptions = { fixture: "SR-022/chain", git: true };
/** Needs, requirements, variants and packages to filter (SR-069). */
const FILTER: FixtureOptions = { fixture: "SR-069/filter", git: true };
/** SR-069/filter with saved filters, one written by hand with short IDs and comments, one faulty (SR-070). */
const SAVED: FixtureOptions = {
  fixture: "SR-069/filter",
  files: {
    "filters/sensor-drafts.yaml":
      "# Drafts of the sensor package\nlogreq-filter: 1\nname: Sensor drafts\nwhere:\n  all:\n" +
      "    - { package: PKG-0000d1 }   # Sensors\n    - { status: [draft] }\nsort: [{ by: title, order: desc }]\n",
    "filters/mountain.yaml":
      "logreq-filter: 1\nname: Mountain\nview: VAR-0000c2\nwhere: { type: [system-requirement] }\n",
    "filters/broken.yaml": "logreq-filter: 1\nname: Broken\nwhere: { nope: 1 }\n",
  },
  git: true,
};
/** Derivations with a diamond, choices, numbers and titles to sort by (SR-075). */
const SORT: FixtureOptions = { fixture: "SR-075/sort", git: true };
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
      "then [the need](logreq:26a0b000-0000-4000-8000-0000000000a1?version=n1:0000000000000000) shows it.",
    ),
    "requirements/SR-0000000000b8.md":
      "---\nid: 26a0b000-0000-4000-8000-0000000000b8\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nrequirement-type: functional\n" +
      "acceptance-criteria:\n  - Given a gust, then [the other need](logreq:26a0b000-0000-4000-8000-0000000000a2?version=n1:1111111111111111) is shown.\n---\n\nGusts.\n",
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
  "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
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

/** Needs, requirements and a use case with validation and verification records (SR-038). */
const VALIDATION: FixtureOptions = { fixture: "SR-038/validation", git: true };

/** Requirements marked emergent, with and without own records, and their children (SR-035). */
const EMERGENT: FixtureOptions = { fixture: "SR-035/emergent", git: true };

/** SR-004/one-repository with an image to attach, whose name LogReq makes portable (SR-097). */
const WITH_IMAGE: FixtureOptions = {
  fixture: "SR-004/one-repository",
  files: { "incoming/Wind Läyout (v2).png": "an image", "incoming/notes.txt": "no image" },
  git: true,
};

/** Needs, requirements and a subtype in two repositories, an obsolete child, a saved filter (SR-036). */
const COVERAGE: FixtureOptions = { fixture: "SR-036/levels", git: ["system", "sensor"] };

/** Two repositories with Markdown and JUnit records, variants, a package, a saved filter and baselines (SR-061). */
const EXPORT: FixtureOptions = { fixture: "SR-061/export", git: ["system", "sensor"] };

/** Explicit scenarios per command, in addition to the default one with input `{}`. */
const SCENARIOS: Partial<Record<CommandName, readonly Scenario[]>> = {
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
    {
      name: "the condition emergent (SR-035)",
      fixture: EMERGENT,
      input: { selection: { where: { all: [{ emergent: true }, { verification: ["open"] }] } } },
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
      name: "several replacement kinds fit (relation-ambiguous)",
      fixture: { fixture: "SR-072/supersede", git: true },
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
            "logreq-baseline: 1\nname: Release 1.0\ndate: 2026-10-24T09:30:00Z\nrepositories:\n" +
            "  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }\nelements:\n" +
            "  - { id: e8df96ea-a168-4d90-8d65-6328cee88fb3, version: n1:2eb0feee31fc1d89 }\n",
          "baselines/broken.yaml": "logreq-baseline: 1\nname: Broken\n",
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
  ],
  "evidence.status": [
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
          "logreq-workspace.yaml": WITH_VAULT,
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
          "logreq-workspace.yaml": WITH_VAULT,
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
          "logreq-workspace.yaml":
            "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
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
  // The list belongs to the user (`<OS cache>/logreq/recent-workspaces.json`), not to the workspace: the
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
          "logreq-workspace.yaml":
            "logreq-workspace: 1\nname: No model\nrepositories:\n" +
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
  ],
};

type Outcome = { readonly output: unknown } | { readonly error: unknown };

const errorOf = (error: unknown): unknown => (error instanceof CommandError ? error.toJSON() : error);

const viaCore = async (root: string, entry: CatalogEntry, input: object): Promise<Outcome> => {
  const workspace = new Workspace(root);
  try {
    return { output: await runtime.invoke(entry.name, input, { workspace }) };
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

/** Every fixture a scenario uses. Each is built once, because building one spawns `git` several times. */
const FIXTURES: readonly FixtureOptions[] = [
  ONE_REPOSITORY,
  ...Object.values(SCENARIOS).flatMap((list) =>
    list.flatMap((s) => (s.fixture === undefined ? [] : [s.fixture])),
  ),
];
const templates = new Map<FixtureOptions, FixtureWorkspace>();
const copies: string[] = [];
let cache: string;

// Building the templates spawns `git` four times per repository. On Windows runners that can take seconds.
// The OS cache folder (the model cache of every CLI command, SR-082) lies in a temporary folder on every OS.
let cacheHome = "";
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(cacheHome, { recursive: true, force: true });
});

beforeAll(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cross-access-"));
  for (const options of FIXTURES) {
    const template = await createFixtureWorkspace(options);
    await TEMPLATE_SETUP.get(options)?.(template);
    templates.set(options, template);
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([...templates.values()].map((f) => f.cleanup()));
  templates.clear();
  await Promise.all(
    [cache, ...copies.splice(0)].map((folder) =>
      fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }),
    ),
  );
});

/** The sample hooks of `git init`: half the files of a fixture, and no Git command of LogReq runs hooks. */
const isSampleHooks = (source: string): boolean =>
  path.basename(source) === "hooks" && path.basename(path.dirname(source)) === ".git";

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
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cross-access-copy-")));
  copies.push(base);
  const top = path.join(base, "workspace");
  await fs.cp(template.root, top, { recursive: true, filter: (source) => !isSampleHooks(source) });
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
const GENERATED_AT_TOP: ReadonlySet<string> = new Set(["data.export", "data.store"]);

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
  const shared = unchanging ? await copy(scenario) : undefined;
  // The files of the untouched template: a read changes none of them, not even the same way on every access.
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
    const outcome = GENERATED_AT_TOP.has(entry.name)
      ? withoutGenerated(access, called, start, Date.now())
      : called;
    const result = normalized({ outcome, files: await filesOf(top) }, top) as Result;
    if (untouched !== undefined) {
      expect([access, result.files]).toEqual([access, untouched]);
    }
    results[access] = scenario.newElement === true ? maskNewElement(result) : result;
  }
  return results;
};

/** The id of the new element in `result` replaced everywhere by placeholders (see `Scenario.newElement`). */
const maskNewElement = (result: Result): Result => {
  const element = (result.outcome as { output?: { element?: { id?: string; version?: string } } }).output
    ?.element;
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
        expect.stringContaining(`Usage: logreq ${group} ${action} `),
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
