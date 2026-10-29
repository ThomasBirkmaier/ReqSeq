import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import { supersededValidityFindings, supersededValidityProblemsState } from "./superseded-validity.js";
import { appliesIn, validityOf } from "./views.js";

/** Elements of fixtures/SR-040/validity. */
const COAST = "40a0e000-0000-4000-8000-a1a1a1a1a1a1";
const MOUNTAIN = "40a0e000-0000-4000-8000-b2b2b2b2b2b2";
const COAST_AND_MOUNTAIN = "40a0e000-0000-4000-8000-000000000ab2";
const MISSING = "40a0e000-0000-4000-8000-000000000000";
const MODEL = "metamodel/standard-model.yaml";
const V = "n1:1111111111111111";

const variant = (id: string, status: string, title: string): string =>
  `---\nid: ${id}\ntype: variant\nstatus: ${status}\ntitle: ${title}\n---\n`;

const requirement = (id: string, validity: string): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: R\nrequirement-type: functional\nacceptance-criteria:\n  - Given a, when b, then c.\n${validity}---\n`;

const MOUNTAIN_OBSOLETE = { "variants/VAR-b2b2b2b2b2b2.md": variant(MOUNTAIN, "obsolete", "Mountain") };

const open = async (files: Readonly<Record<string, string>>): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-040/validity", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const hints = async (files: Readonly<Record<string, string>>): Promise<readonly unknown[]> =>
  (await open(files)).get(supersededValidityProblemsState);

const fixtureModel = (): Promise<string> =>
  fs.readFile(new URL(`../../../../fixtures/SR-040/validity/${MODEL}`, import.meta.url), "utf8");

describe("hints on validities that list a superseded variant (SR-040 AK3)", () => {
  it("[SR-040/AK3] gives a hint at every requirement whose validity lists the superseded variant", async () => {
    const other = "40a0e000-0000-4000-8000-000000000bb3";
    const out = await hints({
      ...MOUNTAIN_OBSOLETE,
      "requirements/SR-000000000bb3.md": requirement(
        other,
        `validity:\n  - { id: ${MOUNTAIN}, version: ${V}, title: Mountain }\n`,
      ),
    });
    expect(out).toEqual([
      {
        code: "variant.superseded-in-validity",
        severity: "warning",
        message:
          "Property Validity (validity) of System Requirement SR-000ab2 lists Variant VAR-b2b2b2, which is superseded (status Obsolete)",
        repository: "system",
        file: "requirements/SR-000000000ab2.md",
        line: 11,
        elementId: COAST_AND_MOUNTAIN,
        targetId: MOUNTAIN,
      },
      {
        code: "variant.superseded-in-validity",
        severity: "warning",
        message:
          "Property Validity (validity) of System Requirement SR-000bb3 lists Variant VAR-b2b2b2, which is superseded (status Obsolete)",
        repository: "system",
        file: "requirements/SR-000000000bb3.md",
        line: 10,
        elementId: other,
        targetId: MOUNTAIN,
      },
    ]);
  });

  it("[SR-040/AK3] gives no hint while no variant is superseded", async () => {
    expect(await hints({})).toEqual([]);
  });

  it("[SR-040/AK3] gives no hint when the metamodel marks no status invalid or has no validity", async () => {
    const model = await fixtureModel();
    expect(await hints({ ...MOUNTAIN_OBSOLETE, [MODEL]: model.replace(", invalid: true", "") })).toEqual([]);
    expect(
      await hints({ ...MOUNTAIN_OBSOLETE, [MODEL]: model.replace("    meaning: validity\n", "") }),
    ).toEqual([]);
  });

  it("[SR-040/AK3] gives a hint for every entry for which the view of the superseded variant applies", async () => {
    const coast = variant(COAST, "obsolete", "Coast");
    // Entries of every shape: the hint must follow `appliesIn`, whatever SR-085 says of the shape.
    const entries = [
      "Mountain",
      `{ id: ${MOUNTAIN} }`,
      `{ id: ${MOUNTAIN}, version: not-a-version }`,
      `{ id: ${MOUNTAIN}, version: ${V}, title: Mountain, repository: system }`,
      `{ id: ${MOUNTAIN}, version: ${V}, note: kept }`,
      `{ id: ${MOUNTAIN}, version: ${V}, repository: platform }`,
      `{ id: ${MOUNTAIN}, repository: null }`,
      `{ id: ${MISSING}, version: ${V} }`,
      `{ id: ${COAST}, version: ${V} }`,
      `{ id: ${MOUNTAIN}, version: ${V} }`,
    ];
    const workspace = await open({
      ...MOUNTAIN_OBSOLETE,
      // A second file with the UUID of Coast makes it ambiguous (SR-088).
      "variants/VAR-a1a1a1a1a1a1.md": coast,
      "variants/copy/VAR-a1a1a1a1a1a1.md": coast,
      "requirements/SR-000000000ab2.md": requirement(
        COAST_AND_MOUNTAIN,
        ["validity:", ...entries.map((e) => `  - ${e}`), ""].join("\n"),
      ),
    });
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const [listed] = store.byId.get(COAST_AND_MOUNTAIN) ?? [];
    const [mountain] = store.byId.get(MOUNTAIN) ?? [];
    if (listed === undefined || mountain === undefined) {
      throw new Error("fixture changed");
    }
    const validity = validityOf(metamodel);
    const items = listed.data["validity"] as readonly unknown[];
    const view = { kind: "variant", variant: mountain } as const;
    // The entries for which the requirement applies in the view of Mountain, by their line (from 10).
    const expected = items.flatMap((item, i) =>
      appliesIn(validity, { ...listed, data: { ...listed.data, validity: [item] } }, view) ? [10 + i] : [],
    );
    expect(expected).toEqual([11, 12, 13, 14, 19]);
    const out = (await workspace.get(supersededValidityProblemsState)) as readonly { line?: number }[];
    expect(out.map((p) => p.line)).toEqual(expected);
  });

  it("[SR-040/AK3] reads one value under a list key as no entry, as the missing-target check does", async () => {
    const out = await hints({
      ...MOUNTAIN_OBSOLETE,
      "requirements/SR-000000000ab2.md": requirement(
        COAST_AND_MOUNTAIN,
        `validity: { id: ${MOUNTAIN}, version: ${V} }\n`,
      ),
    });
    expect(out).toEqual([]);
  });

  it("[SR-040/AK3] gives no hint for a superseded element that is no variant", async () => {
    const need = "40a0e000-0000-4000-8000-0000000000e1";
    const out = await hints({
      "variants/VAR-b2b2b2b2b2b2.md": `---\nid: ${MOUNTAIN}\ntype: gadget\nstatus: obsolete\ntitle: Mountain\n---\n`,
      "needs/N-0000000000e1.md": `---\nid: ${need}\ntype: need\nstatus: obsolete\ntitle: Old\n---\n`,
      "requirements/SR-000000000bb3.md": requirement(
        "40a0e000-0000-4000-8000-000000000bb3",
        `validity:\n  - { id: ${need}, version: ${V} }\n`,
      ),
    });
    expect(out).toEqual([]);
  });

  it("[SR-040/AK3] names the variant by the name of its type, also a subtype", async () => {
    const out = await hints({
      "metamodel/island.yaml":
        "logreq-metamodel: 1\ntypes:\n  - { key: island, name: Island, prefix: ISL, extends: variant }\n",
      "variants/VAR-b2b2b2b2b2b2.md": `---\nid: ${MOUNTAIN}\ntype: island\nstatus: obsolete\ntitle: Mountain\n---\n`,
    });
    expect(out.map((p) => (p as { message: string }).message)).toEqual([
      "Property Validity (validity) of System Requirement SR-000ab2 lists Island ISL-b2b2b2, which is superseded (status Obsolete)",
    ]);
  });

  it("[SR-040/AK3] gives the hint as soon as the store has the new status", async () => {
    const workspace = await open({});
    expect(await workspace.get(supersededValidityProblemsState)).toEqual([]);
    await fs.writeFile(
      path.join(workspace.root, "variants/VAR-b2b2b2b2b2b2.md"),
      variant(MOUNTAIN, "obsolete", "Mountain"),
    );
    await workspace.reset(elementStoreState);
    expect(await workspace.get(supersededValidityProblemsState)).toMatchObject([{ targetId: MOUNTAIN }]);
  });

  it("[SR-040/AK3] looks the variant up in the repository the entry names, not by UUID alone", async () => {
    const workspace = await open({});
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const shortIds = await workspace.get(shortIdState);
    const [mountain] = store.byId.get(MOUNTAIN) ?? [];
    if (mountain === undefined) {
      throw new Error("fixture changed");
    }
    // The same UUID superseded in another repository: the entry without `repository` names the
    // variant of its own repository, which is not superseded (D-058).
    const elsewhere: ElementRecord = {
      ...mountain,
      repository: "platform",
      data: { ...mountain.data, status: "obsolete" },
    };
    const byId = new Map(store.byId);
    byId.set(MOUNTAIN, [mountain, elsewhere]);
    const big: ElementStore = { ...store, elements: [...store.elements, elsewhere], byId };
    expect(supersededValidityFindings({ store: big, metamodel, shortIds })).toEqual([]);
    // The element of the UUID in the source's repository is no variant: no hint either.
    const asNeed: ElementRecord = { ...mountain, type: "need" };
    byId.set(MOUNTAIN, [asNeed, elsewhere]);
    const mixed: ElementStore = {
      ...store,
      elements: [...store.elements.filter((e) => e !== mountain), asNeed, elsewhere],
      byId,
    };
    expect(supersededValidityFindings({ store: mixed, metamodel, shortIds })).toEqual([]);
  });

  it("[SR-040/AK3] checks 50,000 elements in one pass within a sanity bound (N-036)", async () => {
    const workspace = await open(MOUNTAIN_OBSOLETE);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const shortIds = await workspace.get(shortIdState);
    const [listed] = store.byId.get(COAST_AND_MOUNTAIN) ?? [];
    const [coastOnly] = [listed].map(
      (r): ElementRecord | undefined =>
        r && { ...r, data: { ...r.data, validity: [{ id: COAST, version: V, title: "Coast" }] } },
    );
    if (listed === undefined || coastOnly === undefined) {
      throw new Error("fixture changed");
    }
    const elements = [
      ...store.elements,
      ...Array.from({ length: 50_000 }, (_, i) => (i % 100 === 0 ? listed : coastOnly)),
    ];
    const big: ElementStore = { ...store, elements };
    const started = performance.now();
    const findings = supersededValidityFindings({ store: big, metamodel, shortIds });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(findings).toHaveLength(501);
  });
});
