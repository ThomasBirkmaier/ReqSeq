// element.searchFields (SR-216 AK3) on fixtures/SR-216/fields, with a metamodel that has the cases
// AK2 and AK3 name: an inherited property, a choice, a property of kind relation, a property keyed
// like a fixed field, a type without elements and a title property with its own key and name.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.searchFields">;

const METAMODEL = `reqseq-metamodel: 1
types:
  - { key: base, name: Base, prefix: B, abstract: true, properties: [name, rationale, text] }
  - key: system-requirement
    name: System Requirement
    prefix: SR
    extends: base
    properties: [satisfies, priority, acceptance-criteria]
  - { key: component, name: Component, prefix: CMP, properties: [vendor] }
properties:
  - { key: vendor, name: Vendor, kind: text }
  - { key: acceptance-criteria, name: Acceptance Criteria, kind: text, many: true }
  - { key: text, name: Text property, kind: text }
  - { key: name, name: Name, kind: text, meaning: title }
  - { key: satisfies, name: Satisfies, kind: relation, many: true }
  - { key: priority, name: Priority, kind: choice, choices: [{ key: high, name: High }] }
  - { key: rationale, name: Rationale, kind: text }
relations:
  - { key: derives-from, name: Derives from, inverse-name: Derived by, meaning: derivation }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: approved, name: Approved }
`;

const FIELDS: FixtureOptions = {
  fixture: "SR-216/fields",
  files: { "metamodel/model.yaml": METAMODEL },
};

const open = async (options: FixtureOptions): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const fieldsOf = async (workspace: Workspace): Promise<Output["fields"]> =>
  ((await invoke("element.searchFields", {}, { workspace })) as Output).fields;

describe("element.searchFields", () => {
  it("[SR-216/AK-s99w] lists the fixed fields, then each property a type of the elements has, in metamodel order", async () => {
    const workspace = await open(FIELDS);
    const fields = await fieldsOf(workspace);
    // Not listed: `vendor` (only the type component has it, and no element is one), `text` (the key of
    // a fixed field), `name` (the title), `satisfies` (holds relations).
    expect(fields).toEqual([
      { key: "title", name: "Name" },
      { key: "text", name: "Text" },
      { key: "id", name: "IDs" },
      { key: "properties", name: "All properties" },
      { key: "acceptance-criteria", name: "Acceptance Criteria" },
      { key: "priority", name: "Priority" },
      { key: "rationale", name: "Rationale" },
    ]);
    // Asked again on the same store: the same answer (its types are kept per store).
    expect(await fieldsOf(workspace)).toEqual(fields);
  });

  it("[SR-216/AK-s99w] lists a property once an element of a type that has it exists, and every listed key is searchable", async () => {
    const workspace = await open({
      ...FIELDS,
      files: {
        ...FIELDS.files,
        "requirements/CMP-0000000000c3.md":
          "---\nid: 21600000-0000-4000-8000-0000000000c3\ntype: component\ntitle: Vane\nvendor: Gale Works\n---\n",
      },
    });
    const fields = await fieldsOf(workspace);
    expect(fields.map(({ key }) => key)).toEqual([
      "title",
      "text",
      "id",
      "properties",
      "vendor",
      "acceptance-criteria",
      "priority",
      "rationale",
    ]);
    const output = (await invoke(
      "element.search",
      { query: "gale", fields: fields.map(({ key }) => key) },
      { workspace },
    )) as CommandOutput<"element.search">;
    expect(output.hits.map((hit) => hit.shortId)).toEqual(["CMP-0000c3"]);
  });

  it("names the title field Title without a title property (SR-013 AK3)", async () => {
    const workspace = await open({
      ...FIELDS,
      files: { "metamodel/model.yaml": METAMODEL.replace(", meaning: title", "") },
    });
    expect((await fieldsOf(workspace)).slice(0, 2)).toEqual([
      { key: "title", name: "Title" },
      { key: "text", name: "Text" },
    ]);
  });
});
