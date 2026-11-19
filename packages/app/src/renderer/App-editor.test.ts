// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { InvokeResult } from "../shared/protocol.js";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { AUTOSAVE_MS } from "./autosave.js";
import { DEFAULT_SORT } from "./buffers.js";
import { focusEffect } from "./editor/preview.js";
import type { Handler } from "./App.test-helper.js";
import {
  SHOWN,
  fakeBridge,
  row,
  workspace,
  container,
  flush,
  render,
  text,
  shownAll,
  shownOne,
  query,
  keyDown,
  type,
  clickLine,
  allCommands,
  mod,
  runCommand,
  listAll,
  renderList,
  texts,
  calls,
} from "./App.test-helper.js";
import { answerNextOf } from "./agent-poll.test-helper.js";

describe("App, the text editor", () => {
  /** A workspace whose elements have a text, and that saves it with a final line break. */
  const withText = (): Record<string, Handler> => {
    const handlers = workspace();
    handlers["element.get"] = (input) => ({
      element: row(Number(String(input["ref"]).replace("uuid-", "")), { text: "Hello", relations: [] }),
    });
    handlers["element.update"] = (input) => ({
      element: row(1, { text: `${String(input["text"])}\n`, relations: [] }),
      files: ["f1.md"],
      affected: 0,
    });
    return handlers;
  };
  const editorView = (): EditorView => {
    const found = EditorView.findFromDOM(query(".cm-editor"));
    if (found === null) {
      throw new Error("no editor");
    }
    return found;
  };
  const typeText = async (insert: string): Promise<void> => {
    await act(async () => {
      editorView().dispatch({ changes: { from: editorView().state.doc.length, insert } });
      await Promise.resolve();
    });
    await flush();
  };
  /**
   * A workspace that keeps what is written (SR-105): `element.get` gives the text last written and the
   * bytes of the file; a write on other bytes is refused as core refuses it. `outside` changes a file as
   * another process does, without telling the window.
   */
  const withStore = () => {
    const handlers = withText();
    const files = new Map<string, { text: string; sha: string }>();
    const fileOf = (ref: unknown): { text: string; sha: string } =>
      files.get(String(ref)) ?? { text: "Hello", sha: `${String(ref)}@0` };
    const number = (ref: unknown): number => Number(String(ref).replace("uuid-", ""));
    handlers["element.get"] = (input) => ({
      element: row(number(input["ref"]), { text: fileOf(input["ref"]).text, relations: [] }),
      fileSha256: fileOf(input["ref"]).sha,
    });
    handlers["element.update"] = (input) => {
      const before = fileOf(input["ref"]);
      const expected = input["expectedFileSha256"];
      if (expected !== undefined && expected !== before.sha) {
        return Object.assign(new Error("The file changed on disk"), { code: "file.changed-on-disk" });
      }
      const after = { text: `${String(input["text"])}\n`, sha: `${before.sha}+` };
      files.set(String(input["ref"]), after);
      return {
        element: row(number(input["ref"]), { text: after.text, relations: [] }),
        fileSha256: after.sha,
      };
    };
    const outside = (ref: string, text: string): void => {
      files.set(ref, { text, sha: `${fileOf(ref).sha}~` });
    };
    return { handlers, files, outside };
  };
  const openElement = async (handlers = withText()) => {
    const fake = fakeBridge(handlers);
    await renderList(fake.bridge);
    await keyDown(query('[role="listbox"]'), "Enter");
    return fake;
  };

  it("shows the text of the element in the editor", async () => {
    await openElement();
    expect(editorView().state.doc.toString()).toBe("Hello");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  /** Types as the keyboard does, so the slash menu opens, and lets it answer. */
  const typeKeys = async (insert: string): Promise<void> => {
    for (const char of insert) {
      await act(async () => {
        const head = editorView().state.selection.main.head;
        editorView().dispatch({
          changes: { from: head, insert: char },
          selection: { anchor: head + 1 },
          userEvent: "input.type",
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  };

  it("[SR-129/AK-nxbm] Reference to element asks Insert reference, finds elements as Go to does, and writes the reference of the pick", async () => {
    const { invoke } = await openElement();
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" /ref");
    await keyDown(query(".cm-content"), "Enter");
    expect(query("label").textContent).toBe("Insert reference");
    expect(editorView().state.doc.toString()).toBe("Hello /ref");
    await type("title");
    expect(calls(invoke, "element.search")).toEqual([{ query: "title", fields: ["id", "title"], limit: 20 }]);
    await keyDown(query("input"), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello [Title 2](reqseq:uuid-2)");
    expect(shownOne("input")).toBeNull();
    expect(editorView().hasFocus).toBe(true);
    expect(document.activeElement).toBe(query(".cm-content"));
  });

  it("[SR-129/AK-rbjm] Escape in Insert reference leaves the / as typed and gives the editor the focus", async () => {
    await openElement();
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" /ref");
    await keyDown(query(".cm-content"), "Enter");
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    expect(editorView().state.doc.toString()).toBe("Hello /ref");
    expect(document.activeElement).toBe(query(".cm-content"));
  });

  it("[SR-105/AK-p4gn] Insert reference replaced by the command prompt holds autosave no longer (ThomasBirkmaier/ReqSeq-archive#604 review, S2)", async () => {
    const { handlers } = withStore();
    const { invoke } = await openElement(handlers);
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" /ref");
    await keyDown(query(".cm-content"), "Enter");
    expect(query("label").textContent).toBe("Insert reference");
    // The command prompt replaces Insert reference without Escape: the reference is cancelled, and the
    // command prompt has the focus.
    await keyDown(query("input"), "P", { ...mod(), shiftKey: true });
    expect(query("label").textContent).toBe("Command");
    expect(document.activeElement).toBe(query("input"));
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    vi.useFakeTimers();
    await act(async () => {
      const end = editorView().state.doc.length;
      editorView().dispatch({ changes: { from: end, insert: "x" }, userEvent: "input.type" });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    // The prompt that replaced Insert reference saved the text as it was; the key after it a second later.
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello /ref", expectedFileSha256: "uuid-1@0" },
      { ref: "uuid-1", text: "Hello /ref\nx", expectedFileSha256: "uuid-1@0+" },
    ]);
    vi.useRealTimers();
  });

  it("[SR-066/AK-v40r] [[ in the text opens Insert reference, which searches title and IDs of all elements", async () => {
    const { invoke } = await openElement();
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" [[");
    expect(query("label").textContent).toBe("Insert reference");
    expect(document.activeElement).toBe(query("input"));
    expect(editorView().state.doc.toString()).toBe("Hello [[");
    await type("title");
    // Title and IDs, and no selection: all elements.
    expect(calls(invoke, "element.search")).toEqual([{ query: "title", fields: ["id", "title"], limit: 20 }]);
  });

  it("[SR-066/AK-qdkx] a pick writes the reference in place of the [[; autosave waits while Insert reference is open", async () => {
    const { handlers } = withStore();
    const { invoke } = await openElement(handlers);
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" [[");
    expect(query("label").textContent).toBe("Insert reference");
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    });
    vi.useRealTimers();
    // Neither the prompt opening nor the second after it saved the [[.
    expect(calls(invoke, "element.update")).toEqual([]);
    await type("title");
    // The pick is input: it is saved a second later.
    vi.useFakeTimers();
    await act(async () => {
      query("input").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    vi.useRealTimers();
    expect(document.activeElement).toBe(query(".cm-content"));
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello [Title 2](reqseq:uuid-2)", expectedFileSha256: "uuid-1@0" },
    ]);
  });

  it("[SR-066/AK-qdkx] a reference to a local target in another repository shows its title; one that is not here its short ID", async () => {
    const GUSTS = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
    const GONE = "11111111-2222-4333-8444-555555555555";
    const handlers = withText();
    handlers["element.get"] = (input) =>
      input["ref"] === GUSTS
        ? { element: row(9, { id: GUSTS, title: "Measure gusts", repository: "sensor", relations: [] }) }
        : input["ref"] === GONE
          ? Object.assign(new Error("No element"), { code: "ref.unknown" })
          : {
              element: row(1, {
                text: `See [N-0e9d7c](reqseq:${GUSTS}?version=n1:aa&repository=sensor) and [N-555555](reqseq:${GONE}?version=n1:bb&repository=sensor).`,
                relations: [],
              }),
            };
    const { invoke } = await openElement(handlers);
    await flush();
    expect(calls(invoke, "element.get")).toContainEqual({ ref: GUSTS, repository: "sensor" });
    expect(calls(invoke, "element.get")).toContainEqual({ ref: GONE, repository: "sensor" });
    expect(texts(".cm-lr-ref")).toEqual(["Measure gusts", "N-555555"]);
    expect(editorView().state.doc.toString()).toContain("[N-0e9d7c](reqseq:");
  });

  it.each(["opened", "restarted"] as const)(
    "asks the titles of other repositories again once a workspace is %s",
    async (reason) => {
      const GUSTS = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
      const handlers = withText();
      handlers["element.get"] = (input) =>
        input["ref"] === GUSTS
          ? { element: row(9, { id: GUSTS, title: "Measure gusts", repository: "sensor", relations: [] }) }
          : {
              element: row(1, {
                text: `See [N-0e9d7c](reqseq:${GUSTS}?version=n1:aa&repository=sensor).`,
                relations: [],
              }),
            };
      const { invoke, change } = await openElement(handlers);
      await flush();
      const gusts = (): unknown[] =>
        calls(invoke, "element.get").filter((input) => (input as { ref: string }).ref === GUSTS);
      expect(gusts()).toHaveLength(1);
      // Shown again in the same workspace, the buffer asks nothing.
      await listAll();
      await keyDown(query('[role="listbox"]'), "Enter");
      await flush();
      expect(gusts()).toHaveLength(1);
      await change(reason);
      await listAll();
      await keyDown(query('[role="listbox"]'), "Enter");
      await flush();
      expect(gusts()).toHaveLength(2);
      expect(texts(".cm-lr-ref")).toEqual(["Measure gusts"]);
    },
  );

  it("a pick of a target in another repository brings its title along: core is not asked for it", async () => {
    const GUSTS = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
    const gusts = row(9, { id: GUSTS, shortId: "N-0e9d7c", title: "Measure gusts", repository: "sensor" });
    const handlers = withText();
    handlers["element.search"] = () => ({
      hits: [{ ...gusts, score: 1, fields: ["title"], terms: ["gusts"] }],
      total: 1,
      incomplete: false,
    });
    const { invoke } = await openElement(handlers);
    editorView().focus();
    editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
    await typeKeys(" [[");
    await type("gusts");
    await keyDown(query("input"), "Enter");
    expect(editorView().state.doc.toString()).toBe(
      `Hello [N-0e9d7c](reqseq:${GUSTS}?version=&repository=sensor)`,
    );
    // Off the line with the caret the title shows, from the pick.
    await act(async () => {
      editorView().contentDOM.blur();
      editorView().dispatch({ effects: focusEffect.of(false) });
      await Promise.resolve();
    });
    await flush();
    expect(texts(".cm-lr-ref")).toEqual(["Measure gusts"]);
    expect(calls(invoke, "element.get")).not.toContainEqual({ ref: GUSTS, repository: "sensor" });
  });

  it("shows modified in the modeline while the text has unsaved changes", async () => {
    await openElement();
    await typeText("!");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftmodifiedWeather stationread-only");
  });

  it("[SR-105/AK-znzt] saves with Ctrl+S or Cmd+S at once: element.update, Saved in the minibuffer, no modified", async () => {
    const { invoke, change } = await openElement();
    await typeText("!");
    await keyDown(query(".cm-content"), "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", text: "Hello!" }]);
    expect(text("Minibuffer")).toBe("Saved SR-000001 Title 1");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    // The write reports itself as a change of the workspace; the message of the save stays.
    await change("written");
    expect(text("Minibuffer")).toBe("Saved SR-000001 Title 1");
    expect(query(".cm-editor")).not.toBeNull();
    await keyDown(window, "s", { metaKey: true });
    expect(text("Minibuffer")).toBe("No changes to save");
    // The reread after "written" gives the fake's "Hello"; Cmd+S writes what was typed on it.
    await typeText("?");
    await keyDown(window, "s", { metaKey: true });
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!" },
      { ref: "uuid-1", text: "Hello?" },
    ]);
  });

  it("[SR-131/AK-nkm5] saves the unsaved text when main asks before a switch, and says so when it could not", async () => {
    const { invoke, savers, handlers } = await openElement();
    expect(savers).toHaveLength(1);
    await typeText("!");
    let saved: boolean | undefined;
    await act(async () => {
      saved = await savers[0]?.();
    });
    await flush();
    expect(saved).toBe(true);
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", text: "Hello!" }]);
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
    // A save that fails keeps the open workspace and names the element.
    handlers["element.update"] = () => new Error("The element is read-only");
    await typeText("?");
    await act(async () => {
      saved = await savers[0]?.();
    });
    await flush();
    expect(saved).toBe(false);
    expect(text("Minibuffer")).toBe(
      "SR-000001 Title 1 could not be saved (The element is read-only); the workspace was not changed",
    );
    expect(text("Modeline")).toContain("modified");
    expect(query(".sheet").inert).toBe(false);
  });

  it("[SR-105/AK-p4gn] saves the unsaved text when main asks before the window closes; text it cannot save keeps the window open once", async () => {
    const { invoke, savers, handlers } = await openElement();
    await typeText("!");
    let saved: boolean | undefined;
    const close = async (): Promise<void> => {
      await act(async () => {
        saved = await savers[0]?.({ closing: true });
      });
      await flush();
    };
    await close();
    expect(saved).toBe(true);
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", text: "Hello!" }]);
    // Closing is no switch: the sheet takes input, and the minibuffer says nothing.
    expect(query(".sheet").inert).toBe(false);
    expect(text("Minibuffer")).toBe("");
    // A save that fails keeps the window open and says why, in the minibuffer (no dialog).
    handlers["element.update"] = () => new Error("The element is read-only");
    await typeText("?");
    await close();
    expect(saved).toBe(false);
    expect(text("Minibuffer")).toBe(
      "SR-000001 Title 1 could not be saved (The element is read-only): close the window again to discard the unsaved input",
    );
    expect(shownOne('[role="dialog"]')).toBeNull();
    // Input after the question asks again.
    await typeText(".");
    await close();
    expect(saved).toBe(false);
    // The next close discards: nothing more is written.
    const writes = calls(invoke, "element.update").length;
    await close();
    expect(saved).toBe(true);
    expect(calls(invoke, "element.update")).toHaveLength(writes);
  });

  it("[SR-105/AK-p4gn] when main gave up waiting before the close, the window says it stays open", async () => {
    const { expire } = await openElement();
    await expire({ closing: true });
    expect(text("Minibuffer")).toBe(
      "Saving before the window closes took longer than 2 s; the window stays open, and closing it again within 10 s closes it without waiting",
    );
    expect(query(".sheet").inert).toBe(false);
  });

  it("[SR-105/AK-p4gn] a close while a workspace switch saves waits for that save and does not write the input twice (ThomasBirkmaier/ReqSeq-archive#611 review N3)", async () => {
    const { invoke, savers, handlers } = await openElement();
    await typeText("!");
    // The buffer is left and its save fails: its input stays as a draft of a buffer that is not shown.
    handlers["element.update"] = () => new Error("The element is read-only");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await flush();
    const refused = calls(invoke, "element.update").length;
    expect(text("Modeline")).not.toContain("SR-000001");
    const writes: ((result: InvokeResult) => void)[] = [];
    const answer = invoke.getMockImplementation();
    invoke.mockImplementation((name, input) =>
      name === "element.update"
        ? new Promise((resolve) => {
            writes.push(resolve);
          })
        : (answer?.(name, input) ?? Promise.reject(new Error("no fake"))),
    );
    let switched: Promise<boolean> | undefined;
    let closed: Promise<boolean> | undefined;
    await act(async () => {
      switched = savers[0]?.();
      await Promise.resolve();
      closed = savers[0]?.({ closing: true });
      await Promise.resolve();
    });
    await flush();
    // One write of the draft, by the switch; the close waits for it.
    expect(writes).toHaveLength(1);
    for (const write of writes) {
      write({ ok: true, output: { element: row(1, { text: "Hello!" }), files: [], affected: 0 } });
    }
    await act(async () => {
      expect(await switched).toBe(true);
      expect(await closed).toBe(true);
    });
    expect(calls(invoke, "element.update").slice(refused)).toEqual([{ ref: "uuid-1", text: "Hello!" }]);
    expect(text("Minibuffer")).not.toContain("could not be saved");
  });

  it("[SR-105/AK-p4gn] a close says the input could not be saved when a save throws", async () => {
    const { savers, invoke } = await openElement();
    await typeText("!");
    const answer = invoke.getMockImplementation();
    invoke.mockImplementation((name, input) =>
      name === "element.update"
        ? Promise.reject(new Error("port closed"))
        : (answer?.(name, input) ?? Promise.reject(new Error("no fake"))),
    );
    let saved: boolean | undefined;
    await act(async () => {
      saved = await savers[0]?.({ closing: true });
    });
    await flush();
    expect(saved).toBe(false);
    expect(text("Minibuffer")).toContain("close the window again to discard the unsaved input");
  });

  it("[SR-131/AK-nkm5] while it saves and the other workspace opens, the window takes no input and says so", async () => {
    const { invoke, savers, change } = await openElement();
    await typeText("!");
    let written: (result: InvokeResult) => void = () => undefined;
    const answer = invoke.getMockImplementation();
    invoke.mockImplementation((name, input) =>
      name === "element.update"
        ? new Promise((resolve) => {
            written = resolve;
          })
        : (answer?.(name, input) ?? Promise.reject(new Error("no fake"))),
    );
    let saved: Promise<boolean> | undefined;
    await act(async () => {
      saved = savers[0]?.();
      await Promise.resolve();
    });
    await flush();
    expect(query(".sheet").inert).toBe(true);
    expect(text("Minibuffer")).toBe("Opening another workspace…");
    // No command, no prompt, no other key while it is busy.
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await clickLine();
    expect(shownOne('[role="option"]')).toBeNull();
    expect(text("Minibuffer")).toBe("Opening another workspace…");
    written({ ok: true, output: { element: row(1, { text: "Hello!" }), files: [], affected: 0 } });
    await act(async () => {
      expect(await saved).toBe(true);
    });
    // Saved: still busy until the other workspace is open.
    expect(query(".sheet").inert).toBe(true);
    await change("written");
    expect(query(".sheet").inert).toBe(true);
    // Opened, but the other workspace is still loading: the old buffers take no input until they are gone.
    let status: () => void = () => undefined;
    invoke.mockImplementation((name, input) =>
      name === "workspace.status"
        ? new Promise((resolve) => {
            status = () => {
              void answer?.(name, input).then(resolve);
            };
          })
        : (answer?.(name, input) ?? Promise.reject(new Error("no fake"))),
    );
    await change("opened");
    // Opened, the other workspace still loading: the old buffers and drafts are gone at once, so nothing
    // can be typed into them, and the window takes input again, so a load that hangs never locks it.
    expect(query(".sheet").inert).toBe(false);
    expect(shownOne(".cm-editor")).toBeNull();
    expect(text("Modeline")).not.toContain("SR-000001");
    expect(text("Modeline")).not.toContain("modified");
    expect(text("Minibuffer")).toBe("Opening another workspace…");
    // The command prompt opens (it offers "Open workspace" again), and stays open when the status comes.
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    expect(shownOne('.minibuffer [role="option"]')).not.toBeNull();
    await act(async () => {
      status();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
    expect(query(".sheet").inert).toBe(false);
    expect(text("Modeline")).toContain("Overview");
    expect(shownOne('.minibuffer [role="option"]')).not.toBeNull();
  });

  it("[SR-131/AK-nkm5] says so when main gave up waiting for the save, and takes input again", async () => {
    const { savers, expire, expired } = await openElement();
    expect(expired.size).toBe(1);
    await typeText("!");
    await act(async () => {
      await savers[0]?.();
    });
    await flush();
    expect(query(".sheet").inert).toBe(true);
    await expire();
    expect(query(".sheet").inert).toBe(false);
    expect(text("Minibuffer")).toBe("The unsaved input was not saved in time; Weather station stays open");
  });

  it("[SR-131/AK-nkm5] a save that throws keeps the open workspace and says so", async () => {
    const { invoke, savers } = await openElement();
    await typeText("!");
    answerNextOf(invoke, "element.update", () => Promise.reject(new Error("port closed")));
    let saved: boolean | undefined;
    await act(async () => {
      saved = await savers[0]?.();
    });
    await flush();
    expect(saved).toBe(false);
    expect(query(".sheet").inert).toBe(false);
    expect(text("Minibuffer")).toBe(
      "The unsaved input could not be saved (Error: port closed); the workspace was not changed",
    );
    expect(text("Modeline")).toContain("modified");
  });

  it("keeps the editor, with its undo history, when the save is reported as a change of the workspace", async () => {
    const { change } = await openElement();
    const editor = query(".cm-editor");
    await typeText("!");
    await keyDown(window, "s", { ctrlKey: true });
    await change("written");
    await change("restarted");
    expect(query(".cm-editor")).toBe(editor);
  });

  it("saves from the command prompt, and offers editing there", async () => {
    const { invoke } = await openElement();
    await typeText("!");
    await runCommand("save element");
    expect(calls(invoke, "element.update")).toHaveLength(1);
    await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
    await allCommands();
    expect([...shownAll('[role="option"]')].map((o) => o.textContent)).toContain("Edit textEnter");
    await keyDown(query("input"), "Escape");
    await runCommand("edit text");
    expect(editorView().hasFocus).toBe(true);
  });

  it("[SR-104/AK-k13x] [SR-104/AK-n97r] Ctrl+Alt+A adds a property by the minibuffer, the choice prompt has only the choices, and Ctrl+S saves it", async () => {
    const handlers = withText();
    handlers["metamodel.get"] = () => ({
      relations: [],
      types: [{ key: "need", name: "Need", properties: ["title", "method", "topic"] }],
      properties: [
        { key: "title", name: "Title", kind: "text", meaning: "title" },
        {
          key: "method",
          name: "Verification Method",
          kind: "choice",
          choices: [
            { key: "test", name: "Test" },
            { key: "analysis", name: "Analysis" },
          ],
        },
        { key: "topic", name: "Topic", kind: "text" },
      ],
      statuses: [{ key: "draft" }],
      meanings: {},
    });
    handlers["element.update"] = (input) => ({
      element: row(1, { text: "Hello", properties: input["set"], relations: [] }),
      files: ["f1.md"],
      affected: 0,
    });
    const { invoke } = await openElement(handlers);
    await keyDown(window, "a", { ctrlKey: true, altKey: true });
    expect(text("Minibuffer")).toContain("Add property");
    expect([...shownAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      "Verification Methodmethod",
      "Topictopic",
    ]);
    await type("method");
    await keyDown(query("input"), "Enter");
    // The box is there, the focus on it, and the choice prompt asks at once with the choices of the metamodel.
    expect(query('[data-field="method"]')).not.toBeNull();
    expect(text("Minibuffer")).toContain("Verification Method");
    expect([...shownAll('[role="option"]')].map((option) => option.textContent)).toEqual([
      "Testtest",
      "Analysisanalysis",
    ]);
    await type("anal");
    await keyDown(query("input"), "Enter");
    expect(shownOne("input")).toBeNull();
    expect(document.activeElement).toBe(query('[data-field="method"]'));
    expect(texts('[data-field="method"] .line')).toEqual(["analysis"]);
    expect(text("Modeline")).toContain("modified");
    await keyDown(window, "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", set: { method: "analysis" } }]);
    expect(text("Modeline")).not.toContain("modified");
  });

  it("[SR-104/AK-sxnr] Clear property is in the command prompt for an element and empties the box the cursor was in", async () => {
    const handlers = withText();
    handlers["metamodel.get"] = () => ({
      relations: [],
      types: [{ key: "need", name: "Need", properties: ["method"] }],
      properties: [
        { key: "method", name: "Method", kind: "choice", choices: [{ key: "test", name: "Test" }] },
      ],
      statuses: [{ key: "draft" }],
      meanings: {},
    });
    const element = handlers["element.get"];
    handlers["element.get"] = (input) => {
      const loaded = element?.(input) as { element: object };
      return { element: { ...loaded.element, properties: { method: "test" } } };
    };
    const { invoke } = await openElement(handlers);
    query('[data-field="method"]').focus();
    await runCommand("clear property");
    expect(texts('[data-field="method"] .line')).toEqual([]);
    await keyDown(window, "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([{ ref: "uuid-1", unset: ["method"] }]);
  });

  it("does not save on a list", async () => {
    const { bridge, invoke } = fakeBridge(withText());
    await render(bridge);
    await keyDown(window, "s", { ctrlKey: true });
    expect(calls(invoke, "element.update")).toEqual([]);
    expect(text("Minibuffer")).toBe("");
  });

  it("[SR-105/AK-p4gn] leaving a buffer for another writes its input at once; shown again it has the file's text", async () => {
    const { handlers } = withStore();
    const { invoke } = await openElement(handlers);
    await typeText("!");
    expect(calls(invoke, "element.update")).toEqual([]);
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(query('[role="listbox"]')).not.toBeNull();
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
    ]);
    expect(text("Modeline")).toBe("All elements3 elementsWeather stationread-only");
    // Leaving is silent (D-062).
    expect(text("Minibuffer")).toBe("");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  it("[SR-105/AK-p4gn] Alt+N to another buffer, without a prompt, writes the input at once (ThomasBirkmaier/ReqSeq-archive#604 review, N2)", async () => {
    const { handlers } = withStore();
    const { invoke } = await openElement(handlers);
    await typeText("!");
    await keyDown(query(".cm-content"), "n", { altKey: true });
    expect(shownOne(`${SHOWN} article`)).toBeNull();
    // No prompt opened, and no second has passed: the save is the leaving's own.
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
    ]);
  });

  it("[SR-105/AK-dmrq] after leaving and coming back, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z step through the text since the buffer was opened", async () => {
    const { handlers } = withStore();
    const { invoke } = await openElement(handlers);
    await typeText("!");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    await act(async () => {
      expect(undo(editorView())).toBe(true);
      await Promise.resolve();
    });
    expect(editorView().state.doc.toString()).toBe("Hello\n");
    expect(text("Modeline")).toContain("modified");
    await act(async () => {
      expect(redo(editorView())).toBe(true);
      await Promise.resolve();
    });
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    // Closing the buffer drops the history.
    await runCommand("close buffer");
    expect(calls(invoke, "element.update")).toHaveLength(1);
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    expect(undo(editorView())).toBe(false);
  });

  it("[SR-105/AK-p4gn] a buffer shown again while its save from leaving runs reads its element after that save: no change on disk", async () => {
    const { handlers } = withStore();
    const fake = await openElement(handlers);
    await typeText("!");
    // The save the prompt of Ctrl+P makes when it opens answers only when the test says so: it still runs
    // when the buffer is left and shown again.
    let answer: (() => void) | undefined;
    const update = handlers["element.update"];
    answerNextOf(
      fake.invoke,
      "element.update",
      (_name, input = {}) =>
        new Promise((resolve) => {
          answer = () => {
            resolve({ ok: true, output: update?.(input) });
          };
        }),
    );
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(shownOne(".cm-editor")).toBeNull();
    await act(async () => {
      answer?.();
      await Promise.resolve();
    });
    await flush();
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    await typeText("?");
    await keyDown(query(".cm-content"), "s", { ctrlKey: true });
    expect(text("Minibuffer")).toBe("Saved SR-000001 Title 1");
    expect(text("Modeline")).not.toContain("on disk");
    expect(calls(fake.invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
      { ref: "uuid-1", text: "Hello!\n?", expectedFileSha256: "uuid-1@0+" },
    ]);
  });

  it("[SR-106/AK-ydc8] leaving writes nothing over a file that changed outside; shown again, the buffer has the input and the conflict", async () => {
    const { handlers, outside, files } = withStore();
    const { invoke } = await openElement(handlers);
    await typeText("!");
    outside("uuid-1", "Changed");
    // The prompt that opens saves the input (binding review point 6): core refuses it on the old bytes, and
    // the buffer is in conflict, so leaving it saves nothing either.
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
    ]);
    expect(files.get("uuid-1")?.text).toBe("Changed");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(text("Minibuffer")).toBe(
      'SR-000001 Title 1 changed on disk. Resolve with "Resolve change on disk"',
    );
    expect(editorView().state.doc.toString()).toBe("Hello!");
    expect(query('[data-on-disk="Text"]').textContent).toBe("On diskChanged");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftmodifiedchanged on diskWeather stationread-only");
  });

  it("[SR-105/AK-p4gn] Close buffer writes the input and closes; it asks only when the input could not be written, and discards when closing is repeated", async () => {
    const { handlers } = withStore();
    const { invoke } = await openElement(handlers);
    await typeText("!");
    await runCommand("close buffer");
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
    ]);
    expect(query('[role="listbox"]')).not.toBeNull();
    // Opened again: a write core refuses keeps the buffer and asks once.
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    handlers["element.update"] = () => new Error("The element is read-only");
    await typeText("?");
    await runCommand("close buffer");
    expect(text("Minibuffer")).toBe(
      "SR-000001 Title 1 has unsaved changes that were not saved: closing again discards them",
    );
    expect(text("Modeline")).toContain("not saved (The element is read-only)");
    expect(query("article")).not.toBeNull();
    await runCommand("close buffer");
    expect(query('[role="listbox"]')).not.toBeNull();
    // Opened again, the element shows its saved text.
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    expect(text("Modeline")).toBe("SR-000001 · Need · draftWeather stationread-only");
  });

  it("[SR-105/AK-p4gn] Close buffer saves again the keys typed while its save ran, and closes only then (ThomasBirkmaier/ReqSeq-archive#604 review, S1)", async () => {
    const { handlers, files } = withStore();
    const fake = await openElement(handlers);
    // Every write answers only when the test says so.
    const waiting: (() => void)[] = [];
    const real = fake.invoke.getMockImplementation();
    if (real === undefined) {
      throw new Error("the bridge has no invoke");
    }
    const update = handlers["element.update"];
    fake.invoke.mockImplementation((name: string, input: Record<string, unknown> = {}) =>
      name === "element.update"
        ? new Promise((resolve) => {
            waiting.push(() => {
              resolve({ ok: true, output: update?.(input) });
            });
          })
        : real(name, input),
    );
    const answer = async (): Promise<void> => {
      await act(async () => {
        waiting.shift()?.();
        await Promise.resolve();
      });
      await flush();
    };
    await typeText("!");
    // The prompt's own save runs while "Close buffer" is chosen; its save follows that one.
    await runCommand("close buffer");
    await typeText("?");
    await answer();
    await typeText(".");
    await answer();
    // Input was left after the save of Close buffer: it saves once more, and the buffer stays meanwhile.
    expect(query("article")).not.toBeNull();
    await answer();
    expect(query('[role="listbox"]')).not.toBeNull();
    expect(calls(fake.invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
      { ref: "uuid-1", text: "Hello!?", expectedFileSha256: "uuid-1@0+" },
      { ref: "uuid-1", text: "Hello!?.", expectedFileSha256: "uuid-1@0++" },
    ]);
    expect(files.get("uuid-1")?.text).toBe("Hello!?.\n");
  });

  it("asks again when text was typed after the question, or another action ran", async () => {
    const { handlers } = withStore();
    handlers["element.update"] = () => new Error("The element is read-only");
    await openElement(handlers);
    await typeText("!");
    await runCommand("close buffer");
    await typeText("?");
    await runCommand("close buffer");
    expect(query("article")).not.toBeNull();
    await runCommand("show element id");
    await runCommand("close buffer");
    expect(query("article")).not.toBeNull();
    // Another buffer in between ends the question as well.
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await runCommand("close buffer");
    expect(query("article")).not.toBeNull();
  });

  it("[SR-123/AK-grm4] Close all buffers from the command prompt closes them all; the overview is what remains", async () => {
    await openElement();
    await runCommand("search elements");
    await type("title");
    await keyDown(query("input"), "Enter");
    await runCommand("close all buffers");
    expect(query("[data-buffer]").getAttribute("aria-label")).toBe("Overview");
    expect(container.querySelectorAll("[data-buffer]")).toHaveLength(1);
    expect(text("Minibuffer")).toBe("Closed 3 buffers");
    expect(text("Modeline")).toBe("Overview3 elementsWeather stationread-only");
    // No other buffer is left to go to, and the global keys still work: Go to offers only the element
    // shown last, a recent element that is no longer open (SR-115 AK1).
    await keyDown(window, "p", { ctrlKey: true });
    expect(query("label").textContent).toBe("Go to");
    expect([...shownAll(".candidates [role=option]")].map((option) => option.textContent)).toEqual([
      "SR-000001 Title 1",
    ]);
  });

  it('[SR-123/AK-xbx2] Close all buffers keeps a buffer in conflict: shown again, it says its change on disk after "Closed 1 buffer", and nothing is written', async () => {
    const { handlers, outside } = withStore();
    const { invoke } = await openElement(handlers);
    await typeText("!");
    // Another editor changes the file: the save of the prompt that opens is refused, a conflict.
    outside("uuid-1", "Changed");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await runCommand("close all buffers");
    expect(query("label").textContent).toBe("1 buffer with unsaved changes (SR-000001 Title 1)");
    // The minibuffer's texts in order: what "Close all buffers" says, then what the buffer it kept says
    // when it is shown again (the e2e test `main-view.spec.ts` polled only for the last one).
    const said: string[] = [];
    const minibuffer = query('[aria-label="Minibuffer"]');
    const observer = new MutationObserver(() => {
      said.push(minibuffer.textContent);
    });
    observer.observe(minibuffer, { childList: true, subtree: true, characterData: true });
    await keyDown(query("input"), "Enter");
    await flush();
    observer.disconnect();
    const changed = 'SR-000001 Title 1 changed on disk. Resolve with "Resolve change on disk"';
    expect(said.filter((line) => line === "Closed 1 buffer" || line === changed)).toEqual([
      "Closed 1 buffer",
      changed,
    ]);
    expect(editorView().state.doc.toString()).toBe("Hello!");
    // The only write is the refused one: the app's own writes are no change on disk.
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
    ]);
  });

  it("[SR-123/AK-xbx2] [SR-105/AK-p4gn] Close all buffers writes the unsaved text first; only text that could not be written makes the minibuffer ask, without a dialog", async () => {
    const { handlers } = withStore();
    const { invoke } = await openElement(handlers);
    await typeText("!");
    // Written: every buffer closes.
    await runCommand("close all buffers");
    expect(calls(invoke, "element.update")).toEqual([
      { ref: "uuid-1", text: "Hello!", expectedFileSha256: "uuid-1@0" },
    ]);
    expect(query("[data-buffer]").getAttribute("aria-label")).toBe("Overview");
    expect(text("Minibuffer")).toBe("Closed 2 buffers");
    // A write core refuses: the minibuffer asks about that buffer.
    handlers["element.update"] = () => new Error("The element is read-only");
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    await typeText("?");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    await runCommand("close all buffers");
    expect(query("label").textContent).toBe("1 buffer with unsaved changes (SR-000001 Title 1)");
    expect([...shownAll(".candidates [role=option]")].map((option) => option.textContent)).toEqual([
      "Close all but the buffers with unsaved changes",
      "Close all and discard the unsaved changes",
    ]);
    expect(shownOne("dialog, [role=dialog], [role=alertdialog], [aria-modal]")).toBeNull();
    // Escape goes back to the command prompt (SR-134 AK1), and a second one closes it; every buffer stays.
    await keyDown(query("input"), "Escape");
    expect(query("label").textContent).toBe("Command");
    await keyDown(query("input"), "Escape");
    expect(shownOne("input")).toBeNull();
    await keyDown(window, "p", { ctrlKey: true });
    expect(shownAll(".candidates [role=option]")).toHaveLength(2);
    await keyDown(query("input"), "Escape");
    // Plain Enter takes the first choice: the buffer with unsaved text stays, and is still modified.
    await runCommand("close all buffers");
    await keyDown(query("input"), "Enter");
    expect(text("Minibuffer")).toBe("Closed 1 buffer");
    expect(editorView().state.doc.toString()).toBe("Hello!\n?");
    expect(text("Modeline")).toContain("modified");
    // The second choice closes everything and drops the unsaved text.
    await runCommand("close all buffers");
    await keyDown(query("input"), "ArrowDown");
    await keyDown(query("input"), "Enter");
    expect(query("[data-buffer]").getAttribute("aria-label")).toBe("Overview");
    expect(text("Minibuffer")).toBe("Closed 1 buffer");
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello!\n");
    expect(text("Modeline")).not.toContain("modified");
  });

  it("closes a buffer without unsaved text at once", async () => {
    await openElement();
    await runCommand("close buffer");
    expect(query('[role="listbox"]')).not.toBeNull();
  });

  it("drops the unsaved text when another workspace is opened", async () => {
    const { handlers, change } = await openElement();
    await typeText("!");
    handlers["workspace.status"] = () => ({ name: "Other", readOnly: false });
    await change("opened");
    await listAll();
    await keyDown(query('[role="listbox"]'), "Enter");
    expect(editorView().state.doc.toString()).toBe("Hello");
    expect(text("Modeline")).not.toContain("modified");
  });

  describe("inline references (ThomasBirkmaier/ReqSeq-archive#424)", () => {
    const TARGET = "00000000-0000-4000-8000-000000000002";
    const withReference = (link: string): Record<string, Handler> => {
      const handlers = withText();
      handlers["element.get"] = (input) =>
        input["ref"] === TARGET || input["ref"] === "uuid-2"
          ? { element: row(2, { text: "Target", relations: [] }) }
          : { element: row(1, { text: `${link} tail`, relations: [] }) };
      return handlers;
    };

    /** The questions for the element with this UUID. */
    const asked = (invoke: ReturnType<typeof fakeBridge>["invoke"], ref: string): unknown[] =>
      calls(invoke, "element.get").filter((input) => (input as { ref: string }).ref === ref);

    it("[SR-066/AK-c5xd] follows an inline reference with Ctrl+Enter, and Follow reference is in the command prompt with its key", async () => {
      const { invoke } = await openElement(withReference(`[Two](reqseq:${TARGET}?version=n1:aa)`));
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      await allCommands();
      expect([...shownAll('[role="option"]')].map((o) => o.textContent)).toContain(
        "Follow referenceCtrl+Enter",
      );
      await keyDown(query("input"), "Escape");
      // The caret inside the label "Two".
      act(() => {
        editorView().dispatch({ selection: { anchor: 2 } });
      });
      await keyDown(query("article"), "Enter", { ctrlKey: true });
      expect(asked(invoke, TARGET)).toEqual([{ ref: TARGET }]);
      expect(query("article h1").textContent).toBe("Title 2");
    });

    it("opens a reference that names a repository in that repository", async () => {
      const { invoke } = await openElement(withReference(`[Two](reqseq:${TARGET}?repository=r2)`));
      await runCommand("follow reference");
      // The editor asked for the title of the target in r2 (D-058, SR-066 AK2), then the command opened it there.
      expect(asked(invoke, TARGET)).toEqual([
        { ref: TARGET, repository: "r2" },
        { ref: TARGET, repository: "r2" },
      ]);
    });

    it("[SR-066/AK-c5xd] says when there is no reference at the cursor", async () => {
      // A reference in the text, the caret after it at the end of the text.
      const { invoke } = await openElement(
        withReference(`Before [Two](reqseq:${TARGET}?version=n1:aa) after`),
      );
      act(() => {
        editorView().dispatch({ selection: { anchor: editorView().state.doc.length } });
      });
      await keyDown(query("article"), "Enter", { metaKey: true });
      expect(text("Minibuffer")).toBe("No element reference at the cursor");
      expect(asked(invoke, TARGET)).toEqual([]);
      expect(query("article h1").textContent).toBe("Title 1");
    });

    it("says why a reference cannot be opened, and keeps the element", async () => {
      const { handlers } = await openElement(withReference(`[Two](reqseq:${TARGET})`));
      handlers["element.get"] = () => new Error(`More than one element has the ID "${TARGET}"`);
      await keyDown(query("article"), "Enter", { ctrlKey: true });
      expect(text("Minibuffer")).toBe(`More than one element has the ID "${TARGET}"`);
      expect(query("article h1").textContent).toBe("Title 1");
    });

    it("Ctrl+Enter in an open prompt runs the candidate only", async () => {
      const { invoke } = await openElement(withReference(`[Two](reqseq:${TARGET}?version=n1:aa)`));
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      await type("go to");
      await keyDown(query("input"), "Enter", { ctrlKey: true });
      expect(query("label").textContent).toBe("Go to");
      expect(asked(invoke, TARGET)).toEqual([]);
    });
  });

  describe("the list of the elements with a value (SR-132)", () => {
    const options = (): (string | null)[] =>
      [...shownAll('[role="option"]')].map((option) => option.textContent);

    it("[SR-132/AK-y207] Ctrl+Shift+Enter on an element asks among its values, and the value taken opens its list", async () => {
      const { invoke } = await openElement();
      // The facets of the element's own values, with its ID.
      expect(calls(invoke, "element.facets").at(-1)).toEqual({ selection: { ids: ["SR-000001"] } });
      await keyDown(query("article"), "Enter", { ctrlKey: true, shiftKey: true });
      expect(query("label").textContent).toBe("Elements with");
      expect(options()).toEqual(["status: draft", "type: needNeed"]);
      await type("type");
      await keyDown(query("input"), "Enter");
      expect(calls(invoke, "element.list").at(-1)).toEqual({
        selection: { where: { type: ["need"], subtypes: false } },
        sort: DEFAULT_SORT,
        limit: 200,
        offset: 0,
      });
      expect(text("Modeline")).toContain("type: need");
    });

    it("[SR-132/AK-y207] is in the command prompt with its key", async () => {
      await openElement();
      await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
      await allCommands();
      expect(options()).toContain("List elements with this valueCtrl+Shift+Enter");
      await type("list elements with");
      await keyDown(query("input"), "Enter");
      expect(query("label").textContent).toBe("Elements with");
    });

    it("[SR-132/AK-xc4j] a further filter narrows the list of a value like any list", async () => {
      const { invoke } = await openElement();
      await keyDown(query("article"), "Enter", { ctrlKey: true, shiftKey: true });
      await type("status");
      await keyDown(query("input"), "Enter");
      await runCommand("Filter list");
      await type("Type");
      await keyDown(query("input"), "Enter");
      await type("need");
      await keyDown(query("input"), "Enter");
      // "Take 1 type" (SR-124 AK7).
      await keyDown(query("input"), "Enter");
      expect(calls(invoke, "element.list").at(-1)).toMatchObject({
        selection: { where: { all: [{ status: ["draft"] }, { type: ["need"] }] } },
      });
      expect(text("Modeline")).toContain("status: draft · type: need");
    });
  });

  it("gives the editor the focus on Enter on the buffer, and the buffer on Escape", async () => {
    await openElement();
    expect(document.activeElement).toBe(query("article"));
    await keyDown(query("article"), "Enter");
    expect(editorView().hasFocus).toBe(true);
    await keyDown(query(".cm-content"), "Escape");
    expect(document.activeElement).toBe(query("article"));
  });
});
