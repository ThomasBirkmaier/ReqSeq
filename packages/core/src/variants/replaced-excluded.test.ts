// The variants that replace or exclude a core requirement (SR-046 AK3) on fixtures/SR-043/example:
// variant A (Coast) replaces K1 by A1 and excludes K2; B (Mountain) and C (Desert) change nothing.
// The element.get test of the AK is in commands/element/get.test.ts; these cases cover the rule.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState } from "../model/index.js";
import type { ElementRecord } from "../model/index.js";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { replacedExcludedOf } from "./replaced-excluded.js";

const P = "43043043-0000-4000-8000-0000000000";
const NAMES: Readonly<Record<string, string>> = { a1: "K1", a2: "K2", b1: "A1", c1: "A", c2: "B", c3: "C" };
const name = (id: string): string => NAMES[id.slice(-2)] ?? id.slice(-2);
const to = (tail: string): string => `{ id: ${P}${tail} }`;

/** A system requirement with tail `tail` and the frontmatter lines `lines`. */
const requirement = (tail: string, lines: string): Record<string, string> => ({
  [`requirements/SR-0000000000${tail}.md`]: `---\nid: ${P}${tail}\ntype: system-requirement\nstatus: draft\ntitle: R ${tail}\n${lines}---\n`,
});

/** Variant B (Mountain) with the exclusions `targets`. */
const mountainExcludes = (...targets: string[]): Record<string, string> => ({
  "variants/VAR-0000000000c2.md": `---\nid: ${P}c2\ntype: variant\nstatus: draft\ntitle: Mountain\nexcludes: [${targets.map(to).join(", ")}]\n---\n`,
});

const opened = async (files: Readonly<Record<string, string>>): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-043/example", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** `replacedExcludedOf` of the element with tail `tail` in the example with `files`, by name. */
const of = async (
  tail: string,
  files: Readonly<Record<string, string>> = {},
  pick: (record: ElementRecord) => ElementRecord = (r) => r,
): Promise<{ replacedBy: string[][]; excludedBy: string[] }> => {
  const workspace = await opened(files);
  const store = await workspace.get(elementStoreState);
  const record = store.byId.get(`${P}${tail}`)?.[0];
  if (record === undefined) {
    throw new Error(`no element ${tail}`);
  }
  const uses = replacedExcludedOf(
    { workspace, store, metamodel: await workspace.get(metamodelState) },
    pick(record),
  );
  return {
    replacedBy: uses.replacedBy.map((u) => [name(u.variant.id), name(u.replacement.id)]),
    excludedBy: uses.excludedBy.map((v) => name(v.id)),
  };
};

describe("replacedExcludedOf (SR-046 AK3)", () => {
  it("names A replacing K1 by A1 and B excluding it, A excluding K2, nothing for K3", async () => {
    const files = mountainExcludes("a1");
    expect(await of("a1", files)).toEqual({ replacedBy: [["A", "A1"]], excludedBy: ["B"] });
    expect(await of("a2", files)).toEqual({ replacedBy: [], excludedBy: ["A"] });
    expect(await of("a3", files)).toEqual({ replacedBy: [], excludedBy: [] });
  });

  it("gives a variant that replaces and excludes K1 only as excluding (SR-042 AK5)", async () => {
    const files = {
      ...mountainExcludes("a1"),
      ...requirement("b3", `validity: [${to("c1")}, ${to("c2")}]\nreplaces: [${to("a1")}]\n`),
    };
    expect(await of("a1", files)).toEqual({
      replacedBy: [
        ["A", "A1"],
        ["A", "b3"],
      ],
      excludedBy: ["B"],
    });
  });

  it("leaves out validity entries that name no variant here", async () => {
    const validity = `[${to("d1")}, ${to("99")}, { id: ${P}c3, repository: elsewhere }, free]`;
    expect(
      await of("a3", requirement("b3", `validity: ${validity}\nreplaces: [${to("a3")}, ${to("98")}]\n`)),
    ).toEqual({
      replacedBy: [],
      excludedBy: [],
    });
  });

  it("gives nothing for an element that is no core requirement or not in the store", async () => {
    expect(await of("b1")).toEqual({ replacedBy: [], excludedBy: [] });
    expect(await of("a1", {}, (r) => ({ ...r, file: "elsewhere.md" }))).toEqual({
      replacedBy: [],
      excludedBy: [],
    });
  });

  it("gives the same fields in data.export, whatever view selected the element", async () => {
    const workspace = await opened(mountainExcludes("a1"));
    const out = (await invoke("data.export", {}, { workspace })) as CommandOutput<"data.export">;
    const k1 = out.elements.find((e) => e.id === `${P}a1`);
    expect([k1?.replacedBy, k1?.excludedBy]).toEqual([
      [{ variant: `${P}c1`, replacement: `${P}b1` }],
      [`${P}c2`],
    ]);
  });
});
