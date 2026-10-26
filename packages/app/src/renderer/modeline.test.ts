import type { DataExportElement } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { elementBuffer, listBuffer, searchBuffer } from "./buffers.js";
import { bufferView, workspaceView } from "./modeline.js";

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
    ).toEqual(["SR-036", "system-requirement", "draft"]);
    expect(bufferView(buffer, { kind: "element", element: element() })).toEqual([
      "SR-000001",
      "system-requirement",
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
          problems: [{ code: "x" }, { code: "y" }],
        }),
      }),
    ).toEqual(["SR-000001", "system-requirement", "draft", "read-only", "1 outdated", "2 hints"]);
    expect(
      bufferView(buffer, { kind: "element", element: element({ problems: [{ code: "x" }] }) }).at(-1),
    ).toBe("1 hint");
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
