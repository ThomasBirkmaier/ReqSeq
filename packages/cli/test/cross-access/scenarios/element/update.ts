// Cross-access scenarios of element.update, in addition to the default one (cross-access.test.ts).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import type { Written } from "../../fixtures.js";
import { AFFECTED, FILTER, NESTED, requiredKey, supersededHintFiles } from "../../fixtures.js";

/** The SHA-256 of SR-e88fb3 in SR-004/one-repository, as element.get gives it (`fileSha256`, SR-106). */
const WIND_SHA256 = createHash("sha256")
  .update(
    readFileSync(
      new URL(
        "../../../../../../fixtures/SR-004/one-repository/requirements/SR-6328cee88fb3.md",
        import.meta.url,
      ),
    ),
  )
  .digest("hex");

scenariosOf("element.update", [
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
    tag: "[SR-072/AK2]",
    name: "update the successor of a superseded element: its own succession relation gets no hint",
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
    input: { ref: "N-e5f6a7", text: "Changed.\n" },
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
        ["trace.no-parent", undefined],
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
]);
