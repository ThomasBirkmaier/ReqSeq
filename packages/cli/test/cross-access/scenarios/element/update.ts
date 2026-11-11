// Cross-access scenarios of element.update, in addition to the default one (cross-access.test.ts).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import type { Written } from "../../fixtures.js";
import {
  AFFECTED,
  FILTER,
  NESTED,
  VARIANT_VIEWS,
  changedFiles,
  requiredKey,
  supersededHintFiles,
} from "../../fixtures.js";

/** The SHA-256 of a file's bytes, as element.get gives it (`fileSha256`, SR-106). */
const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The SHA-256 of a file of a fixture under fixtures/: the write precondition a change of the text or the
 * title of that element needs (`expectedFileSha256`, #269).
 */
const fixtureSha256 = (fixture: string, file: string): string =>
  sha256(readFileSync(new URL(`../../../../../../fixtures/${fixture}/${file}`, import.meta.url)));

/** The SHA-256 of SR-e88fb3 in SR-004/one-repository. */
const WIND_SHA256 = fixtureSha256("SR-004/one-repository", "requirements/SR-6328cee88fb3.md");

/** An element without text whose text gets a reqseq: link (#176). */
const LINKING =
  "---\nid: 17600000-0000-4000-8000-0000000b0176\ntype: system-requirement\nstatus: draft\ntitle: Linking\n---\n";

/** A superseded need of SR-072/supersede, written over the fixture's file (SR-072 AK3). */
const SEE_THE_WIND =
  "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6\ntype: need\nstatus: obsolete\ntitle: See the wind\n---\n";

/** Its successor in SR-072/supersede. */
const SEE_WIND_AND_GUSTS =
  "---\nid: 7a1e0c2b-4d3f-4a5b-8c6d-b2c3d4e5f6a7\ntype: need\nstatus: draft\ntitle: See wind and gusts\nsupersedes:\n  - { id: 7a1e0c2b-4d3f-4a5b-8c6d-a1b2c3d4e5f6, version: n1:1111111111111111, title: See the wind }\n---\n";

/** An element with three acceptance criteria in three quotings, for setItems (#177). */
const CRITERIA = [
  "---",
  "id: 17700000-0000-4000-8000-000000000177",
  "type: system-requirement",
  "status: draft",
  "title: Criteria",
  "acceptance-criteria:",
  '  - "Given a quoted first, then it stays."',
  "  - Given a plain second, when it is read, then it is shown.",
  "  - 'Given a single third, then it stays.'",
  "---",
  "",
].join("\n");

const CRITERIA_FIXTURE = {
  fixture: "SR-004/one-repository",
  git: true,
  files: { "requirements/SR-000000000177.md": CRITERIA },
} as const;

scenariosOf("element.update", [
  {
    name: "setItems replaces criterion 2 and appends one with a reqseq: link by short ID (#177)",
    fixture: CRITERIA_FIXTURE,
    input: {
      ref: "SR-000177",
      setItems: {
        "acceptance-criteria": {
          "2": "Given a plain second, when it changes, then it is shown.",
          "4": "Given [the wind](reqseq:SR-e88fb3), then it is shown.",
        },
      },
      expectedFileSha256: sha256(CRITERIA),
    },
    expect: "output",
  },
  {
    name: "setItems without expectedFileSha256 is refused (#177)",
    fixture: CRITERIA_FIXTURE,
    input: { ref: "SR-000177", setItems: { "acceptance-criteria": { "1": "x" } } },
    expect: "error",
  },
  {
    name: "setItems with a position after a gap is refused (#177)",
    fixture: CRITERIA_FIXTURE,
    input: {
      ref: "SR-000177",
      setItems: { "acceptance-criteria": { "5": "x" } },
      expectedFileSha256: sha256(CRITERIA),
    },
    expect: "error",
  },
  {
    name: "a number given as text is refused, the file stays (#614)",
    tag: "[SR-085/AK4]",
    fixture: FILTER,
    input: { ref: "SWR-0000f1", set: { priority: "3" } },
    expect: "error",
  },
  {
    name: "a property the type does not have is refused, the file stays",
    tag: "[SR-016/AK4]",
    fixture: FILTER,
    input: { ref: "SR-0000b1", set: { colour: "red" } },
    expect: "error",
    check: (results) => {
      expect((results["core"]?.outcome as { error: { code: string } }).error.code).toBe("input.invalid");
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
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
        "requirements/SR-0000000b0176.md": LINKING,
      },
    },
    input: { ref: "SR-0b0176", text: "See [wind](reqseq:SR-e88fb3).\n", expectedFileSha256: sha256(LINKING) },
    expect: "output",
  },
  {
    name: "a reqseq: link whose short ID names no element is refused (#176)",
    input: { ref: "SR-e88fb3", text: "See [gone](reqseq:SR-999999).\n", expectedFileSha256: WIND_SHA256 },
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
    input: {
      ref: "VAR-0000b2",
      title: "North",
      expectedFileSha256: fixtureSha256("SR-039/nested", "variants/VAR-0000000000b2.md"),
    },
    tag: "[SR-039/AK2]",
    expect: "error",
  },
  {
    name: "a relation between variants is allowed",
    fixture: NESTED,
    input: {
      ref: "VAR-0000c3",
      title: "Mountains",
      expectedFileSha256: fixtureSha256("SR-039/nested", "variants/VAR-0000000000c3.md"),
    },
    tag: "[SR-039/AK2]",
    expect: "output",
  },
  {
    name: "update a superseded element with a successor: same view with the successor relation everywhere (consistency, SR-072 AK3)",
    fixture: {
      fixture: "SR-072/supersede",
      git: true,
      files: {
        "needs/N-a1b2c3d4e5f6.md": SEE_THE_WIND,
        "needs/N-b2c3d4e5f6a7.md": SEE_WIND_AND_GUSTS,
      },
    },
    input: { ref: "N-d4e5f6", text: "Changed.\n", expectedFileSha256: sha256(SEE_THE_WIND) },
    expect: "output",
  },
  {
    tag: "[SR-072/AK2]",
    name: "update the successor of a superseded element: its own succession relation gets no hint",
    fixture: {
      fixture: "SR-072/supersede",
      git: true,
      files: {
        "needs/N-a1b2c3d4e5f6.md": SEE_THE_WIND,
        "needs/N-b2c3d4e5f6a7.md": SEE_WIND_AND_GUSTS,
      },
    },
    input: { ref: "N-e5f6a7", text: "Changed.\n", expectedFileSha256: sha256(SEE_WIND_AND_GUSTS) },
    expect: "output",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(supersededHintFiles(result)).toEqual([]);
      }
    },
  },
  {
    name: "update an element with a relation to a superseded element (SR-072 AK2 hint)",
    fixture: { fixture: "SR-019/findings", git: true },
    input: {
      ref: "2b2b2b2b-2222-4222-8222-b00000000008",
      text: "Changed.\n",
      expectedFileSha256: fixtureSha256("SR-019/findings", "requirements/SR-b00000000008.md"),
    },
    expect: "output",
  },
  {
    name: "update an element with a validity target, shown in relations (ThomasBirkmaier/ReqSeq-archive#187)",
    fixture: { fixture: "SR-019/findings", git: true },
    input: {
      ref: "2b2b2b2b-2222-4222-8222-b00000000009",
      text: "Changed.\n",
      expectedFileSha256: fixtureSha256("SR-019/findings", "requirements/SR-b00000000009.md"),
    },
    expect: "output",
  },
  {
    name: "update a requirement of a variant: its validity and verification views named by short ID (#1216)",
    fixture: VARIANT_VIEWS,
    input: {
      ref: "SR-0000b1",
      title: "Response time at most 15 ms",
      expectedFileSha256: fixtureSha256("SR-043/example", "requirements/SR-0000000000b1.md"),
    },
    expect: "output",
    check: (results) => {
      for (const { outcome } of Object.values(results)) {
        const { names } = (outcome as { output: { names?: readonly { shortId: string }[] } }).output;
        expect(names?.map((n) => n.shortId)).toEqual(["VAR-0000c1"]);
      }
    },
  },
  {
    name: "rename and set a property",
    input: {
      ref: "SR-e88fb3",
      title: "Show the wind speed",
      text: "New text.\n",
      set: { rationale: "Pilots" },
      expectedFileSha256: WIND_SHA256,
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
        ["trace.no-parent", undefined],
      ]);
    },
  },
  {
    name: "unknown reference",
    input: { ref: "SR-ffffff", title: "x", expectedFileSha256: WIND_SHA256 },
    expect: "error",
  },
  {
    name: "a change of the title without expectedFileSha256 is refused: input.invalid (SR-106, #269)",
    input: { ref: "SR-e88fb3", title: "Show the wind speed" },
    expect: "error",
    check: (results) => {
      expect(results["core"]?.outcome).toMatchObject({
        error: {
          code: "input.invalid",
          details: { field: "expectedFileSha256", reason: "precondition-missing" },
        },
      });
    },
  },
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
    input: {
      ref: "SR-00b001",
      text: "Changed.\n",
      expectedFileSha256: fixtureSha256("SR-024/affected", "requirements/SR-00000000b001.md"),
    },
    expect: "output",
  },
]);
