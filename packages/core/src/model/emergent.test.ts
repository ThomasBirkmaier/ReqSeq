// The mark "emergent behaviour" (SR-035, #591 Q1): which value marks an element, and which property
// holds it. The output, the filter and the status that use it are tested in
// commands/evidence/emergent.test.ts.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { EMERGENT_CHOICE, metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { emergentKeyOf, isEmergent } from "./emergent.js";
import { elementStoreState } from "./store.js";

const open = async (): Promise<Workspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-035/emergent" });
  onTestFinished(() => created.cleanup());
  const workspace = new Workspace(created.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** A metamodel with only properties (choices yes and no unless given), counting how often they are read. */
const counted = (...properties: { key: string; meaning?: string; kind?: string }[]) => {
  let reads = 0;
  const choices = [
    { key: "yes", name: "Yes" },
    { key: "no", name: "No" },
  ];
  const metamodel = {
    get properties() {
      reads += 1;
      return properties.map((p) => ({ name: p.key, kind: "choice", choices, ...p }));
    },
  } as unknown as Metamodel;
  return { metamodel, reads: () => reads };
};

describe("the emergent mark (#591 Q1)", () => {
  it("the choice yes marks; no, the display name, true, a list, null and an absent value do not", () => {
    expect(EMERGENT_CHOICE).toBe("yes");
    expect(isEmergent({ data: { emergent: "yes" } }, "emergent")).toBe(true);
    for (const value of ["no", "Yes", true, ["yes"], null, undefined, ""]) {
      expect(isEmergent({ data: { emergent: value } }, "emergent")).toBe(false);
    }
    expect(isEmergent({ data: {} }, "emergent")).toBe(false);
  });

  it("without a property with the meaning emergent, or with one that cannot hold the mark, no element is emergent", () => {
    expect(isEmergent({ data: { emergent: "yes" } }, undefined)).toBe(false);
    expect(emergentKeyOf(counted({ key: "emergent" }).metamodel)).toBeUndefined();
    // A property that cannot hold the mark marks nothing; the metamodel warns (meanings.test.ts).
    expect(
      emergentKeyOf(counted({ key: "emergent", meaning: "emergent", kind: "text" }).metamodel),
    ).toBeUndefined();
  });

  it("follows the meaning, not the key emergent, and keeps the key per metamodel", () => {
    const { metamodel, reads } = counted(
      { key: "emergent" },
      { key: "emergent-behaviour", meaning: "emergent" },
    );
    expect(emergentKeyOf(metamodel)).toBe("emergent-behaviour");
    expect(emergentKeyOf(metamodel)).toBe("emergent-behaviour");
    expect(reads()).toBe(1);
    const none = counted();
    expect(emergentKeyOf(none.metamodel)).toBeUndefined();
    expect(emergentKeyOf(none.metamodel)).toBeUndefined();
    expect(none.reads()).toBe(1);
  });

  it("an unquoted emergent: yes written by hand marks the element (a YAML 1.2 string, plan review N4)", async () => {
    const workspace = await open();
    const [metamodel, store] = await Promise.all([
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
    ]);
    const key = emergentKeyOf(metamodel);
    expect(key).toBe("emergent");
    const e4 = store.elements.find((e) => e.id.endsWith("b150"));
    expect(e4?.data["emergent"]).toBe("yes");
    expect(e4 !== undefined && isEmergent(e4, key)).toBe(true);
    const marked = store.elements.filter((e) => isEmergent(e, key)).map((e) => e.id.slice(-4));
    expect(marked.sort()).toEqual(["b110", "b130", "b140", "b150"]);
  });
});
