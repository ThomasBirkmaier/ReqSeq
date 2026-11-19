// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SORT } from "./buffers.js";
import type { Handler } from "./App.test-helper.js";
import {
  fakeBridge,
  row,
  STATUS,
  NO_WORKSPACE,
  workspace,
  container,
  root,
  flushUntil,
  render,
  text,
  shownAll,
  shownOne,
  query,
  keyDown,
  type,
  click,
  runCommand,
  listAll,
  texts,
  calls,
  renewRoot,
} from "./App.test-helper.js";

describe("App, the overview (SR-118)", () => {
  const options = (): string[] => [...shownAll('[role="option"]')].map((option) => option.textContent);
  const TWO_TYPES = {
    total: 5,
    types: [
      { key: "need", name: "Need", count: 2 },
      { key: "system-requirement", name: "System Requirement", count: 3 },
    ],
    statuses: [{ key: "draft", count: 5 }],
    properties: [],
    incomplete: false,
  };
  const twoTypes = (): Record<string, Handler> => ({ ...workspace(), "element.facets": () => TWO_TYPES });
  const KEY = (name = STATUS.name): string => `reqseq.recent.v1\n${name}`;
  const seed = (entries: object[]): void => {
    window.localStorage.setItem(KEY(), JSON.stringify(entries));
  };
  const known = (n: number) => ({ id: `uuid-${String(n)}`, repository: "spec" });

  it("[SR-118/AK-yggg] the first buffer of an opened workspace is the overview, one line per type with its count", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    expect(options()).toEqual(["Need 2", "System Requirement 3"]);
    expect(calls(invoke, "element.facets")).toEqual([{}]);
    expect(text("Modeline")).toBe("Overview5 elementsWeather stationread-only");
    expect(document.activeElement).toBe(query('[role="listbox"]'));
    // No heading and no empty line for the recent elements before one was opened (D-062).
    expect(shownOne(".group")).toBeNull();
  });

  it("[SR-118/AK-yggg] below the types the overview shows at most five recently opened elements, newest first", async () => {
    seed([1, 2, 3, 4, 5, 6, 7].map(known));
    const handlers = twoTypes();
    const list = handlers["element.list"];
    // The element of the second entry is gone, so its row is left out silently.
    handlers["element.list"] = (input) =>
      ((input["selection"] as { ids?: string[] } | undefined)?.ids ?? []).includes("uuid-2")
        ? Object.assign(new Error("gone"), { code: "ref.unknown" })
        : list?.(input);
    const { bridge } = fakeBridge(handlers);
    await render(bridge);
    expect(options()).toEqual([
      "Need 2",
      "System Requirement 3",
      "SR-000001Title 1",
      "SR-000003Title 3",
      "SR-000004Title 4",
      "SR-000005Title 5",
      "SR-000006Title 6",
    ]);
    expect(query(".group").textContent).toBe("Recent");
    expect(text("Minibuffer")).toBe("");
  });

  it("[SR-118/AK-yggg] remembers the elements that were shown, newest first, and shows them again on the overview", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("list all elements");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show overview");
    expect(options()).toEqual(["Need 2", "System Requirement 3", "SR-000002Title 2", "SR-000001Title 1"]);
    // Only the UUID and the repository are kept, under the key of the workspace.
    expect(JSON.parse(window.localStorage.getItem(KEY()) ?? "null")).toEqual([known(2), known(1)]);
    // The counts of the workspace are not asked for again when nothing changed; each element shown asks
    // for the facets of its own values (SR-132), with its ID.
    const counts = calls(invoke, "element.facets").filter(
      (input) => typeof input !== "object" || input === null || !("selection" in input),
    );
    expect(counts).toHaveLength(1);
  });

  it("[SR-118/AK-yggg] keeps the recent elements for the next start of the app", async () => {
    const first = fakeBridge(twoTypes());
    await render(first.bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    act(() => {
      root.unmount();
    });
    renewRoot();
    await render(fakeBridge(twoTypes()).bridge);
    expect(options().slice(2)).toEqual(["SR-000001Title 1"]);
  });

  it("[SR-118/AK-yggg] keeps the recent elements of each workspace apart, and none for a workspace that failed", async () => {
    seed([known(1)]);
    const { bridge, handlers, change } = fakeBridge(twoTypes());
    await render(bridge);
    expect(options().slice(2)).toEqual(["SR-000001Title 1"]);
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    await change("opened");
    expect(options()).toEqual(["Need 2", "System Requirement 3"]);
    handlers["workspace.status"] = () => NO_WORKSPACE;
    await change("opened");
    expect(shownOne("[data-buffer]")).toBeNull();
  });

  it("[SR-118/AK-yggg] counts again when the workspace changed, and not when the overview is only shown again", async () => {
    const { bridge, invoke, handlers, change } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await runCommand("show overview");
    expect(calls(invoke, "element.facets")).toHaveLength(1);
    handlers["element.facets"] = () => ({
      ...TWO_TYPES,
      total: 6,
      types: [{ key: "need", name: "Need", count: 6 }],
    });
    await change("written");
    expect(calls(invoke, "element.facets")).toHaveLength(2);
    expect(options()).toEqual(["Need 6"]);
    expect(text("Modeline")).toBe("Overview6 elementsWeather stationread-only");
  });

  it("[SR-118/AK-yggg] says when a repository is missing, so that the counts are partial", async () => {
    const handlers = twoTypes();
    handlers["element.facets"] = () => ({ ...TWO_TYPES, incomplete: true });
    await render(fakeBridge(handlers).bridge);
    expect(text("Modeline")).toBe(
      "Overview5 elementsincomplete: a repository is missingWeather stationread-only",
    );
  });

  it("[SR-118/AK-p9z9] Enter on a type line opens the list of the elements of that type", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("type: system-requirement");
    expect(calls(invoke, "element.list")).toEqual([
      {
        selection: { where: { type: ["system-requirement"], subtypes: false } },
        sort: DEFAULT_SORT,
        limit: 200,
        offset: 0,
      },
    ]);
  });

  it("[SR-118/AK-p9z9] a click on a type line opens its list, a click on a recent element the element", async () => {
    seed([known(3)]);
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await click(shownAll('[role="option"]')[0] ?? container);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("type: need");
    // One page of the list, besides the read of the recent element by its UUID.
    expect(
      calls(invoke, "element.list").filter(
        (input) => (input as { selection?: { ids?: unknown } }).selection?.ids === undefined,
      ),
    ).toHaveLength(1);
    await runCommand("show overview");
    await click(shownAll('[role="option"]')[2] ?? container);
    expect(query("article h1").textContent).toBe("Title 3");
  });

  it("[SR-118/AK-jtg3] a perspective line opens the perspective as Open perspective does, and counts as its use", async () => {
    const perspective = (name: string) => ({ name, file: `perspectives/${name}.yaml`, where: { all: [] } });
    const handlers = twoTypes();
    handlers["perspective.list"] = () => ({ perspectives: [perspective("Alpha"), perspective("Zulu")] });
    handlers["element.list"] = (input) =>
      input["perspective"] === "Alpha"
        ? new Error('Perspective "Alpha": its saved filter "Gone" does not exist')
        : { elements: [row(1)], total: 1 };
    const { bridge, invoke } = fakeBridge(handlers);
    await render(bridge);
    await flushUntil(() => options().includes("Zulu 1"));
    expect(options()).toEqual(["Need 2", "System Requirement 3", "Alpha cannot be listed", "Zulu 1"]);
    // Opening one that cannot be listed says why, and opens nothing.
    await click(shownAll('[role="option"]')[2] ?? container);
    expect(text("Minibuffer")).toBe('Perspective "Alpha": its saved filter "Gone" does not exist');
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    await click(shownAll('[role="option"]')[3] ?? container);
    expect(query("[data-buffer] h1").textContent).toContain("Zulu");
    expect(calls(invoke, "element.list")).toContainEqual({
      perspective: "Zulu",
      limit: 1,
      fields: ["identifier"],
    });
    // The prompt of "Open perspective" lists it first now (SR-214 AK1).
    await runCommand("Open perspective");
    expect([...shownAll('.candidates [role="option"] .name')].map((name) => name.textContent)).toEqual([
      "Zulu",
      "Alpha",
    ]);
  });

  it("[SR-118/AK-h5f7] counts each perspective in the view of the window, and again when another view is chosen", async () => {
    const handlers = twoTypes();
    handlers["metamodel.get"] = () => ({
      relations: [],
      types: [{ key: "variant", name: "Variant", meaning: "variant", properties: [] }],
      properties: [],
      statuses: [{ key: "draft" }],
      meanings: {},
    });
    handlers["perspective.list"] = () => ({
      perspectives: [{ name: "Drafts", file: "perspectives/drafts.yaml", where: { status: ["draft"] } }],
    });
    handlers["element.list"] = (input) => {
      const selection = input["selection"] as { view?: string; where?: unknown } | undefined;
      if (input["perspective"] === undefined) {
        return { elements: [{ ...row(9), id: "u-coast", shortId: "VAR-0000c1", title: "Coast" }], total: 1 };
      }
      return { partial: [], total: selection?.view === "u-coast" ? 2 : 5 };
    };
    const { bridge, invoke } = fakeBridge(handlers);
    await render(bridge);
    await flushUntil(() => options().includes("Drafts 5"));
    expect(options()).toEqual(["Need 2", "System Requirement 3", "Drafts 5"]);
    await runCommand("Choose view");
    await type("Coast");
    await keyDown(query("input"), "Enter");
    await flushUntil(() => options().includes("Drafts 2"));
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    expect(options()).toEqual(["Need 2", "System Requirement 3", "Drafts 2"]);
    expect(
      calls(invoke, "element.list").filter(
        (input) => (input as { perspective?: string }).perspective !== undefined,
      ),
    ).toEqual([
      { perspective: "Drafts", limit: 1, fields: ["identifier"], sort: [] },
      { perspective: "Drafts", limit: 1, fields: ["identifier"], sort: [], selection: { view: "u-coast" } },
    ]);
    expect(calls(invoke, "element.facets")).toHaveLength(2);
  });

  it("[SR-118/AK-dr7c] Ctrl+P right after the workspace opened finds a requirement by its short ID or its title", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await keyDown(window, "p", { ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    await type("SR-000002");
    expect(calls(invoke, "element.search")).toEqual([
      { query: "SR-000002", fields: ["id", "title"], limit: 20 },
    ]);
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
    await keyDown(window, "p", { ctrlKey: true });
    await type("Title 2");
    expect(calls(invoke, "element.search").at(-1)).toEqual({
      query: "Title 2",
      fields: ["id", "title"],
      limit: 20,
    });
  });

  it("[SR-118/AK-t1qm] the overview shows no list of all elements and asks for none", async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    expect(calls(invoke, "element.list")).toEqual([]);
    expect(options()).toHaveLength(2);
    expect(shownOne(".row .title")).toBeNull();
  });

  it('[SR-118/AK-t1qm] "List all elements" opens the full list from the overview', async () => {
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    expect(calls(invoke, "element.list")).toEqual([{ sort: DEFAULT_SORT, limit: 200, offset: 0 }]);
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(texts(".row .title")).toEqual(["Title 1", "Title 2", "Title 3"]);
  });

  it("[SR-118/AK-kftg] the recent elements go to the storage of the app, and no write command is called", async () => {
    const setItem = vi.spyOn(window.localStorage, "setItem");
    const { bridge, invoke } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show overview");
    expect(setItem).toHaveBeenCalledWith(KEY(), JSON.stringify([known(1)]));
    const called = new Set(invoke.mock.calls.map(([name]) => name));
    expect(called.size).toBeGreaterThan(3);
    for (const name of called) {
      // One file per catalog command (ADR-0002); core's index cannot load under happy-dom.
      const file = join(import.meta.dirname, `../../../../schemas/commands/${name}.json`);
      expect((JSON.parse(readFileSync(file, "utf8")) as { effect: string }).effect).toBe("read");
    }
  });

  it("does not remember anything, and still works, when the storage of the app cannot be used", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    await render(fakeBridge(twoTypes()).bridge);
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show overview");
    // The element was shown but not remembered in the storage; the overview still has it for this session.
    expect(options()).toEqual(["Need 2", "System Requirement 3", "SR-000001Title 1"]);
  });

  it("echoes why the counts could not be read, and shows no lines", async () => {
    const handlers = twoTypes();
    handlers["element.facets"] = () => new Error("The workspace file is not valid");
    await render(fakeBridge(handlers).bridge);
    expect(text("Minibuffer")).toBe("The workspace file is not valid");
    expect(options()).toEqual([]);
    expect(text("Modeline")).toBe("OverviewWeather stationread-only");
  });

  it("[SR-118/AK-yggg] closing the last buffer shows the overview again; the lone overview cannot be closed", async () => {
    const { bridge } = fakeBridge(twoTypes());
    await render(bridge);
    await listAll();
    await runCommand("close buffer");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    expect(options()).toEqual(["Need 2", "System Requirement 3"]);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    const offered = [...shownAll('[role="option"]')].map((option) => option.textContent);
    expect(offered.some((name) => name.startsWith("Close"))).toBe(false);
    expect(offered.some((name) => name.startsWith("Show overview"))).toBe(false);
  });
});
