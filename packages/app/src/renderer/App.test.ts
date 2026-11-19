// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CommandListing, InvokeResult, ReqSeqBridge } from "../shared/protocol.js";
import { DEFAULT_SORT } from "./buffers.js";
import {
  SHOWN,
  fakeBridge,
  row,
  link,
  STATUS,
  NO_WORKSPACE,
  workspace,
  root,
  flush,
  render,
  text,
  shownAll,
  shownOne,
  query,
  keyDown,
  pressed,
  type,
  click,
  clickLine,
  allCommands,
  mod,
  runCommand,
  listAll,
  renderList,
  texts,
  calls,
  renewRoot,
} from "./App.test-helper.js";

describe("App", () => {
  it("is a white sheet with the modeline and the minibuffer; empty until the status is there", async () => {
    let answer: (result: InvokeResult) => void = () => undefined;
    const bridge: ReqSeqBridge = {
      invoke: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      commands: () => Promise.resolve([]),
      on: () => () => undefined,
      copyText: () => Promise.resolve(true),
      pasteText: () => Promise.resolve(true),
      recentWorkspaces: () => Promise.resolve([]),
      openWorkspace: () => Promise.resolve({ ok: true }),
      listFolder: () => Promise.resolve({ name: "", entries: [] }),
      onSave: () => () => undefined,
      openDocs: () => Promise.resolve({ ok: true as const }),
      onHelp: () => () => undefined,
    };
    await render(bridge);
    expect(shownOne('main[aria-label="Sheet"]')?.childElementCount).toBe(0);
    expect(text("Modeline")).toBe("");
    expect(text("Minibuffer")).toBe("");
    await act(async () => {
      answer({ ok: true, output: STATUS });
      await Promise.resolve();
    });
    // The overview is asked for; until it answers, the modeline names the buffer.
    expect(text("Modeline")).toBe("OverviewWeather stationread-only");
    expect(document.title).toBe("Weather station - ReqSeq");
  });

  it("on macOS names the window in a title bar strip of the sheet, which has no control; elsewhere has none (ThomasBirkmaier/ReqSeq-archive#490)", async () => {
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { bridge } = fakeBridge({ "workspace.status": () => NO_WORKSPACE });
    await render(bridge);
    expect(query(".titlebar").textContent).toBe("ReqSeq");
    act(() => {
      root.unmount();
    });
    const other = fakeBridge(workspace());
    renewRoot();
    await render(other.bridge);
    const bar = query(".titlebar");
    expect(bar.textContent).toBe("Weather station - ReqSeq");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.querySelector("button, input, a, [tabindex]")).toBeNull();
    act(() => {
      root.unmount();
    });
    platform.mockReturnValue("Linux x86_64");
    renewRoot();
    await render(other.bridge);
    expect(shownOne(".titlebar")).toBeNull();
  });

  it("shows the list of all elements, its count in the modeline, and gives the list the focus", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    expect(calls(invoke, "element.list")).toEqual([{ sort: DEFAULT_SORT, limit: 200, offset: 0 }]);
    expect([...shownAll(".row .title")].map((title) => title.textContent)).toEqual([
      "Title 1",
      "Title 2",
      "Title 3",
    ]);
    expect(text("Modeline")).toBe("All elements3 elementsWeather stationread-only");
    expect(text("Minibuffer")).toBe("");
    expect(document.activeElement).toBe(query('[role="listbox"]'));
  });

  it("opens the documentation from Help, the command prompt and F1 on an entry, and says why when it cannot", async () => {
    const { bridge, openDocs, help } = fakeBridge(workspace());
    bridge.commands = () =>
      Promise.resolve([
        {
          name: "trace.chain",
          title: "Show trace chain",
          effect: "read",
          implemented: true,
          arguments: [],
          input: { type: "object" },
        } as unknown as CommandListing,
        {
          name: "element.list",
          title: "List all elements",
          effect: "read",
          implemented: true,
          arguments: [],
          input: { type: "object" },
        } as unknown as CommandListing,
      ]);
    await render(bridge);
    // Help > ReqSeq Documentation: the start page.
    await help();
    expect(openDocs).toHaveBeenLastCalledWith(undefined);
    expect(text("Minibuffer")).toBe("Opened the documentation in the browser");
    // The action of the command prompt.
    await runCommand("Open documentation");
    expect(openDocs).toHaveBeenLastCalledWith(undefined);
    // F1 on a catalog command: its reference page; the prompt stays open.
    await keyDown(window, "P", { ...mod(), shiftKey: true });
    await type("Show trace chain");
    await keyDown(query("input"), "F1");
    expect(openDocs).toHaveBeenLastCalledWith("trace.chain");
    expect(query("label").textContent).toBe("Command");
    // F1 on an action that covers a command: that command's page; on any other action, the action.
    await type("List all elements");
    await keyDown(query("input"), "F1");
    expect(openDocs).toHaveBeenLastCalledWith("element.list");
    await type("Toggle dark mode");
    await keyDown(query("input"), "F1");
    expect(openDocs).toHaveBeenLastCalledWith("toggle-dark-mode");
    await keyDown(query("input"), "Escape");
    // A delivery without the site: core's message.
    openDocs.mockResolvedValue({ ok: false, message: "No documentation in /opt/reqseq/docs" });
    await help();
    expect(text("Minibuffer")).toBe("No documentation in /opt/reqseq/docs");
  });

  it("says why no workspace is open, and then has no buffer and no shortcut but the command prompt", async () => {
    const { bridge, invoke } = fakeBridge({ "workspace.status": () => NO_WORKSPACE });
    await render(bridge);
    expect(text("Modeline")).toBe("No workspace");
    expect(text("Minibuffer")).toBe(
      "No workspace is open. Press Ctrl+O to choose a folder, or Ctrl+Shift+P for Open workspace.",
    );
    expect(shownOne('[role="listbox"]')).toBeNull();
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(window, "F", { ctrlKey: true, shiftKey: true });
    expect(shownOne("input")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("without a workspace the command prompt opens and offers Open workspace, Open documentation and Connect AI agent only", async () => {
    const { bridge, recentWorkspaces, openWorkspace } = fakeBridge({
      "workspace.status": () => NO_WORKSPACE,
    });
    // A catalog (from an earlier workspace): no command of it can run without one.
    bridge.commands = () =>
      Promise.resolve([
        {
          name: "workspace.status",
          title: "Show workspace status",
          effect: "read",
          implemented: true,
        } as unknown as CommandListing,
      ]);
    recentWorkspaces.mockResolvedValue([
      { root: "/req/buoy", state: "found" },
      { root: "/req/gone", state: "missing" },
    ]);
    await render(bridge);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Command");
    // At most ten commands: all of them, by name, without "All commands…" (SR-133 AK1).
    expect(texts('[role="option"] .name')).toEqual([
      "Connect AI agent",
      "Open documentation",
      "Open workspace",
    ]);
    await keyDown(query("input"), "Escape");
    // A click whose press did not begin on the idle line (a hit taken by its press) asks nothing.
    await click(query(".echo"));
    expect(document.querySelector("input")).toBeNull();
    // A click on the idle line asks for a command too.
    await clickLine();
    expect(texts('[role="option"] .name')).toEqual([
      "Connect AI agent",
      "Open documentation",
      "Open workspace",
    ]);
    await keyDown(query("input"), "ArrowDown");
    await keyDown(query("input"), "ArrowDown");
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("Workspace");
    expect(texts('[role="option"] .name')).toEqual(["/req/buoy", "/req/gone"]);
    expect(texts('[role="option"] .hint')).toEqual(["not found"]);
    await keyDown(query("input"), "ArrowDown");
    await keyDown(query("input"), "Enter");
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(text("Minibuffer")).toBe("/req/gone is not found; no workspace is open");
    // Now in use, "Open workspace" is first.
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await keyDown(query("input"), "Enter");
    await keyDown(query("input"), "Enter");
    expect(openWorkspace).toHaveBeenCalledExactlyOnceWith("/req/buoy");
  });

  it("asks for the catalog again when a workspace opens after a start without one", async () => {
    const { bridge, change, handlers } = fakeBridge({
      ...workspace(),
      "workspace.status": () => NO_WORKSPACE,
    });
    const commands = vi.fn(() => Promise.resolve([] as CommandListing[]));
    bridge.commands = commands;
    await render(bridge);
    expect(commands).toHaveBeenCalledOnce();
    handlers["workspace.status"] = () => STATUS;
    await change("opened");
    expect(commands).toHaveBeenCalledTimes(2);
    // A catalog it has is kept: the commands are the same in every workspace.
    commands.mockResolvedValue([{ name: "workspace.status" } as unknown as CommandListing]);
    await change("opened");
    await change("opened");
    expect(commands).toHaveBeenCalledTimes(3);
    await change("restarted");
    expect(commands).toHaveBeenCalledTimes(3);
  });

  it("opens the command prompt with Ctrl+Shift+P or Cmd+Shift+P, lists what applies and closes it with Escape", async () => {
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Command");
    expect([...shownAll('[role="option"] .name')].map((name) => name.textContent)).toContain("Sort list");
    expect(document.activeElement).toBe(query("input"));
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    expect(document.activeElement).toBe(query('[role="listbox"]'));
    await keyDown(window, "p", { metaKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Command");
  });

  it("[SR-121/AK-ynwj] puts the command chosen for a text first the next time, and keeps that after a restart", async () => {
    const options = (): string[] => texts('[role="option"] .name');
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await type("g");
    // By match both are first, by name (SR-133 AK1).
    expect(options().slice(0, 2)).toEqual(["Go to element or buffer", "Group list"]);
    await keyDown(query("input"), "ArrowDown");
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("Group by");
    await keyDown(query("input"), "Escape");
    // The usage is in the storage of the app, never in a workspace file, and holds no title or text.
    const stored = JSON.parse(window.localStorage.getItem("reqseq.usage.v1") ?? "null") as {
      commands: unknown[][];
      queries: unknown[][];
    };
    expect(stored.queries).toEqual([
      ["g", "group"],
      ["list all elements", "list-all"],
    ]);
    expect(stored.commands.map(([id]) => id)).toEqual(["group", "list-all"]);
    for (const restart of [0, 1]) {
      act(() => {
        root.unmount();
      });
      renewRoot();
      await render(fakeBridge(workspace()).bridge);
      await listAll();
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      await type(restart === 0 ? "g" : " G ");
      expect(options().slice(0, 2)).toEqual(["Group list", "Go to element or buffer"]);
    }
    await type("got");
    expect(options()[0]).toBe("Go to element or buffer");
  });

  it("[SR-108/AK-f6t5] [SR-134/AK-trng] shows the commands in use first when nothing is typed, and records a click as a choice", async () => {
    // Every reading of the clock is a minute later, so that the later choice is the more recent one.
    let clock = Date.UTC(2026, 9, 27);
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 60_000));
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    await clickLine();
    // Not among the first nine without use: from "All commands…".
    expect(texts('[role="option"] .name')).not.toContain("Group list");
    await allCommands();
    const group = [...shownAll('[role="option"]')].find((option) => option.textContent === "Group list");
    await act(async () => {
      group?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(query("label").textContent).toBe("Group by");
    // Escape goes back to the list it was chosen in (SR-134 AK1), and there to the command prompt no more.
    await keyDown(query("input"), "Escape");
    expect(query("label").textContent).toBe("All commands");
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    await clickLine();
    // "List all elements" was chosen before by typing, "Group list" later by a click: both are in use.
    expect(texts('[role="option"] .name').slice(0, 2)).toEqual(["Group list", "List all elements"]);
  });

  it("[SR-134/AK-trng] [SR-134/AK-ykbf] [SR-124/AK-y24h] goes back one step on Escape in a later step, and closes in the first", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    const lists = calls(invoke, "element.list").length;
    await runCommand("filter list");
    expect(query("label").textContent).toBe("Filter by");
    await type("Status");
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("Status");
    // The value: back to the kind, then to the command; nothing filtered the list.
    await keyDown(query("input"), "Escape");
    expect(query("label").textContent).toBe("Filter by");
    await keyDown(query("input"), "Escape");
    expect(query("label").textContent).toBe("Command");
    expect(calls(invoke, "element.list")).toHaveLength(lists);
    // The first step closes: the command prompt, and a prompt a shortcut opened.
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    await keyDown(window, "p", { ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    expect(calls(invoke, "element.list")).toHaveLength(lists);
  });

  it("opens the command prompt with a click on the idle minibuffer", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await clickLine();
    expect(query("label").textContent).toBe("Command");
  });

  it("opens an element from the list, shows it with its modeline, and Ctrl+P Enter goes back with the selection kept", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    // A fresh list has no row selected (SR-122): the first Down selects the first row.
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(calls(invoke, "element.get")).toEqual([{ ref: "uuid-2", repository: "spec" }]);
    expect(query("article h1").textContent).toBe("Title 2");
    expect(text("Modeline")).toBe("SR-000002 · Need · draftWeather stationread-only");
    expect(document.activeElement).toBe(query("article"));
    await keyDown(window, "p", { ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    expect([...shownAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      "All elements",
      "Overview",
    ]);
    await keyDown(query("input"), "Enter");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("All elements");
    expect(query('[aria-selected="true"]').id).toMatch(/_row-1$/);
  });

  it("[SR-114/AK-hqxs] the modeline of an open element names its ID, its type and its status", async () => {
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  it("[SR-104/AK-df5n] shows the filled properties as boxes below the text, the title as its heading, short ID, type and status only in the modeline, no UUID or version, and a relation group per kind, the incoming with ←", async () => {
    const VERSION = "n2:0123456789abcdef";
    const handlers = workspace();
    handlers["element.get"] = () => ({
      element: row(1, {
        version: VERSION,
        text: "Hello",
        properties: { topic: "Wind", rationale: "", source: "  ", statement: [] },
        relations: [
          link("derives-from", "out", 2),
          link("derives-from", "out", 3),
          link("supersedes", "in", 2),
        ],
      }),
    });
    const { bridge } = fakeBridge(handlers);
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    const article = query("article");
    expect(query("article h1").textContent).toBe("Title 1");
    const fields = [...article.querySelectorAll<HTMLElement>("[data-field]")];
    // In this order: the title, the text, the one filled property, then the relation groups.
    expect(fields.map((field) => field.dataset["field"])).toEqual([
      "Title",
      "Text",
      "topic",
      "derives-from",
      "← supersedes",
    ]);
    expect(texts("article .box .key")).toEqual(["topic"]);
    expect(text("Modeline")).toMatch(/^SR-000001 · Need · draft/);
    for (const shown of ["SR-000001", "Need", "draft", "uuid-1", VERSION]) {
      expect([shown, article.textContent.includes(shown)]).toEqual([shown, false]);
    }
    expect(texts("article h2")).toEqual(["derives-from", "← supersedes"]);
    expect(texts('article [data-field="derives-from"] .relation [role="link"]')).toHaveLength(2);
    // The ID of each target stands apart from its title, muted as in a list (#1758).
    expect(texts('article [data-field="derives-from"] .relation [role="link"] .id')).toHaveLength(2);
  });

  it("shows the type key in the modeline when the metamodel cannot be read", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await renderList(bridge);
    handlers["metamodel.get"] = () => new Error("The metamodel is broken");
    await change("opened");
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(text("Modeline")).toBe("SR-000001 · need · draftWeather stationread-only");
    // No workspace: no names either.
    handlers["workspace.status"] = () => NO_WORKSPACE;
    await change("opened");
    expect(text("Modeline")).toBe("No workspace");
  });

  it("jumps to an element that core finds by its title", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "p", { ctrlKey: true });
    await type("title");
    expect(calls(invoke, "element.search")).toEqual([{ query: "title", fields: ["id", "title"], limit: 20 }]);
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
  });

  it("searches with Ctrl+Shift+F and opens a search buffer", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "F", { ctrlKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Search");
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "element.search")).toContainEqual({ query: "title", limit: 50, offset: 0 });
    expect(text("Modeline")).toBe("Search: title1 hitWeather stationread-only");
  });

  it("opens the target of a relation in its repository, without reading it by UUID alone (ThomasBirkmaier/ReqSeq-archive#416)", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await click(query('[role="link"]'));
    const reads = calls(invoke, "element.get");
    expect(reads).toContainEqual({ ref: "uuid-3", repository: "spec" });
    expect(reads).not.toContainEqual({ ref: "uuid-3" });
    expect(query("article h1").textContent).toBe("Title 3");
  });

  it("echoes why the target of a relation cannot be read, and shows it in the opened buffer", async () => {
    const { bridge, handlers } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    const read = handlers["element.get"];
    handlers["element.get"] = (input) =>
      input["ref"] === "uuid-3" ? new Error('The element "uuid-3" is gone') : (read?.(input) ?? {});
    await click(query('[role="link"]'));
    expect(text("Minibuffer")).toBe('The element "uuid-3" is gone');
    expect(query("article .quiet").textContent).toBe('The element "uuid-3" is gone');
    // The element left is drawn hidden in advance beside it (SR-212 AK5).
    expect(shownOne(`${SHOWN} article h1`)).toBeNull();
  });

  it("filters the list by a type through the command prompt", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    await runCommand("filter list");
    expect(query("label").textContent).toBe("Filter by");
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("Type");
    await keyDown(query("input"), "Enter");
    // The type goes into the mark; "Take 1 type" adds the step (SR-124 AK7).
    expect(query("label").textContent).toBe("Type");
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "element.list").at(-1)).toEqual({
      selection: { where: { type: ["need"] } },
      sort: DEFAULT_SORT,
      limit: 200,
      offset: 0,
    });
    expect(text("Modeline")).toBe("type: need3 elementsWeather stationread-only");
    expect(document.activeElement).toBe(query('[role="listbox"]'));
  });

  it("echoes the UUID and the date of the version on request, never the check value", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await runCommand("show element id");
    expect(calls(invoke, "element.get").at(-1)).toEqual({
      ref: "uuid-1",
      repository: "spec",
      versionDate: true,
    });
    expect(text("Minibuffer")).toBe("uuid-1 · version of 2026-10-24T10:00:00Z · spec:f1.md");
  });

  it("clears the last message when a prompt opens", async () => {
    const { bridge, handlers } = fakeBridge(workspace());
    await renderList(bridge);
    handlers["element.facets"] = () => new Error("The facets are not there");
    await runCommand("filter list");
    await type("Status");
    await keyDown(query("input"), "Enter");
    expect(text("Minibuffer")).toBe("The facets are not there");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(text("Minibuffer")).toContain("Command");
    expect(text("Minibuffer")).not.toContain("not there");
  });

  it("asks again for what it shows when files were written or the core process restarted", async () => {
    const { bridge, invoke, change } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(calls(invoke, "element.get")).toHaveLength(1);
    await change("written");
    expect(calls(invoke, "element.get")).toHaveLength(2);
    expect(text("Minibuffer")).toBe("");
    expect(calls(invoke, "workspace.status")).toHaveLength(2);
    await change("restarted");
    expect(calls(invoke, "element.get")).toHaveLength(3);
    expect(text("Minibuffer")).toBe("The background process of the app stopped and was started again.");
    expect(query("article h1").textContent).toBe("Title 1");
  });

  it("starts again with the overview when another workspace is opened, and drops the prompt", async () => {
    const { bridge, invoke, handlers, change } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    await change("opened");
    expect(shownOne("input")).toBeNull();
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
    expect(text("Modeline")).toBe("Overview3 elementsOther");
    expect(document.title).toBe("Other - ReqSeq");
    expect(invoke).toHaveBeenCalled();
  });

  it("[SR-131/AK-cssj] the status of a workspace left while it loaded never overwrites the next one", async () => {
    const { bridge, invoke, change } = fakeBridge(workspace());
    await renderList(bridge);
    // Each status answers when the test says so: the first one opened hangs, the second answers first.
    const answers: ((result: InvokeResult) => void)[] = [];
    const answer = invoke.getMockImplementation();
    invoke.mockImplementation((name, input) =>
      name === "workspace.status"
        ? new Promise((resolve) => {
            answers.push(resolve);
          })
        : (answer?.(name, input) ?? Promise.reject(new Error("no fake"))),
    );
    await change("opened");
    await change("opened");
    expect(answers).toHaveLength(2);
    await act(async () => {
      answers[1]?.({ ok: true, output: { name: "Other", readOnly: false } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(document.title).toBe("Other - ReqSeq");
    // The closed connection of the first answers last, with nothing: the view stays the second one's.
    await act(async () => {
      answers[0]?.({ ok: false, error: { code: "workspace.not-found", message: "closed" } as never });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(document.title).toBe("Other - ReqSeq");
    expect(text("Modeline")).toContain("Other");
    expect(query('[role="listbox"]').getAttribute("aria-label")).toBe("Overview");
  });

  it("shows the overview of another workspace that is opened while the list is shown", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await renderList(bridge);
    expect(text("Modeline")).toBe("All elements3 elementsWeather stationread-only");
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    handlers["element.facets"] = () => ({
      total: 1,
      types: [{ key: "need", name: "Need", count: 1 }],
      statuses: [],
      properties: [],
      incomplete: false,
    });
    await change("opened");
    expect([...shownAll('[role="option"]')].map((option) => option.textContent)).toEqual(["Need 1"]);
    expect(text("Modeline")).toBe("Overview1 elementOther");
  });

  it("does not show the count of the list before a filter when the new list fails", async () => {
    const { bridge, handlers } = fakeBridge(workspace());
    await renderList(bridge);
    expect(text("Modeline")).toContain("3 elements");
    handlers["element.list"] = () => new Error("The metamodel is not valid");
    await runCommand("filter list");
    await keyDown(query("input"), "Enter");
    await keyDown(query("input"), "Enter");
    // "Take 1 type" (SR-124 AK7).
    await keyDown(query("input"), "Enter");
    expect(text("Modeline")).toBe("type: needWeather stationread-only");
  });

  it("empties the sheet when the workspace that was opened is none", async () => {
    const { bridge, handlers, change } = fakeBridge(workspace());
    await render(bridge);
    handlers["workspace.status"] = () => NO_WORKSPACE;
    await change("opened");
    expect(shownOne('[role="listbox"]')).toBeNull();
    expect(text("Modeline")).toBe("No workspace");
    expect(document.title).toBe("ReqSeq");
  });

  it("keeps the buffers and sends nothing more when the core process has stopped for good", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    const { bridge, invoke, handlers, change } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    const before = invoke.mock.calls.length;
    await change("stopped");
    expect(invoke).toHaveBeenCalledTimes(before);
    expect(query("article h1").textContent).toBe("Title 1");
    expect(text("Minibuffer")).toBe(
      "The background process of the app keeps stopping. Press Ctrl+O to open the workspace again.",
    );
    expect(text("Modeline")).toContain("stopped");
    await runCommand("show element id");
    expect(invoke).toHaveBeenCalledTimes(before);
    expect(text("Minibuffer")).toBe(
      "The background process of the app keeps stopping. Press Ctrl+O to open the workspace again.",
    );
    handlers["workspace.status"] = () => ({ name: "Again", readOnly: false });
    await change("opened");
    expect(text("Modeline")).toBe("Overview3 elementsAgain");
  });

  it("stops listening and ignores late answers once it is gone", async () => {
    let answer: (result: InvokeResult) => void = () => undefined;
    const { bridge, listeners } = fakeBridge({});
    bridge.invoke = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    await render(bridge);
    // The workspace's changes, the catalog after a start without a workspace, and the mode „Agent folgen“
    // (SR-117, a restart asks again).
    expect(listeners.size).toBe(3);
    act(() => {
      root.unmount();
    });
    expect(listeners.size).toBe(0);
    answer({ ok: true, output: STATUS });
    await Promise.resolve();
    renewRoot();
  });

  it("ignores the answer about the types that comes after it is gone", async () => {
    let names: (result: InvokeResult) => void = () => undefined;
    const { bridge, invoke } = fakeBridge(workspace());
    bridge.invoke = (name, input) =>
      name === "metamodel.get"
        ? new Promise((resolve) => {
            names = resolve;
          })
        : invoke(name, input as Record<string, unknown>);
    await render(bridge);
    act(() => {
      root.unmount();
    });
    names({
      ok: true,
      output: {
        types: [{ key: "need", name: "Need", properties: [] }],
        properties: [],
        statuses: [],
        meanings: {},
      },
    });
    await Promise.resolve();
    renewRoot();
  });

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "[SR-122/AK-h65p] [SR-145/AK-mk0f] on %s, Ctrl+N and Ctrl+P in an open prompt only move the selection",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const { bridge } = fakeBridge(workspace());
      await render(bridge);
      const selected = (): string | undefined =>
        shownOne('.candidates [aria-selected="true"]')?.textContent ?? undefined;
      // The command prompt: Ctrl+P must not jump.
      await keyDown(window, "P", { ...mod(), shiftKey: true });
      const first = selected();
      await keyDown(query("input"), "n", { ctrlKey: true });
      expect(selected()).not.toBe(first);
      expect(query("label").textContent).toBe("Command");
      await keyDown(query("input"), "p", { ctrlKey: true });
      expect(selected()).toBe(first);
      expect(query("label").textContent).toBe("Command");
      await keyDown(query("input"), "Escape");
      // The jump prompt (Cmd+P under macOS): Ctrl+P in it moves the selection and stays "Go to".
      await keyDown(window, "p", mod());
      expect(query("label").textContent).toBe("Go to");
      await keyDown(query("input"), "p", { ctrlKey: true });
      expect(query("label").textContent).toBe("Go to");
    },
  );

  const PLATFORMS = ["MacIntel", "Win32", "Linux x86_64"];
  const ctrl = { ctrlKey: true };
  /** The id of the selected row of the list or overview, if one is. */
  const selectedRow = (): string | undefined =>
    shownOne('[data-buffer] [aria-selected="true"]')?.id ?? undefined;
  /** The label of the open prompt, if one is. */
  const prompt = (): string | undefined => shownOne("label")?.textContent ?? undefined;

  it("[SR-122/AK-mqwc] Ctrl+N and Ctrl+P walk the overview, the list and the search result like Down and Up; Ctrl+N first selects the first row", async () => {
    const handlers = workspace();
    handlers["element.facets"] = () => ({
      total: 3,
      types: [
        { key: "need", name: "Need", count: 2 },
        { key: "system-requirement", name: "System Requirement", count: 1 },
      ],
      statuses: [],
      properties: [],
      incomplete: false,
    });
    const { bridge } = fakeBridge(handlers);
    await render(bridge);
    const overview = query('[role="listbox"]');
    expect(selectedRow()).toBeUndefined();
    expect(overview.getAttribute("aria-activedescendant")).toBeNull();
    await keyDown(overview, "n", ctrl);
    expect(selectedRow()).toMatch(/_overview-0$/);
    expect(overview.getAttribute("aria-activedescendant")).toMatch(/_overview-0$/);
    await keyDown(overview, "N", ctrl);
    expect(selectedRow()).toMatch(/_overview-1$/);
    await keyDown(overview, "p", ctrl);
    expect(selectedRow()).toMatch(/_overview-0$/);
    await listAll();
    const list = query('[role="listbox"]');
    expect(selectedRow()).toBeUndefined();
    await keyDown(list, "n", ctrl);
    expect(selectedRow()).toMatch(/_row-0$/);
    await keyDown(list, "n", ctrl);
    await keyDown(list, "n", ctrl);
    expect(selectedRow()).toMatch(/_row-2$/);
    expect(list.getAttribute("aria-activedescendant")).toMatch(/_row-2$/);
    await keyDown(list, "p", ctrl);
    expect(selectedRow()).toMatch(/_row-1$/);
    await keyDown(list, "ArrowUp");
    expect(selectedRow()).toMatch(/_row-0$/);
    await keyDown(window, "F", { ctrlKey: true, shiftKey: true });
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(text("Modeline")).toContain("Search: title");
    expect(selectedRow()).toBeUndefined();
    await keyDown(query('[role="listbox"]'), "n", ctrl);
    expect(selectedRow()).toMatch(/_row-0$/);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
  });

  it.each(PLATFORMS)(
    "[SR-122/AK-xm88] [SR-145/AK-mk0f] on %s, with a row selected Ctrl+P only moves the selection, also on the first row; Cmd does not move it",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const { bridge } = fakeBridge(workspace());
      await renderList(bridge);
      const list = query('[role="listbox"]');
      await keyDown(list, "n", ctrl);
      await keyDown(list, "n", ctrl);
      const up = await pressed(list, "p", ctrl);
      expect(up.defaultPrevented).toBe(true);
      expect(selectedRow()).toMatch(/_row-0$/);
      expect(prompt()).toBeUndefined();
      const top = await pressed(list, "p", ctrl);
      expect(top.defaultPrevented).toBe(true);
      expect(selectedRow()).toMatch(/_row-0$/);
      expect(prompt()).toBeUndefined();
      const cmdN = await pressed(list, "n", { metaKey: true });
      expect(cmdN.defaultPrevented).toBe(false);
      expect(selectedRow()).toMatch(/_row-0$/);
      await keyDown(list, "p", { metaKey: true });
      expect(prompt()).toBe("Go to");
      await keyDown(query("input"), "Escape");
      // The same on the overview once a line is selected.
      await runCommand("show overview");
      const overview = query('[role="listbox"]');
      await keyDown(overview, "n", ctrl);
      await keyDown(overview, "p", ctrl);
      expect(selectedRow()).toMatch(/_overview-0$/);
      expect(prompt()).toBeUndefined();
    },
  );

  it.each(["Win32", "Linux x86_64"])(
    "[SR-122/AK-xm88] on %s, with no row selected Ctrl+P is still Go to: on the overview after the start, and on a list without rows",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      const handlers = workspace();
      const { bridge } = fakeBridge(handlers);
      await render(bridge);
      const fresh = await pressed(query('[role="listbox"]'), "p", ctrl);
      expect(fresh.defaultPrevented).toBe(true);
      expect(prompt()).toBe("Go to");
      await keyDown(query("input"), "Escape");
      handlers["element.list"] = () => ({ elements: [], total: 0 });
      await listAll();
      expect(query(".list .quiet").textContent).toBe("No elements");
      const ctrlN = await pressed(query('[role="listbox"]'), "n", ctrl);
      expect(ctrlN.defaultPrevented).toBe(false);
      await keyDown(query('[role="listbox"]'), "p", ctrl);
      expect(prompt()).toBe("Go to");
    },
  );

  it("[SR-145/AK-bfb2] on macOS, with no row selected the physical Ctrl+P is not Go to, Cmd+P is: on the overview after the start, and on a list without rows", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const handlers = workspace();
    await render(fakeBridge(handlers).bridge);
    const fresh = await pressed(query('[role="listbox"]'), "p", ctrl);
    expect(fresh.defaultPrevented).toBe(false);
    expect(prompt()).toBeUndefined();
    expect(selectedRow()).toBeUndefined();
    await keyDown(query('[role="listbox"]'), "p", { metaKey: true });
    expect(prompt()).toBe("Go to");
    await keyDown(query("input"), "Escape");
    handlers["element.list"] = () => ({ elements: [], total: 0 });
    await listAll();
    expect(query(".list .quiet").textContent).toBe("No elements");
    expect((await pressed(query('[role="listbox"]'), "p", ctrl)).defaultPrevented).toBe(false);
    expect(prompt()).toBeUndefined();
    await keyDown(query('[role="listbox"]'), "p", { metaKey: true });
    expect(prompt()).toBe("Go to");
  });

  it("[SR-122/AK-xm88] Ctrl+P on an overview without lines is Go to", async () => {
    const handlers = workspace();
    handlers["element.facets"] = () => new Error("The workspace is not valid");
    await render(fakeBridge(handlers).bridge);
    await keyDown(query('[role="listbox"]'), "p", ctrl);
    expect(prompt()).toBe("Go to");
  });

  it("[SR-122/AK-mqwc] Enter on a fresh list opens its first row and keeps it selected", async () => {
    const { bridge, invoke } = fakeBridge(workspace());
    await renderList(bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(calls(invoke, "element.get")).toEqual([{ ref: "uuid-1", repository: "spec" }]);
    await keyDown(window, "p", ctrl);
    await keyDown(query("input"), "Enter");
    expect(selectedRow()).toMatch(/_row-0$/);
  });

  it("[SR-122/AK-kjhn] Ctrl+N and Ctrl+P move through the hits of the go-to prompt", async () => {
    const { bridge } = fakeBridge(workspace());
    await renderList(bridge);
    // Two more buffers behind the shown one.
    await keyDown(query('[role="listbox"]'), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await keyDown(query('[role="listbox"]'), "ArrowDown");
    await keyDown(query('[role="listbox"]'), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    const selected = (): string | null | undefined =>
      shownOne('.candidates [aria-selected="true"]')?.textContent;
    const names = [...shownAll('.candidates [role="option"]')].map((option) => option.textContent);
    expect(names.length).toBeGreaterThan(1);
    expect(selected()).toBe(names[0]);
    await keyDown(query("input"), "n", { ctrlKey: true });
    expect(selected()).toBe(names[1]);
    await keyDown(query("input"), "p", { ctrlKey: true });
    expect(selected()).toBe(names[0]);
    await keyDown(query("input"), "ArrowDown");
    expect(selected()).toBe(names[1]);
  });

  it("a key that a control handled is no shortcut", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    const handled = (event: Event): void => {
      event.preventDefault();
    };
    document.body.addEventListener("keydown", handled);
    await keyDown(query("main"), "P", { ctrlKey: true, shiftKey: true });
    document.body.removeEventListener("keydown", handled);
    expect(shownOne("input")).toBeNull();
    await keyDown(query("main"), "P", { ctrlKey: true, shiftKey: true });
    expect(query("label").textContent).toBe("Command");
  });

  it("ignores keys that are no shortcut", async () => {
    const { bridge } = fakeBridge(workspace());
    await render(bridge);
    await keyDown(window, "x", { ctrlKey: true });
    await keyDown(window, "a");
    expect(shownOne("input")).toBeNull();
  });
});
