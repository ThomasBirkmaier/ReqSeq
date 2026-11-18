// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@reqseq/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { ElementBuffer } from "./buffers.js";
import { nth } from "./lists.js";
import { DEFAULT_SORT, elementBuffer } from "./buffers.js";
import type { PackageModel } from "./package-page.js";
import {
  asCall,
  click,
  container,
  fakeCall,
  press,
  query,
  renewRoot,
  root,
  row,
  rowsOf,
  texts,
} from "./components.test-helper.js";
import { editorView, mount, read } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("a package page (SR-112)", () => {
    const model: PackageModel = { types: new Set(["package"]), key: "packages" };
    const page = (extra: Partial<DataExportElement> = {}) =>
      read({ type: "package", title: "Stufe-3", relations: [], ...extra });
    const members = (elements = rowsOf(1, 4), total = elements.length, incomplete = false) => ({
      elements,
      total,
      incomplete,
    });
    const packageBuffer = (extra: Partial<ElementBuffer> = {}): ElementBuffer => ({
      ...elementBuffer("uuid-1", "spec", "PKG-0000d1 Stufe-3"),
      ...extra,
    });

    it("[SR-112/AK-fzbz] shows below its title and text the elements that name the package, as asked of element.list by its UUID", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page({ text: "The third stage" }) }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      expect(call).toHaveBeenCalledWith("element.list", {
        selection: { where: { package: "uuid-1" } },
        sort: DEFAULT_SORT,
        limit: 200,
        offset: 0,
      });
      const article = query("article");
      const order = [...article.querySelectorAll("h1, .cm-editor, .members h2, .members .row")].map(
        (found) =>
          found.tagName.toLowerCase() +
          (found.className === "" ? "" : `.${found.className.split(" ")[0] ?? ""}`),
      );
      expect(order).toEqual(["h1", "div.cm-editor", "h2", "div.row", "div.row", "div.row"]);
      expect(query(".members h2").textContent).toBe("← packages 3");
      expect(texts(".members .row .title")).toEqual(["Title 1", "Title 2", "Title 3"]);
      expect(query(".members").hasAttribute("hidden")).toBe(false);
    });

    it("[SR-112/AK-fzbz] asks once, and moving through the elements asks for nothing more", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      const { dispatched } = await mount(asCall(call), 0, undefined, { packages: model });
      const asked = (): number => call.mock.calls.filter(([name]) => name === "element.list").length;
      expect(asked()).toBe(1);
      for (let n = 0; n < 3; n += 1) {
        await press(query(".members .list"), "ArrowDown");
      }
      // The row is the one of the element buffer: the app keeps it as `memberCursor`. The page is named
      // otherwise than the buffer this test opens, so the read renames it as well (#273).
      const cursors = dispatched.filter((action) => action.type === "cursor");
      expect(cursors).toHaveLength(3);
      expect(cursors[0]).toEqual({ type: "cursor", key: "element:spec:uuid-1", cursor: 1 });
      expect(asked()).toBe(1);
    });

    it("[SR-114/AK-bcv4] reports the element with the count of its elements for the modeline, once they are there", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(rowsOf(1, 4), 3, true),
      });
      const { data } = await mount(asCall(call), 0, undefined, { packages: model });
      // The buffer still reports the element; the count comes with it when the list has it.
      expect(data.map(([, loaded]) => loaded?.kind)).toEqual([undefined, "element", "element"]);
      expect(data.map(([, loaded]) => (loaded?.kind === "element" ? loaded.members : undefined))).toEqual([
        undefined,
        undefined,
        { total: 3, incomplete: true },
      ]);
    });

    it("[SR-114/AK-bcv4] reports no count for an element that is no package", async () => {
      const call = fakeCall({ "element.get": () => ({ element: page({ type: "need" }) }) });
      const { data } = await mount(asCall(call), 0, undefined, { packages: model });
      expect(data.map(([, loaded]) => loaded?.kind)).toEqual([undefined, "element"]);
      expect(data.every(([, loaded]) => loaded?.kind !== "element" || loaded.members === undefined)).toBe(
        true,
      );
    });

    it("opens an element of the package on Enter, and a row that is clicked", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      const { dispatched } = await mount(asCall(call), 0, undefined, { packages: model });
      await press(query(".members .list"), "Enter");
      expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { kind: "element", id: "uuid-1" } });
      await click(nth([...container.querySelectorAll(".members .row")], 2));
      expect(dispatched.slice(-2)).toMatchObject([
        { type: "cursor", cursor: 2 },
        { type: "open", buffer: { kind: "element", id: "uuid-3" } },
      ]);
    });

    it("[SR-112/AK-fzbz] asks for no elements when the element is no package, or when the metamodel has no package", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: read() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      expect(call.mock.calls.map(([name]) => name)).toEqual([
        "element.get",
        "trace.neighbourhood",
        "element.facets",
      ]);
      expect(container.querySelector(".members")).toBeNull();
      // Down on an element that has no elements to go into goes to its first field (SR-155, #552).
      const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      await act(async () => {
        query("article").dispatchEvent(down);
        await Promise.resolve();
      });
      expect(down.defaultPrevented).toBe(true);
      expect((document.activeElement as HTMLElement | null)?.dataset["field"]).toBe("Title");
      // Ctrl+N on the element does the same.
      query("article").focus();
      const next = new KeyboardEvent("keydown", { key: "n", ctrlKey: true, bubbles: true, cancelable: true });
      await act(async () => {
        query("article").dispatchEvent(next);
        await Promise.resolve();
      });
      expect(next.defaultPrevented).toBe(true);
      expect((document.activeElement as HTMLElement | null)?.dataset["field"]).toBe("Title");
      act(() => {
        root.unmount();
      });
      renewRoot();
      const pkg = fakeCall({ "element.get": () => ({ element: page() }), "element.list": () => members() });
      await mount(asCall(pkg));
      expect(pkg.mock.calls.map(([name]) => name)).toEqual([
        "element.get",
        "trace.neighbourhood",
        "element.facets",
      ]);
    });

    it("shows no heading and nothing to select when no element names the package", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members([], 0),
      });
      const { controls } = await mount(asCall(call), 0, undefined, { packages: model });
      expect(query(".members").hasAttribute("hidden")).toBe(true);
      expect(container.querySelector(".members h2")).toBeNull();
      expect(container.querySelector(".members .row")).toBeNull();
      expect(controls().members).toBe(true);
      // No elements to go into: Down goes to the first field of the page (SR-155, #552).
      const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      await act(async () => {
        query("article").dispatchEvent(down);
        await Promise.resolve();
      });
      expect(down.defaultPrevented).toBe(true);
      expect((document.activeElement as HTMLElement | null)?.dataset["field"]).toBe("Title");
    });

    it("says that a repository is missing in the count, and how the elements are sorted", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(rowsOf(1, 3), 2, true),
      });
      await mount(asCall(call), 0, undefined, {
        packages: model,
        buffer: packageBuffer({ memberSort: [{ by: "hierarchy", order: "asc" }] }),
      });
      expect(query(".members h2").textContent).toBe(
        "← packages 2 · incomplete: a repository is missing · tree",
      );
      expect(call).toHaveBeenCalledWith("element.list", {
        selection: { where: { package: "uuid-1" } },
        sort: [{ by: "hierarchy", order: "asc" }],
        limit: 200,
        offset: 0,
      });
    });

    it("shows why the elements could not be asked for, and echoes it", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => new Error("The reference matches several elements"),
      });
      const { echoed } = await mount(asCall(call), 0, undefined, { packages: model });
      expect(query(".members .quiet").textContent).toBe("The reference matches several elements");
      expect(echoed).toEqual(["The reference matches several elements"]);
      expect(container.querySelector(".members h2")).toBeNull();
    });

    it("Down on a focused box of the page goes into the elements as well", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page({ properties: { topic: "Wind" } }) }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      await act(async () => {
        query('[data-field="topic"]').focus();
        await Promise.resolve();
      });
      await press(query('[data-field="topic"]'), "ArrowDown");
      expect(document.activeElement).toBe(query(".members .list"));
    });

    it("Down on the page itself goes into the elements, Escape and Up on the first row come back; Enter still edits", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      const article = query("article");
      article.focus();
      const modified = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        article.dispatchEvent(modified);
        await Promise.resolve();
      });
      expect(modified.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(article);
      await press(article, "ArrowDown");
      expect(document.activeElement).toBe(query(".members .list"));
      await press(query(".members .list"), "ArrowUp");
      expect(document.activeElement).toBe(article);
      await press(article, "ArrowDown");
      await press(query(".members .list"), "Escape");
      expect(document.activeElement).toBe(article);
      // A key of the list does not reach the page's own handling.
      await press(query(".members .row"), "ArrowDown");
      expect(document.activeElement).toBe(article);
      await press(article, "Enter");
      expect(editorView().hasFocus).toBe(true);
    });

    it("comes back to the elements with the focus when the reader used them before", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, {
        packages: model,
        buffer: packageBuffer({ memberCursor: 2 }),
      });
      expect(document.activeElement).toBe(query(".members .list"));
      expect(query('.members [aria-selected="true"]').id).toBe("row-2");
    });

    it("keeps the focus on the page when the reader has not used the elements before", async () => {
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(),
      });
      await mount(asCall(call), 0, undefined, { packages: model });
      expect(document.activeElement).not.toBe(query(".members .list"));
    });

    it("[SR-112/AK-fzbz] asks for the elements again when the workspace changed, and keeps them until the answer", async () => {
      let names = ["Title 1", "Title 2", "Title 3"];
      const call = fakeCall({
        "element.get": () => ({ element: page() }),
        "element.list": () => members(names.map((_, at) => row(at + 1))),
      });
      const { again } = await mount(asCall(call), 0, undefined, { packages: model });
      names = ["Title 1"];
      await again(1);
      expect(call.mock.calls.filter(([name]) => name === "element.list")).toHaveLength(2);
      expect(texts(".members .row .title")).toEqual(["Title 1"]);
      expect(query(".members h2").textContent).toBe("← packages 1");
    });
  });
});
