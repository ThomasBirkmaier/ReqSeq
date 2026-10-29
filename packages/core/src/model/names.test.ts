// How outputs name the elements they give by UUID only (#588, `names`), on fixtures/enabler-305/identifiers:
// N-001 (need), SR-036 and SR-037 (system requirements, SR-037 derived from SR-036), D-047 (decision);
// every type has the property `spec-id` with the meaning identifier.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { NameContext } from "./names.js";
import { namesField, namesOf, namesOfRecords } from "./names.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";

const P = "30500000-0000-4000-8000-0000000";
const N1 = `${P}a0001`;
const S36 = `${P}b0036`;
const S37 = `${P}b0037`;
const UNKNOWN = "30500000-0000-4000-8000-00000000ffff";

const context = async (): Promise<NameContext> => {
  const ws = await createFixtureWorkspace({ fixture: "enabler-305/identifiers" });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  const [metamodel, store, shortIds] = await Promise.all([
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  return { metamodel, store, shortIds };
};

describe("names of elements given by UUID (#588)", () => {
  it("names each UUID once by short ID, identifier and title, in the order asked, without UUIDs not in the store", async () => {
    const names = namesOf(await context(), [S37, UNKNOWN, N1, S37]);
    expect(names).toEqual([
      {
        id: S37,
        repository: "spec",
        shortId: "SR-0b0037",
        identifier: "SR-037",
        title: "Show identifiers next to short IDs",
      },
      {
        id: N1,
        repository: "spec",
        shortId: "N-0a0001",
        identifier: "N-001",
        title: "Name elements by their spec ID",
      },
    ]);
  });

  it("names a record without identifier by short ID and title, and one without a text title with an empty title", async () => {
    const ctx = await context();
    const record = ctx.store.byId.get(S36)?.[0];
    if (record === undefined) {
      throw new Error("SR-036 is in the fixture");
    }
    const plain = { ...record, data: { ...record.data, "spec-id": undefined, title: 36 } };
    expect(namesOfRecords(ctx, [plain, record])).toEqual([
      { id: S36, repository: "spec", shortId: "SR-0b0036", title: "" },
    ]);
  });

  it("namesField leaves out an empty list", () => {
    const name = { id: S36, repository: "spec", shortId: "SR-0b0036", title: "T" };
    expect([namesField([]), namesField([name])]).toEqual([{}, { names: [name] }]);
  });
});
