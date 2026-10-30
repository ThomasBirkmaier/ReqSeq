import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Call } from "./call.js";
import {
  AS_FIELD,
  CORE_VIEW,
  IN_SELECTION,
  inView,
  selectionInView,
  viewMark,
  viewName,
  viewsOf,
  withView,
} from "./views.js";

interface CatalogCommand {
  readonly name: string;
  readonly effect: string;
  readonly arguments: readonly { readonly field: string; readonly complete: string }[];
}

/** The read commands of `catalog.json` whose argument has the source `source`. */
const readsWith = (source: string): string[] => {
  const catalog = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../../../schemas/commands/catalog.json"), "utf8"),
  ) as { readonly commands: readonly CatalogCommand[] };
  return catalog.commands
    .filter(
      (command) => command.effect === "read" && command.arguments.some((arg) => arg.complete === source),
    )
    .map((command) => command.name)
    .sort();
};

const COAST = { view: "43043043-0000-4000-8000-0000000000c1", title: "Coast", shortId: "VAR-0000c1" };

/** A call that answers each command with `answers[name]`, a failure for an Error, and records the inputs. */
const fakeCall = (answers: Record<string, unknown>) => {
  const fn = vi.fn((name: string) => {
    const output = answers[name];
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
  return { call: fn as unknown as Call, fn };
};

describe("the view the window shows (SR-043 AK1)", () => {
  it("puts the view into the selection of the reads that take one there", () => {
    expect(withView("element.list", {}, "core")).toEqual({ selection: { view: "core" } });
    expect(withView("element.search", { query: "rain", selection: { where: { type: ["x"] } } }, "A")).toEqual(
      {
        query: "rain",
        selection: { where: { type: ["x"] }, view: "A" },
      },
    );
  });

  it("puts it into the own field of the trace and evidence reads", () => {
    expect(withView("trace.neighbourhood", { ref: "SR-1" }, "A")).toEqual({ ref: "SR-1", view: "A" });
  });

  it("keeps a view the input names, a selection by ids, and every other command as it is", () => {
    expect(withView("trace.graph", { ref: "SR-1", view: "core" }, "A")).toEqual({
      ref: "SR-1",
      view: "core",
    });
    expect(withView("element.list", { selection: { view: "core" } }, "A")).toEqual({
      selection: { view: "core" },
    });
    expect(withView("element.facets", { selection: { ids: ["SR-1"] } }, "A")).toEqual({
      selection: { ids: ["SR-1"] },
    });
    expect(withView("element.get", { ref: "SR-1" }, "A")).toEqual({ ref: "SR-1" });
    expect(withView("element.bulkUpdate", { selection: {} }, "A")).toEqual({ selection: {} });
  });

  it("takes every read command of the catalog with a selection or a view, but element.get", () => {
    expect(readsWith("selection")).toEqual([...IN_SELECTION].sort());
    expect(readsWith("view")).toEqual([...AS_FIELD, "element.get"].sort());
  });

  it("gives a selection the view unless it names one or ids", () => {
    const where = { where: { type: ["need"] } };
    expect(selectionInView(where, "A")).toEqual({ ...where, view: "A" });
    expect(selectionInView(undefined, "A")).toEqual({ view: "A" });
    const named = { view: "core" };
    const ids = { ids: ["SR-1"] };
    expect([selectionInView(named, "A"), selectionInView(ids, "A")]).toEqual([named, ids]);
  });

  it("calls in the view shown, and without one as it is", async () => {
    const { call, fn } = fakeCall({ "element.list": { elements: [] } });
    expect(inView(call, undefined)).toBe(call);
    await inView(call, COAST)("element.list", {});
    expect(fn).toHaveBeenLastCalledWith("element.list", { selection: { view: COAST.view } });
  });

  it("names the view in the prompt and the modeline", () => {
    expect([viewName(CORE_VIEW), viewName(COAST)]).toEqual(["Core", "VAR-0000c1 Coast"]);
    expect([viewMark(undefined), viewMark(COAST)]).toEqual([undefined, "view: Coast"]);
  });
});

describe("the views of the workspace (#285)", () => {
  const metamodel = {
    types: [
      { key: "system-requirement", meaning: "requirement" },
      { key: "variant", meaning: "variant" },
    ],
  };

  it("lists the core first, then the elements of the variant types", async () => {
    const { call, fn } = fakeCall({
      "metamodel.get": metamodel,
      "element.list": { elements: [{ id: COAST.view, shortId: COAST.shortId, title: "Coast" }] },
    });
    expect(await viewsOf(call)).toEqual({ ok: true, views: [CORE_VIEW, COAST] });
    expect(fn).toHaveBeenLastCalledWith("element.list", {
      selection: { where: { type: ["variant"] } },
      limit: 5000,
    });
  });

  it("gives only the core when the metamodel has no variant type", async () => {
    const { call } = fakeCall({ "metamodel.get": { types: [] } });
    expect(await viewsOf(call)).toEqual({ ok: true, views: [CORE_VIEW] });
  });

  it("says why the views could not be read", async () => {
    expect(await viewsOf(fakeCall({ "metamodel.get": new Error("no metamodel") }).call)).toEqual({
      ok: false,
      message: "no metamodel",
    });
    const listing = fakeCall({ "metamodel.get": metamodel, "element.list": new Error("no list") });
    expect(await viewsOf(listing.call)).toEqual({ ok: false, message: "no list" });
  });
});
