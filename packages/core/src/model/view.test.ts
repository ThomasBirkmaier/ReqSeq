import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { FileSnapshot, ParsedFile } from "../files/index.js";
import { parseFileBytes } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { computeVersion } from "../version/version.js";
import { classifyFile } from "./elements.js";
import type { ElementRecord } from "./elements.js";
import { buildShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import { elementView } from "./view.js";
import { writtenElement } from "./write.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const OTHER = "0b7c6e1a-1111-4222-8333-444455556666";

const snapshotOf = (path: string): FileSnapshot => ({ path, size: 0, mtimeMs: 0, sha256: "0".repeat(64) });

const parsedFile = (text: string, path = "x.md"): ParsedFile => {
  const outcome = parseFileBytes(path, new TextEncoder().encode(text));
  if (outcome.kind !== "parsed") {
    throw new Error("does not parse");
  }
  return { ...outcome.content, path, snapshot: snapshotOf(path) };
};

const recordOf = (file: ParsedFile): ElementRecord => {
  const classified = classifyFile("system", file);
  if (classified.kind !== "element") {
    throw new Error("not an element");
  }
  return classified.element;
};

const context = async (): Promise<{ metamodel: Metamodel; store: ElementStore; layout: WorkspaceLayout }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-001/two-elements",
    files: { "copy/SR-1d2e3f4a5b6c.md": `---\nid: ${GUSTS}\ntype: need\nstatus: draft\ntitle: Copy\n---\n` },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return {
    metamodel: await workspace.get(metamodelState),
    store: await workspace.get(elementStoreState),
    layout: await workspace.get(workspaceLayoutState),
  };
};

describe("elementView", () => {
  it("gives relations to targets in the store, missing and duplicated ones, and skips malformed items", async () => {
    const { metamodel, store, layout } = await context();
    const file = parsedFile(
      [
        "---",
        `id: ${OTHER}`,
        "type: system-requirement",
        "status: draft",
        "title: Many relations",
        "derives-from:",
        `  - { id: ${WIND}, version: n1:0000000000000000 }`,
        `  - { id: ${GUSTS}, version: not-a-version }`,
        "  - { id: not-a-uuid, version: n1:0000000000000000 }",
        "  - plain text",
        `refines: { id: 9a9a9a9a-1111-4222-8333-444455556666, version: n1:1111111111111111 }`,
        "---",
        "",
      ].join("\n"),
    );
    const record = recordOf(file);
    const view = elementView({
      successionsOf: () => [],
      record,
      file,
      images: [],
      metamodel,
      store,
      shortIds: buildShortIds(store.byId, metamodel),
      titleKey: "title",
      layout,
    });
    // `refines` holds one mapping where a list belongs: no relation, as in the checks (SR-085).
    expect(view.relations).toEqual([
      {
        kind: "derives-from",
        meaning: "derivation",
        direction: "out",
        id: WIND,
        shortId: "SR-e88fb3",
        title: "Show wind speed",
        accessible: true,
        targetState: "available",
        storedVersion: "n1:0000000000000000",
      },
      // Two files share this UUID (SR-088): which one is meant is unknown, so it is not accessible.
      {
        kind: "derives-from",
        meaning: "derivation",
        direction: "out",
        id: GUSTS,
        accessible: false,
        targetState: "ambiguous",
      },
    ]);
  });

  it("names a relation kind without meaning without one, and a target title only when it is text", async () => {
    const { metamodel, store, layout } = await context();
    const decision = recordOf(
      parsedFile(`---\nid: ${OTHER}\ntype: decision\nstatus: draft\ntitle: 7\n---\n`),
    );
    const byId = new Map([...store.byId, [OTHER, [decision]]]);
    const file = parsedFile(
      `---\nid: ${GUSTS}\ntype: system-requirement\nstatus: draft\ntitle: x\nbased-on:\n  - { id: ${OTHER}, version: n1:0000000000000000 }\n---\n`,
    );
    const view = elementView({
      successionsOf: () => [],
      record: recordOf(file),
      file,
      images: [],
      metamodel,
      store: { ...store, byId },
      shortIds: buildShortIds(byId, metamodel),
      titleKey: "title",
      layout,
    });
    expect(view.relations).toEqual([
      {
        kind: "based-on",
        direction: "out",
        id: OTHER,
        shortId: "D-556666",
        accessible: true,
        targetState: "available",
        storedVersion: "n1:0000000000000000",
      },
    ]);
  });

  it("reads relation properties as the checks do: one target, or a list with many, and skips malformed items", async () => {
    const { metamodel, store, layout } = await context();
    // A single-valued relation property next to the standard model's `validity` (many).
    const withParent: Metamodel = {
      ...metamodel,
      properties: [...metamodel.properties, { key: "parent-item", name: "Parent Item", kind: "relation" }],
    };
    const view = (lines: readonly string[]) => {
      const file = parsedFile(
        [
          "---",
          `id: ${OTHER}`,
          "type: system-requirement",
          "status: draft",
          "title: x",
          ...lines,
          "---",
          "",
        ].join("\n"),
      );
      const record = recordOf(file);
      return elementView({
        successionsOf: () => [],
        record,
        file,
        metamodel: withParent,
        store,
        shortIds: buildShortIds(store.byId, withParent),
        titleKey: "title",
        layout,
        images: [],
      }).relations;
    };
    expect(
      view([
        `parent-item: { id: ${WIND}, version: n1:0000000000000000 }`,
        "validity:",
        "  - plain text",
        "  - { id: not-a-uuid }",
        "  - { id: 7 }",
        `  - { id: ${WIND} }`,
      ]),
    ).toEqual([
      {
        kind: "validity",
        property: true,
        direction: "out",
        id: WIND,
        shortId: "SR-e88fb3",
        title: "Show wind speed",
        accessible: true,
        targetState: "available",
      },
      {
        kind: "parent-item",
        property: true,
        direction: "out",
        id: WIND,
        shortId: "SR-e88fb3",
        title: "Show wind speed",
        accessible: true,
        targetState: "available",
        storedVersion: "n1:0000000000000000",
      },
    ]);
    // A list on the single-valued property and one mapping on the list property: no relation.
    expect(
      view([
        "parent-item:",
        `  - { id: ${WIND}, version: n1:0000000000000000 }`,
        `validity: { id: ${WIND}, version: n1:0000000000000000 }`,
      ]),
    ).toEqual([]);
  });

  it("leaves out a status and shows a title that are not text as empty and counts no property of an unknown type", async () => {
    const { metamodel, store, layout } = await context();
    const file = parsedFile(`---\nid: ${OTHER}\ntype: gadget\nstatus: 3\ntitle: [a]\nweight: 2\n---\nBody\n`);
    const record = recordOf(file);
    const view = elementView({
      successionsOf: () => [],
      record,
      file,
      images: [],
      metamodel,
      store,
      shortIds: buildShortIds(new Map([[OTHER, [record]]]), metamodel),
      titleKey: "title",
      layout,
    });
    expect(view).toMatchObject({
      title: "",
      text: "Body\n",
      properties: { weight: 2 },
      version: computeVersion({ text: "Body\n", properties: {}, definitions: [], files: [] }),
    });
    // A status that is not text is no key; the element is listed as one without status (#306).
    expect(view).not.toHaveProperty("status");
  });

  it("gives a value-kind hint without a line when the file at hand does not hold the value", async () => {
    const { metamodel, store, layout } = await context();
    const file = parsedFile(`---\nid: ${OTHER}\ntype: system-requirement\nstatus: draft\ntitle: x\n---\n`);
    const record: ElementRecord = {
      ...recordOf(file),
      data: { ...recordOf(file).data, "requirement-type": "odd", "acceptance-criteria": ["Shows it"] },
    };
    const view = elementView({
      successionsOf: () => [],
      record,
      file,
      images: [],
      metamodel,
      store,
      shortIds: buildShortIds(new Map([[OTHER, [record]]]), metamodel),
      titleKey: "title",
      layout,
    });
    expect(view.problems).toEqual([expect.objectContaining({ code: "element.wrong-value-kind" })]);
    expect(view.problems[0]).not.toHaveProperty("line");
  });

  it("gives no hints while the metamodel is not valid (#208, #220 option 1)", async () => {
    const { metamodel, store, layout } = await context();
    const file = parsedFile(
      `---\nid: ${OTHER}\ntype: system-requirement\nstatus: draft\ntitle: x\nbogus: 1\nrequirement-type: odd\n---\n`,
    );
    const record = recordOf(file);
    const viewWith = (m: Metamodel): ReturnType<typeof elementView> =>
      elementView({
        successionsOf: () => [],
        record,
        file,
        images: [],
        metamodel: m,
        store,
        shortIds: buildShortIds(new Map([[OTHER, [record]]]), m),
        titleKey: "title",
        layout,
      });
    // The same element has hints against the valid metamodel.
    expect(viewWith(metamodel).problems.map((p) => p.code)).toEqual(
      expect.arrayContaining(["element.unknown-property", "element.wrong-value-kind"]),
    );
    expect(viewWith({ ...metamodel, valid: false }).problems).toEqual([]);
  });
});

describe("writtenElement", () => {
  it("reads written bytes back as an element", () => {
    const bytes = new TextEncoder().encode(`---\nid: ${OTHER}\ntype: need\nstatus: draft\n---\n`);
    const written = writtenElement("system", bytes, snapshotOf("n/N-444455556666.md"));
    expect(written.record).toMatchObject({ id: OTHER, file: "n/N-444455556666.md", repository: "system" });
    expect(written.file.snapshot).toEqual(snapshotOf("n/N-444455556666.md"));
  });

  it("is an internal error when the bytes are no element", () => {
    for (const text of ["no frontmatter\n", "---\ntitle: x\n---\n"]) {
      expect(() => writtenElement("system", new TextEncoder().encode(text), snapshotOf("a.md"))).toThrow(
        expect.objectContaining({ code: "internal" }),
      );
    }
  });
});
