// Cross-access test (ADR-0002 rule 8, ADR-0011, SR-080): every catalog command runs through core `invoke`,
// the CLI, the local API, the MCP server and the app on the same fixture workspace, and all five give the
// same result: the same output or the same error object, and the same files on disk afterwards. The app is
// its preload bridge and the core side of its IPC over a MessageChannel, the path every call of the
// renderer takes (ADR-0010); the Electron tests (packages/app/test) run it in the app itself. New catalog
// commands join automatically with a default scenario (input `{}`); add explicit scenarios below when a
// command is implemented.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { startApiServer } from "@logreq/api";
import type { Channel, IpcRendererLike } from "@logreq/app";
import { WORKSPACE_CHANNEL, createBridge, createCoreHost } from "@logreq/app";
import type { CatalogEntry, CommandName } from "@logreq/core";
import { CommandError, Workspace, createCommandRuntime } from "@logreq/core";
import { LineTransport, serveMcp, toolName } from "@logreq/mcp";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT, argvFor, runCli } from "../src/index.js";

/** The product catalog and implementations; outputs are checked against the catalog (vitest.config.ts). */
const runtime = createCommandRuntime();

interface Scenario {
  readonly name: string;
  /** The fixture workspace; default: SR-004/one-repository as one Git repository. */
  readonly fixture?: FixtureOptions;
  /** Folder of the workspace inside the fixture; default its root. */
  readonly root?: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** What core gives; guards against a scenario that only ever compares the same error. */
  readonly expect: "output" | "error";
  /**
   * The output names a new element with a random UUID: its UUID, the 12 and 6 digit tails (file name,
   * short ID) and its version are replaced by placeholders in the outcome and the files before comparing.
   */
  readonly newElement?: boolean;
}

const ONE_REPOSITORY: FixtureOptions = { fixture: "SR-004/one-repository", git: true };
/** Needs, requirements, a decision and a package that point at each other (SR-024). */
const AFFECTED: FixtureOptions = { fixture: "SR-024/affected", git: true };
/** Needs, system and component requirements and a variant (SR-022). */
const CHAIN: FixtureOptions = { fixture: "SR-022/chain", git: true };
/** Needs, requirements, variants and packages to filter (SR-069). */
const FILTER: FixtureOptions = { fixture: "SR-069/filter", git: true };
/** Derivations with a diamond, choices, numbers and titles to sort by (SR-075). */
const SORT: FixtureOptions = { fixture: "SR-075/sort", git: true };
/** Needs, requirements and their derivations (SR-023), shared so the fixture is built once. */
const RELATED: FixtureOptions = { fixture: "SR-023/related", git: true };
/** Open hints of every kind of stage 2, among them outdated relations (SR-026). */
const HINTS: FixtureOptions = { fixture: "SR-026/hints", git: true };
/** Where SR-0000b1 of HINTS stores its outdated relation and reference, as hint IDs name it (SR-025). */
const HINT_AT_B1 = `relation.outdated/system/${encodeURIComponent("requirements/SR-0000000000b1.md")}/26a0b000-0000-4000-8000-0000000000b1`;

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

/** SR-004/one-repository with an image to attach, whose name LogReq makes portable (SR-097). */
const WITH_IMAGE: FixtureOptions = {
  fixture: "SR-004/one-repository",
  files: { "incoming/Wind Läyout (v2).png": "an image", "incoming/notes.txt": "no image" },
  git: true,
};

/** Explicit scenarios per command, in addition to the default one with input `{}`. */
const SCENARIOS: Partial<Record<CommandName, readonly Scenario[]>> = {
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
      name: "the condition text before the full-text search (SR-068)",
      fixture: FILTER,
      input: { selection: { where: { text: "wind" } } },
      expect: "error",
    },
    {
      name: "a regular expression that is none",
      fixture: FILTER,
      input: { selection: { where: { property: "title", op: "matches", value: "(" } } },
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
      name: "change the text of an element two others point at: affected 2 (SR-024 AK2)",
      fixture: AFFECTED,
      input: { ref: "SR-00b001", text: "Changed.\n" },
      expect: "output",
    },
  ],
  "hint.list": [
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
    on: (channel, listener) => {
      expect(channel).toBe(WORKSPACE_CHANNEL);
      deliver = listener;
    },
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
    const input = { ...scenario.input };
    const outcome =
      access === "core"
        ? await viaCore(root, entry, input)
        : access === "cli"
          ? await viaCli(root, entry, input)
          : access === "api"
            ? await viaApi(root, entry, input, cache)
            : access === "mcp"
              ? await viaMcp(root, entry, input)
              : await viaApp(root, entry, input);
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
        it(`[SR-080/AK2] ${entry.name}, ${scenario.name}`, async () => {
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
