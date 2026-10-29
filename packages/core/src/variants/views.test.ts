import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { View } from "./views.js";
import { appliesIn, validityEntries, validityOf, variantsOf } from "./views.js";

/** Elements of fixtures/SR-040/validity. */
const COAST = "40a0e000-0000-4000-8000-a1a1a1a1a1a1";
const MOUNTAIN = "40a0e000-0000-4000-8000-b2b2b2b2b2b2";
const DESERT = "40a0e000-0000-4000-8000-c3c3c3c3c3c3";
const FOR_ALL = "40a0e000-0000-4000-8000-000000000a11";
const COAST_AND_MOUNTAIN = "40a0e000-0000-4000-8000-000000000ab2";

interface Opened {
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
}

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-040/validity", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { store: await workspace.get(elementStoreState), metamodel: await workspace.get(metamodelState) };
};

const recordOf = (store: ElementStore, id: string): ElementRecord => {
  const [record] = store.byId.get(id) ?? [];
  if (record === undefined) {
    throw new Error(`no element ${id}`);
  }
  return record;
};

const withValidity = (record: ElementRecord, validity: unknown): ElementRecord => ({
  ...record,
  data: { ...record.data, validity },
});

const CORE: View = { kind: "core" };
const variantView = (variant: ElementRecord): View => ({ kind: "variant", variant });

/** Which views an element applies in: `core` and the titles of the variants, in store order. */
const viewsOf = (opened: Opened, element: ElementRecord): readonly string[] => {
  const validity = validityOf(opened.metamodel);
  const views: (readonly [string, View])[] = [
    ["core", CORE],
    ...variantsOf(opened.store, opened.metamodel).map(
      (v) => [String(v.data["title"]), variantView(v)] as const,
    ),
  ];
  return views.filter(([, view]) => appliesIn(validity, element, view)).map(([name]) => name);
};

describe("validity as a list of variants (SR-040)", () => {
  it("[SR-040/AK1] a requirement without validity applies in the core and in every variant", async () => {
    const opened = await open();
    expect(variantsOf(opened.store, opened.metamodel).map((v) => v.id)).toEqual([COAST, MOUNTAIN, DESERT]);
    const element = recordOf(opened.store, FOR_ALL);
    expect(viewsOf(opened, element)).toEqual(["core", "Coast", "Mountain", "Desert"]);
  });

  it("[SR-040/AK1] an absent, null or empty validity is the same: it applies everywhere", async () => {
    const opened = await open();
    const element = recordOf(opened.store, FOR_ALL);
    for (const validity of [undefined, null, []]) {
      expect(viewsOf(opened, withValidity(element, validity))).toEqual([
        "core",
        "Coast",
        "Mountain",
        "Desert",
      ]);
    }
    // Without a property with the meaning validity, no element has one.
    const listed = recordOf(opened.store, COAST_AND_MOUNTAIN);
    for (const view of [CORE, variantView(recordOf(opened.store, DESERT))]) {
      expect(appliesIn(undefined, listed, view)).toBe(true);
    }
  });

  it("[SR-040/AK1] a validity property that holds no relations is no validity", async () => {
    const model = await fs.readFile(
      new URL("../../../../fixtures/SR-040/validity/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    );
    const relation =
      "  - key: validity\n    name: Validity\n    kind: relation\n    many: true\n    target-types: [variant]\n";
    expect(model).toContain(relation);
    const opened = await open({
      "metamodel/standard-model.yaml": model.replace(
        relation,
        "  - key: validity\n    name: Validity\n    kind: text\n",
      ),
    });
    expect(validityOf(opened.metamodel)).toBeUndefined();
    const listed = recordOf(opened.store, COAST_AND_MOUNTAIN);
    expect(viewsOf(opened, listed)).toEqual(["core", "Coast", "Mountain", "Desert"]);
  });

  it("[SR-040/AK2] a requirement with the validity Coast and Mountain applies only in these two views", async () => {
    const opened = await open();
    const element = recordOf(opened.store, COAST_AND_MOUNTAIN);
    expect(viewsOf(opened, element)).toEqual(["Coast", "Mountain"]);
    expect(validityEntries(validityOf(opened.metamodel), element)).toHaveLength(2);
  });

  it("[SR-040/AK2] matches a variant by UUID and repository, never by a free name", async () => {
    const opened = await open();
    const element = recordOf(opened.store, FOR_ALL);
    const validity = validityOf(opened.metamodel);
    const coast = recordOf(opened.store, COAST);
    const elsewhere: ElementRecord = { ...coast, repository: "platform" };
    // The source's own repository when an entry names none (D-058).
    const own = withValidity(element, [{ id: COAST, version: "n1:1111111111111111" }]);
    expect(appliesIn(validity, own, variantView(coast))).toBe(true);
    expect(appliesIn(validity, own, variantView(elsewhere))).toBe(false);
    expect(appliesIn(validity, own, CORE)).toBe(false);
    const across = withValidity(element, [
      { id: COAST, version: "n1:1111111111111111", repository: "platform" },
    ]);
    expect(appliesIn(validity, across, variantView(elsewhere))).toBe(true);
    expect(appliesIn(validity, across, variantView(coast))).toBe(false);
    // `repository: null` names no repository of the workspace, so it matches no variant.
    const unnamed = withValidity(element, [{ id: COAST, repository: null }]);
    expect(appliesIn(validity, unnamed, variantView(coast))).toBe(false);
    // Free names and other values are no variants (D-020): the requirement applies in no view.
    const names = withValidity(element, ["Coast", null, 7, { title: "Coast" }, [{ id: COAST }], { id: 7 }]);
    expect(viewsOf(opened, names)).toEqual([]);
  });

  it("[SR-040/AK2] reads one value under a list key as no entry, as the missing-target check does", async () => {
    const opened = await open();
    const element = withValidity(recordOf(opened.store, FOR_ALL), {
      id: MOUNTAIN,
      version: "n1:1111111111111111",
    });
    // The validity of the standard model has `many`; the value-kind check reports the value (SR-085).
    expect(validityEntries(validityOf(opened.metamodel), element)).toEqual([]);
    // A validity that is given but cannot be read is no empty list: the requirement applies nowhere.
    expect(viewsOf(opened, element)).toEqual([]);
    expect(viewsOf(opened, withValidity(element, "Mountain"))).toEqual([]);
    expect(viewsOf(opened, withValidity(element, 7))).toEqual([]);
    expect(viewsOf(opened, withValidity(element, []))).toEqual(["core", "Coast", "Mountain", "Desert"]);
    // A validity without `many` holds one target; a list there gives no entry.
    const single = { key: "validity", many: false } as const;
    const mountain = variantView(recordOf(opened.store, MOUNTAIN));
    expect(validityEntries(single, element)).toEqual([
      { path: ["validity"], value: { id: MOUNTAIN, version: "n1:1111111111111111" } },
    ]);
    expect(appliesIn(single, element, mountain)).toBe(true);
    expect(appliesIn(single, element, CORE)).toBe(false);
    const listed = recordOf(opened.store, COAST_AND_MOUNTAIN);
    expect(validityEntries(single, listed)).toEqual([]);
    expect(appliesIn(single, listed, CORE)).toBe(false);
    expect(appliesIn(single, listed, mountain)).toBe(false);
    // Without a validity property in the metamodel every element applies everywhere.
    expect(appliesIn(undefined, listed, CORE)).toBe(true);
    expect(validityEntries(undefined, listed)).toEqual([]);
    expect(validityEntries(single, withValidity(element, null))).toEqual([]);
  });

  it("[SR-040/AK2] counts subtypes of the variant type as variants and ignores other elements", async () => {
    const model = [
      "logreq-metamodel: 1",
      "types:",
      "  - { key: island, name: Island, prefix: ISL, extends: variant }",
      "",
    ].join("\n");
    const opened = await open({
      "metamodel/island.yaml": model,
      "variants/ISL-d4d4d4d4d4d4.md":
        "---\nid: 40a0e000-0000-4000-8000-d4d4d4d4d4d4\ntype: island\nstatus: draft\ntitle: Island\n---\n",
    });
    expect(variantsOf(opened.store, opened.metamodel).map((v) => v.data["title"])).toEqual([
      // Store order: by file path.
      "Island",
      "Coast",
      "Mountain",
      "Desert",
    ]);
  });
});
