import type { DataExportElement } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { elementBuffer, graphBuffer, listBuffer, overviewBuffer, searchBuffer } from "./buffers.js";
import { INCOMPLETE, bufferView, selectedRow, shownElement, workspaceView } from "./modeline.js";

describe("workspaceView", () => {
  it("shows the name, and read-only, errors and warnings only when there are any", () => {
    expect(workspaceView({ ok: true, output: { name: "Weather station", readOnly: false } })).toEqual({
      name: "Weather station",
      marks: [],
      message: "",
    });
    expect(
      workspaceView({
        ok: true,
        output: {
          name: "Weather station",
          readOnly: true,
          problems: [
            { severity: "error" },
            { severity: "warning" },
            { severity: "warning" },
            { severity: "info" },
          ],
        },
      }),
    ).toEqual({ name: "Weather station", marks: ["read-only", "1 error", "2 warnings"], message: "" });
    expect(
      workspaceView({
        ok: true,
        output: { name: "W", readOnly: false, problems: [{ severity: "error" }, { severity: "error" }] },
      }).marks,
    ).toEqual(["2 errors"]);
  });

  it("shows no workspace, and the error message in the minibuffer", () => {
    expect(
      workspaceView({
        ok: false,
        error: { code: "workspace.not-found", message: "No workspace file in /x" },
      }),
    ).toEqual({ name: undefined, marks: [], message: "No workspace file in /x" });
  });
});

describe("bufferView", () => {
  const element = (extra: object = {}) =>
    ({
      id: "u",
      shortId: "SR-000001",
      type: "system-requirement",
      title: "T",
      repository: "spec",
      file: "f.md",
      properties: {},
      relations: [],
      ...extra,
    }) as DataExportElement;

  it("shows the identifier, type and status of an element, and only the marks that apply", () => {
    const buffer = elementBuffer("u", "spec", "SR-036 T");
    expect(
      bufferView(buffer, { kind: "element", element: element({ identifier: "SR-036", status: "draft" }) }),
    ).toEqual(["SR-036 · system-requirement · draft"]);
    expect(bufferView(buffer, { kind: "element", element: element() })).toEqual([
      "SR-000001 · system-requirement",
    ]);
    expect(
      bufferView(buffer, {
        kind: "element",
        element: element({
          status: "draft",
          readOnly: true,
          relations: [
            {
              kind: "k",
              direction: "out",
              id: "a",
              accessible: true,
              targetState: "available",
              outdated: true,
            },
            {
              kind: "k",
              direction: "out",
              id: "b",
              accessible: true,
              targetState: "available",
              outdated: false,
            },
            { kind: "k", direction: "out", id: "c", accessible: true, targetState: "available" },
          ],
          problems: [{ code: "relation.outdated" }, { code: "x" }, { code: "y" }],
        }),
      }),
    ).toEqual(["SR-000001 · system-requirement · draft", "read-only", "1 outdated", "2 hints"]);
    expect(
      bufferView(buffer, { kind: "element", element: element({ problems: [{ code: "x" }] }) }).at(-1),
    ).toBe("1 hint");
  });

  it("[SR-114/AK2] names the number of outdated references and of open hints as element.get gives them, each only when there are any, an outdated one not again as a hint", () => {
    const buffer = elementBuffer("u", "spec", "SR-036 T");
    const parts = (problems: readonly object[], extra: object = {}): string[] =>
      bufferView(buffer, { kind: "element", element: element({ status: "draft", problems, ...extra }) });
    // `element.get` gives every outdated relation and inline reference as a hint `relation.outdated`.
    const inline = {
      code: "relation.outdated",
      hintId: "spec/u/@text/0123456789abcdef?target=t&repository=spec",
      targetId: "t",
      storedVersion: "1",
    };
    const relation = { code: "relation.outdated", hintId: "spec/u/based-on/t?target=t", targetId: "t" };
    const cycle = { code: "relation.cycle" };
    const superseded = { code: "element.superseded-target" };
    expect(parts([])).toEqual(["SR-000001 · system-requirement · draft"]);
    expect(parts([inline])).toEqual(["SR-000001 · system-requirement · draft", "1 outdated"]);
    expect(parts([inline, relation, cycle])).toEqual([
      "SR-000001 · system-requirement · draft",
      "2 outdated",
      "1 hint",
    ]);
    expect(parts([cycle, superseded])).toEqual(["SR-000001 · system-requirement · draft", "2 hints"]);
    // Nothing without hints, whatever a relation of another command's output would say.
    expect(
      parts([], {
        relations: [
          {
            kind: "k",
            direction: "out",
            id: "a",
            accessible: true,
            targetState: "available",
            outdated: true,
          },
        ],
      }),
    ).toEqual(["SR-000001 · system-requirement · draft"]);
  });

  it("[SR-114/AK3] names a list by its name with the number of its elements, a graph with its number of nodes, a package page with its type and the number of its elements", () => {
    expect(
      bufferView(listBuffer("type: need", { where: { type: ["need"] } }), {
        kind: "list",
        total: 14,
        incomplete: false,
      }),
    ).toEqual(["type: need", "14 elements"]);
    expect(
      bufferView(graphBuffer("u", "spec", "SR-036 T"), {
        kind: "graph",
        nodes: 3,
        truncated: false,
        incomplete: false,
      }),
    ).toEqual(["Graph: SR-036 T", "1 level", "3 nodes"]);
    const names = new Map([["package", "Package"]]);
    const page = elementBuffer("p", "spec", "PKG-1 Stufe-3");
    const pkg = element({ shortId: "PKG-1", type: "package", status: "draft" });
    expect(
      bufferView(page, { kind: "element", element: pkg, members: { total: 37, incomplete: false } }, names),
    ).toEqual(["PKG-1 · Package · draft", "37 elements"]);
    expect(
      bufferView(
        page,
        { kind: "element", element: pkg, members: { total: 1, incomplete: true }, modified: true },
        names,
      ),
    ).toEqual(["PKG-1 · Package · draft", "1 element", INCOMPLETE, "modified"]);
    expect(
      bufferView(page, { kind: "element", element: pkg, members: { total: 0, incomplete: false } }, names),
    ).toEqual(["PKG-1 · Package · draft", "0 elements"]);
    // While its elements load, and for any other element, no count.
    expect(bufferView(page, { kind: "element", element: pkg }, names)).toEqual(["PKG-1 · Package · draft"]);
  });

  it("[SR-114/AK1] names the short ID or identifier, the type by its metamodel name and the status of an element", () => {
    const buffer = elementBuffer("u", "spec", "SR-036 T");
    const names = new Map([["system-requirement", "System Requirement"]]);
    expect(
      bufferView(
        buffer,
        { kind: "element", element: element({ identifier: "SR-036", status: "draft" }) },
        names,
      ),
    ).toEqual(["SR-036 · System Requirement · draft"]);
    expect(bufferView(buffer, { kind: "element", element: element() }, names)).toEqual([
      "SR-000001 · System Requirement",
    ]);
    // A type the metamodel does not name shows its key.
    expect(bufferView(buffer, { kind: "element", element: element({ type: "need" }) }, names)).toEqual([
      "SR-000001 · need",
    ]);
  });

  it("[SR-118/AK1] names the overview with the number of all elements, and says when the counts are partial", () => {
    const overview = overviewBuffer();
    expect(bufferView(overview, undefined)).toEqual(["Overview"]);
    expect(bufferView(overview, { kind: "overview", total: 14, incomplete: false })).toEqual([
      "Overview",
      "14 elements",
    ]);
    expect(bufferView(overview, { kind: "overview", total: 1, incomplete: true })).toEqual([
      "Overview",
      "1 element",
      "incomplete: a repository is missing",
    ]);
  });

  it("shows that the text has unsaved changes, after the status", () => {
    const buffer = elementBuffer("u", "spec", "SR-036 T");
    expect(
      bufferView(buffer, {
        kind: "element",
        element: element({ status: "draft", readOnly: false }),
        modified: true,
      }),
    ).toEqual(["SR-000001 · system-requirement · draft", "modified"]);
    expect(bufferView(buffer, { kind: "element", element: element(), modified: false })).toEqual([
      "SR-000001 · system-requirement",
    ]);
  });

  it("[SR-106/AK2] [SR-106/AK3] says that the file changed or is gone on disk, after the counts", () => {
    const buffer = elementBuffer("u", "spec", "SR-036 T");
    const hinted = element({ problems: [{ code: "x" }] });
    expect(bufferView(buffer, { kind: "element", element: hinted, modified: true, disk: "changed" })).toEqual(
      ["SR-000001 · system-requirement", "modified", "1 hint", "changed on disk"],
    );
    expect(bufferView(buffer, { kind: "element", element: element(), disk: "deleted" })).toEqual([
      "SR-000001 · system-requirement",
      "deleted on disk",
    ]);
  });

  it("says not saved when the last save of the input failed, after the counts", () => {
    const buffer = elementBuffer("u", "spec", "SR-036 T");
    expect(
      bufferView(buffer, { kind: "element", element: element(), modified: true, notSaved: true }),
    ).toEqual(["SR-000001 · system-requirement", "modified", "not saved"]);
  });

  it("names the buffer before it has loaded", () => {
    expect(bufferView(elementBuffer("u", "spec", "SR-036 T"), undefined)).toEqual(["SR-036 T"]);
    expect(bufferView(listBuffer("All elements"), undefined)).toEqual(["All elements"]);
  });

  it("shows the count of a list or a search, and that a result is incomplete", () => {
    expect(bufferView(listBuffer("All elements"), { kind: "list", total: 14, incomplete: false })).toEqual([
      "All elements",
      "14 elements",
    ]);
    expect(
      bufferView(listBuffer("type: need", undefined, [{ by: "hierarchy", order: "asc" }]), {
        kind: "list",
        total: 1,
        incomplete: true,
      }),
    ).toEqual(["type: need · tree", "1 element", "incomplete: a repository is missing"]);
    expect(bufferView(searchBuffer("wind"), { kind: "search", total: 1, incomplete: false })).toEqual([
      "Search: wind",
      "1 hit",
    ]);
    expect(bufferView(searchBuffer("wind"), { kind: "search", total: 0, incomplete: false })).toEqual([
      "Search: wind",
      "0 hits",
    ]);
  });
});

describe("selectedRow", () => {
  const rows = [elementBuffer("uuid-1", "spec", "SR-1 One"), elementBuffer("uuid-2", "spec", "SR-2 Two")];
  const data = (kind: "list" | "search", given = rows) => ({
    kind,
    total: 2,
    incomplete: false,
    rows: given,
  });

  it("is the element of the selected row of the shown list or search, the last one past the end", () => {
    const list = { ...listBuffer("All elements"), cursor: 1 };
    expect(selectedRow(list, { key: list.key, data: data("list") })).toBe(rows[1]);
    const search = { ...searchBuffer("two"), cursor: 5 };
    expect(selectedRow(search, { key: search.key, data: data("search") })).toBe(rows[1]);
  });

  it("is undefined for another buffer, data of another buffer or kind, or no rows", () => {
    const list = listBuffer("All elements");
    expect(selectedRow(undefined, undefined)).toBeUndefined();
    expect(selectedRow(list, undefined)).toBeUndefined();
    expect(selectedRow(list, { key: "other", data: data("list") })).toBeUndefined();
    expect(selectedRow(list, { key: list.key, data: data("search") })).toBeUndefined();
    expect(selectedRow(list, { key: list.key, data: data("list", []) })).toBeUndefined();
    expect(
      selectedRow(list, { key: list.key, data: { kind: "list", total: 0, incomplete: false } }),
    ).toBeUndefined();
    const element = elementBuffer("uuid-1", "spec", "SR-1 One");
    expect(selectedRow(element, { key: element.key, data: data("list") })).toBeUndefined();
  });

  it("is undefined while no row of a fresh list is selected (SR-122)", () => {
    const list = listBuffer("All elements");
    expect(selectedRow(list, { key: list.key, data: data("list") })).toBeUndefined();
  });
});

describe("shownElement", () => {
  const element = {
    id: "u1",
    shortId: "SR-000001",
    relations: [],
    properties: {},
  } as unknown as DataExportElement;
  const buffer = elementBuffer("u1", "spec", "SR-000001 T");

  it("[SR-128/AK1] is the element that the shown element buffer has loaded, and none otherwise", () => {
    expect(shownElement(buffer, { key: buffer.key, data: { kind: "element", element } })).toBe(element);
    // A list, nothing loaded yet, another buffer's data, no buffer at all.
    const data = { kind: "list", total: 1, incomplete: false } as const;
    expect(
      shownElement(listBuffer("All elements"), { key: listBuffer("All elements").key, data }),
    ).toBeUndefined();
    expect(shownElement(buffer, { key: buffer.key, data: undefined })).toBeUndefined();
    expect(shownElement(buffer, undefined)).toBeUndefined();
    expect(shownElement(buffer, { key: "another", data: { kind: "element", element } })).toBeUndefined();
    expect(shownElement(undefined, undefined)).toBeUndefined();
  });
});
