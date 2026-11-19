// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act, createElement, Fragment, useLayoutEffect, useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Choice, Prompt, PromptFill } from "./action-types.js";
import { elementBuffer } from "./buffers.js";
import { Minibuffer } from "./Minibuffer.js";
import type { CatalogContext } from "./catalog-arguments.js";
import type { CommandListing } from "../shared/protocol.js";
import { catalogItems } from "./catalog-commands.js";
import { confirmationPrompt } from "./confirmation.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";
import {
  click,
  container,
  flush,
  press,
  query,
  queryInput,
  render,
  texts,
  type,
} from "./components.test-helper.js";

describe("Minibuffer", () => {
  const choice = (id: string, name: string, extra: Partial<Choice> = {}): Choice => ({
    id,
    name,
    run: vi.fn(),
    ...extra,
  });
  const mount = async (
    prompt: Prompt | undefined,
    closed: () => void = vi.fn(),
    command: () => void = vi.fn(),
    echo = "",
  ) => {
    await render(
      createElement(Minibuffer, {
        echo,
        prompt: prompt === undefined ? undefined : { serial: 1, prompt },
        onCommand: command,
        onClose: closed,
      }),
    );
    return { closed, command };
  };
  const input = (): HTMLInputElement => queryInput();

  it("is one quiet line while idle, and a click on it asks for a command", async () => {
    const { command } = await mount(undefined, vi.fn(), vi.fn(), "Searching is not ready");
    expect(query('[aria-label="Minibuffer"]').textContent).toBe("Searching is not ready");
    expect(container.querySelector("input")).toBeNull();
    // A click whose press began elsewhere (a hit taken by its press, released here) asks nothing.
    await click(query(".echo"));
    expect(command).not.toHaveBeenCalled();
    // A press and click anywhere on the line, also beside the message, asks for a command (SR-202 AK1).
    for (const target of [query(".echo"), query('[aria-label="Minibuffer"]')]) {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        await Promise.resolve();
      });
      await click(target);
    }
    expect(command).toHaveBeenCalledTimes(2);
  });

  it("opens what a linked message reports on a press and click on it, and the commands beside it (SR-223 AK8, SR-202 AK1)", async () => {
    const command = vi.fn();
    const open = vi.fn();
    await render(
      createElement(Minibuffer, {
        echo: "Created baseline R1.",
        onEcho: open,
        prompt: undefined,
        onCommand: command,
        onClose: vi.fn(),
      }),
    );
    for (const target of [query(".echo-open"), query('[aria-label="Minibuffer"]')]) {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        await Promise.resolve();
      });
      await click(target);
    }
    expect(query(".echo-open").textContent).toBe("Created baseline R1.");
    expect(open).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("shows the next keys as rows of key and command, without an input", async () => {
    const onCommand = vi.fn();
    await render(
      createElement(Minibuffer, {
        echo: "Ctrl+K-",
        prompt: undefined,
        onCommand,
        onClose: vi.fn(),
        nextKeys: [
          { key: "L", name: "List all elements" },
          { key: "B", name: "Close buffer" },
        ],
      }),
    );
    const rows = [...container.querySelectorAll('[aria-label="Next keys"] li')];
    expect(
      rows.map((row) => [row.querySelector(".key")?.textContent, row.querySelector(".name")?.textContent]),
    ).toEqual([
      ["L", "List all elements"],
      ["B", "Close buffer"],
    ]);
    expect(query('[aria-label="Next keys"]').getAttribute("role")).toBe("list");
    // The card of the next keys is no part of the line: a click on it asks for no command.
    const key = query('[aria-label="Next keys"] li');
    await act(async () => {
      key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await Promise.resolve();
    });
    await click(key);
    expect(onCommand).not.toHaveBeenCalled();
    expect(query(".echo").textContent).toBe("Ctrl+K-");
    expect(container.querySelector("input")).toBeNull();
    // No rows: nothing above the line.
    await render(
      createElement(Minibuffer, {
        echo: "Ctrl+K-",
        prompt: undefined,
        onCommand: vi.fn(),
        onClose: vi.fn(),
        nextKeys: [],
      }),
    );
    expect(container.querySelector('[aria-label="Next keys"]')).toBeNull();
  });

  it("asks: the label, an input, and the candidates with their shortcut, the first one selected", async () => {
    await mount({
      label: "Command",
      items: [choice("a", "Search elements", { hint: "Ctrl+Shift+F" }), choice("b", "Sort list")],
    });
    expect(query("label").textContent).toBe("Command");
    expect(texts('[role="option"]')).toEqual(["Search elementsCtrl+Shift+F", "Sort list"]);
    expect(texts(".hint")).toEqual(["Ctrl+Shift+F"]);
    expect(query("ul").getAttribute("role")).toBe("listbox");
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-activedescendant")).toBe("candidate-0");
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain("Search elements");
    expect(document.activeElement).toBe(input());
  });

  // The look (muted, smaller, at the right edge of the row) is the style's: `styles.test.ts`.
  const options = (): Element[] => [...container.querySelectorAll('[role="option"]')];
  const classes = (option: Element | undefined): string[] =>
    [...(option?.children ?? [])].map((part) => part.className);

  it("[SR-109/AK-d5b0] shows the shortcut of a hit right after its name, as a part of its own", async () => {
    await mount({
      label: "Command",
      items: [
        choice("a", "Search elements", { hint: "⌘⇧F" }),
        choice("b", "Save element", { hint: "Ctrl+S" }),
      ],
    });
    const [search, save] = options();
    expect(classes(search)).toEqual(["name", "hint"]);
    expect(search?.querySelector(".name")?.textContent).toBe("Search elements");
    expect(search?.querySelector(".hint")?.textContent).toBe("⌘⇧F");
    expect(classes(save)).toEqual(["name", "hint"]);
    expect(save?.querySelector(".hint")?.textContent).toBe("Ctrl+S");
    // Typing keeps the shortcut next to the hit; only the name is marked.
    await type(input(), "save");
    expect(texts('[role="option"]')).toEqual(["Save elementCtrl+S"]);
    expect(container.querySelector(".hint mark")).toBeNull();
  });

  it("[SR-109/AK-hxz3] shows nothing next to a hit without a shortcut", async () => {
    await mount({
      label: "Command",
      items: [
        choice("a", "Search elements", { hint: "Ctrl+Shift+F" }),
        choice("b", "Clear all list filters"),
      ],
    });
    const clear = options()[1];
    expect(classes(clear)).toEqual(["name"]);
    expect(clear?.textContent).toBe("Clear all list filters");
    // Also when it is the only hit.
    await type(input(), "clear");
    expect(texts('[role="option"]')).toEqual(["Clear all list filters"]);
    expect(container.querySelector(".hint")).toBeNull();
  });

  it("[SR-108/AK-qr4w] ranks the candidates by what is typed and marks the characters that matched", async () => {
    await mount({ label: "Command", items: [choice("a", "Sort list"), choice("b", "Search elements")] });
    await type(input(), "srch elem");
    expect(texts('[role="option"]')).toEqual(["Search elements"]);
    expect(texts("mark")).toEqual(["S", "rch", "elem"]);
    await type(input(), "zzzz");
    expect(container.querySelector("ul")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("[SR-108/AK-qr4w] marks the matched letters of a name found by its initials or with a typo", async () => {
    await mount({
      label: "Command",
      items: [choice("a", "Create relation"), choice("b", "List all elements"), choice("c", "Sort list")],
    });
    await type(input(), "crel");
    expect(texts('[role="option"]')).toEqual(["Create relation"]);
    expect(texts("mark")).toEqual(["C", "rel"]);
    await type(input(), "lae");
    expect(texts("mark")).toEqual(["L", "a", "e"]);
    await type(input(), "sotr");
    expect(texts('[role="option"]')).toEqual(["Sort list"]);
    expect(texts("mark").join("")).not.toBe("");
    // Nothing typed, nothing marked.
    await type(input(), "");
    expect(texts("mark")).toEqual([]);
  });

  it("[SR-131/AK-sxyz] puts the choice for the typed text first, so Enter takes it and Down reaches the others", async () => {
    const typed = vi.fn();
    const literal = vi.fn((text: string): Choice | undefined =>
      text.startsWith("/")
        ? choice(`folder:${text}`, `Open ${text}`, { hint: "folder", run: typed })
        : undefined,
    );
    const station = choice("w1", "/req/station");
    const { closed } = await mount({
      label: "Workspace",
      items: [station, choice("w2", "/req/buoy")],
      literal,
    });
    // Nothing typed: no choice of its own.
    expect(texts('[role="option"] .name')).toEqual(["/req/station", "/req/buoy"]);
    await type(input(), "/req/sta");
    expect(texts('[role="option"] .name')).toEqual(["Open /req/sta", "/req/station"]);
    expect(texts(".hint")).toEqual(["folder"]);
    await press(input(), "ArrowDown");
    expect(container.querySelector('[aria-selected="true"] .name')?.textContent).toBe("/req/station");
    await press(input(), "ArrowUp");
    await press(input(), "Enter");
    expect(closed).toHaveBeenCalledOnce();
    expect(typed).toHaveBeenCalledOnce();
    expect(station.run).not.toHaveBeenCalled();
    // A text that is no folder path is narrowed as usual.
    await mount({ label: "Workspace", items: [station], literal });
    await type(input(), "stat");
    expect(texts('[role="option"] .name')).toEqual(["/req/station"]);
  });

  it("shows what seek finds alone or with its own items, its note in the label, and a completing choice keeps the prompt open", async () => {
    const station = choice("w1", "/req/station");
    const run = vi.fn();
    const seek = vi.fn((text: string) =>
      Promise.resolve(
        text.startsWith("/")
          ? {
              choices: [
                choice("e1", "requirements/", { complete: "/req/requirements/", marks: [[0, 1]], run }),
              ],
              alone: true,
            }
          : text === "gone"
            ? { choices: [], note: "/gone is missing" }
            : { choices: [] },
      ),
    );
    const { closed } = await mount({ label: "Workspace", items: [station], seek });
    await type(input(), "/req/r");
    expect(texts('[role="option"] .name')).toEqual(["requirements/"]);
    expect(texts("mark")).toEqual(["r"]);
    await press(input(), "Enter");
    expect(input().value).toBe("/req/requirements/");
    expect(closed).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(seek).toHaveBeenLastCalledWith("/req/requirements/");
    // By a click too.
    await act(async () => {
      query('[role="option"]').dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await flush();
    expect(input().value).toBe("/req/requirements/");
    // Other text: the prompt's own items, and the note while it holds.
    await type(input(), "stat");
    expect(texts('[role="option"] .name')).toEqual(["/req/station"]);
    expect(texts("label.prompt-label")).toEqual(["Workspace"]);
    await type(input(), "gone");
    expect(texts("label.prompt-label")).toEqual(["/gone is missing · Workspace"]);
    await type(input(), "");
    expect(texts("label.prompt-label")).toEqual(["Workspace"]);
  });

  it("never selects or chooses a row that only informs", async () => {
    const more = choice("more", "… 3 more", { inert: true });
    const entry = choice("e1", "a/", { complete: "/a/" });
    const { closed } = await mount({
      label: "Workspace",
      items: [],
      seek: () => Promise.resolve({ choices: [entry, more], alone: true }),
    });
    await type(input(), "/");
    await press(input(), "ArrowDown");
    await press(input(), "ArrowDown");
    expect(container.querySelector('[aria-selected="true"] .name')?.textContent).toBe("a/");
    expect(query('[aria-disabled="true"] .name').textContent).toBe("… 3 more");
    await act(async () => {
      query('[aria-disabled="true"]').dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await flush();
    expect(input().value).toBe("/");
    expect(closed).not.toHaveBeenCalled();
    expect(more.run).not.toHaveBeenCalled();
  });

  describe("argument entry of catalog commands (ThomasBirkmaier/ReqSeq-archive#85)", () => {
    it("[SR-108/AK-qr4w] marks the matched characters of an argument's candidates", async () => {
      await mount({
        label: "Create relation SR-1 · kind:",
        items: [choice("a", "derives from"), choice("b", "refines")],
      });
      await type(input(), "der");
      expect(texts('[role="option"]')).toEqual(["derives from"]);
      expect(texts("mark")).toEqual(["der"]);
    });

    it("[SR-108/AK-v62v] completes a typed fragment of a value as it does commands: initials and a slip find it first, the matched characters marked", async () => {
      // The status prompt "Set status" builds for a shown requirement, from `element.get` and `metamodel.get`.
      // The catalog entry of `element.setStatus`, as `commands()` lists it.
      const setStatus = {
        name: "element.setStatus",
        title: "Set status",
        effect: "write",
        implemented: true,
        arguments: [
          { field: "refs", complete: "element" },
          { field: "status", complete: "status", of: "refs" },
        ],
        input: { type: "object", properties: { refs: { type: "array" } }, required: ["refs", "status"] },
      } as unknown as CommandListing;
      const asked: Prompt[] = [];
      const call = vi.fn((name: string) =>
        Promise.resolve({
          ok: true,
          output: name === "element.get" ? { element: { type: "requirement" } } : FIXTURE_METAMODEL,
        }),
      );
      const context = {
        workspace: true,
        buffers: [elementBuffer("uuid-1", "spec", "SR-1 Title 1")],
        call,
        ask: (prompt: Prompt) => asked.push(prompt),
        echo: vi.fn(),
        drafted: () => false,
      } as unknown as CatalogContext;
      const filled = async (): Promise<Prompt> => {
        await flush();
        const prompt = asked.at(-1);
        if (prompt === undefined) {
          throw new Error("nothing asked");
        }
        return prompt.fill === undefined ? prompt : { ...prompt, ...(await prompt.fill) };
      };
      catalogItems(context, [setStatus], [])[0]?.run();
      (await filled()).items[0]?.run();
      (await filled()).empty?.(false);
      const status = await filled();
      expect(status.label).toBe("Set status SR-1 · status:");
      await mount(status);
      await type(input(), "aprv");
      expect(texts('[role="option"] .name')[0]).toBe("Approved");
      expect(texts("mark").join("")).toBe("Aprv");
      await type(input(), "aproved");
      expect(texts('[role="option"] .name')[0]).toBe("Approved");
    });

    it("goes back on Backspace in an empty input, and leaves Backspace in a typed text to the input", async () => {
      const back = vi.fn();
      const { closed } = await mount({ label: "kind:", items: [choice("a", "refines")], back });
      await type(input(), "r");
      await press(input(), "Backspace");
      expect(back).not.toHaveBeenCalled();
      await type(input(), "");
      await press(input(), "Backspace");
      expect(closed).toHaveBeenCalledTimes(1);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("[SR-134/AK-trng] goes back one step on Escape in a later step, whatever is typed, and runs nothing", async () => {
      const back = vi.fn();
      const cancel = vi.fn();
      const refines = choice("a", "refines");
      const { closed } = await mount({ label: "kind:", items: [refines], back, cancel });
      await type(input(), "r");
      await press(input(), "Escape");
      expect(closed).toHaveBeenCalledWith(false);
      expect(back).toHaveBeenCalledTimes(1);
      // A prompt that waited for an answer is told that it got none.
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(refines.run).not.toHaveBeenCalled();
    });

    it("[SR-134/AK-trng] [SR-134/AK-fmf6] goes back to the prompt an action asked before on Escape, and on Backspace in an empty input", async () => {
      const previous = vi.fn();
      const { closed } = await mount({ label: "Text", items: [], text: vi.fn(), previous });
      await press(input(), "Escape");
      expect(closed).toHaveBeenCalledWith(false);
      expect(previous).toHaveBeenCalledTimes(1);
      const again = vi.fn();
      const typed = await mount({ label: "Text", items: [], text: vi.fn(), previous: again });
      await type(input(), "a");
      await press(input(), "Backspace");
      expect(again).not.toHaveBeenCalled();
      expect(typed.closed).not.toHaveBeenCalled();
      await type(input(), "");
      await press(input(), "Backspace");
      expect(again).toHaveBeenCalledTimes(1);
      expect(typed.closed).toHaveBeenCalledWith(false);
    });

    it("takes the selected candidate, else the typed text, with Ctrl/Cmd+Enter for the optional arguments", async () => {
      const more = vi.fn();
      const text = vi.fn();
      await mount({ label: "kind:", items: [choice("a", "refines", { more })], more: text });
      await press(input(), "Enter", { ctrlKey: true });
      expect(more).toHaveBeenCalledTimes(1);
      await mount({ label: "maxDepth:", items: [], more: text });
      await type(input(), "2");
      await press(input(), "Enter", { metaKey: true });
      expect(text).toHaveBeenCalledWith("2");
    });

    it("never lets Ctrl/Cmd+Enter or Backspace in an empty input out of a prompt (no Follow reference)", async () => {
      const window = vi.fn();
      document.addEventListener("keydown", window);
      try {
        const overview = choice("a", "Overview");
        const { closed } = await mount({ label: "Go to", items: [overview] });
        await press(input(), "Backspace");
        expect(closed).not.toHaveBeenCalled();
        // Without optional arguments Ctrl/Cmd+Enter takes the candidate, as Enter does.
        await press(input(), "Enter", { ctrlKey: true });
        expect(window).not.toHaveBeenCalled();
        expect(overview.run).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener("keydown", window);
      }
    });

    describe("parts that come later (`fill`)", () => {
      /** A `fill` the test resolves. */
      const later = () => {
        let resolve: (parts: PromptFill) => void = () => undefined;
        const fill = new Promise<PromptFill>((done) => {
          resolve = done;
        });
        const arrive = async (parts: PromptFill): Promise<void> => {
          await act(async () => {
            resolve(parts);
            await Promise.resolve();
          });
          await flush();
        };
        return { fill, arrive };
      };

      it("is open with its label at once and keeps what is typed while the parts load", async () => {
        const { fill, arrive } = later();
        const { closed } = await mount({ label: "Create relation · kind:", items: [], fill });
        expect(query("label").textContent).toBe("Create relation · kind:");
        expect(document.activeElement).toBe(input());
        await type(input(), "ref");
        await arrive({ items: [choice("a", "derives from"), choice("b", "refines")] });
        expect(input().value).toBe("ref");
        expect(texts('[role="option"]')).toEqual(["refines"]);
        expect(closed).not.toHaveBeenCalled();
      });

      it("takes the candidate on an Enter pressed while they load, once they arrive", async () => {
        const { fill, arrive } = later();
        const refines = choice("b", "refines");
        const { closed } = await mount({ label: "kind:", items: [], fill });
        await type(input(), "ref");
        await press(input(), "Enter");
        expect(closed).not.toHaveBeenCalled();
        await arrive({ items: [choice("a", "derives from"), refines] });
        expect(refines.run).toHaveBeenCalledTimes(1);
        expect(closed).toHaveBeenCalledTimes(1);
      });

      it("drops an Enter pressed while they load when the text changes afterwards", async () => {
        const { fill, arrive } = later();
        const refines = choice("b", "refines");
        const { closed } = await mount({ label: "kind:", items: [], fill });
        await type(input(), "ref");
        await press(input(), "Enter");
        await type(input(), "re");
        await arrive({ items: [choice("a", "derives from"), refines] });
        expect(refines.run).not.toHaveBeenCalled();
        expect(closed).not.toHaveBeenCalled();
        expect(texts('[role="option"]')).toEqual(["refines", "derives from"]);
      });

      it("searches the text typed meanwhile and takes the first hit with the optional arguments on Ctrl/Cmd+Enter", async () => {
        const { fill, arrive } = later();
        const hit = choice("e", "SR-4 Title 4", { more: vi.fn() });
        const find = vi.fn(() => Promise.resolve([hit]));
        await mount({ label: "ref:", items: [], fill });
        await type(input(), "tit");
        await press(input(), "Enter", { ctrlKey: true });
        await arrive({ items: [], find });
        expect(find).toHaveBeenCalledWith("tit");
        expect(hit.more).toHaveBeenCalledTimes(1);
      });

      it("ends on Escape while they load; parts that arrive later fill nothing", async () => {
        const { fill, arrive } = later();
        const cancel = vi.fn();
        const { closed } = await mount({ label: "kind:", items: [], fill, cancel });
        await press(input(), "Escape");
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(closed).toHaveBeenCalledTimes(1);
        await render(
          createElement(Minibuffer, { echo: "", prompt: undefined, onCommand: vi.fn(), onClose: closed }),
        );
        await arrive({ items: [choice("a", "refines")] });
        expect(container.querySelector("input")).toBeNull();
      });

      it("shows a label that came later, such as why the values could not be read", async () => {
        const { fill, arrive } = later();
        await mount({ label: "kind:", items: [], fill });
        await arrive({ label: "No workspace · kind:" });
        expect(query("label").textContent).toBe("No workspace · kind:");
      });

      it("keeps a key typed between the render that shows them and its effect, and searches the newest text (ThomasBirkmaier/ReqSeq-archive#757)", async () => {
        let resolve: (parts: PromptFill) => void = () => undefined;
        const fill = new Promise<PromptFill>((done) => {
          resolve = done;
        });
        const hit = choice("d2", "D-2 Shield the wind vane");
        const find = vi.fn((text: string) => Promise.resolve(text.startsWith("win") ? [hit] : []));
        // The render with the parts asks `remembered` for the typed text; a key queued there comes after that
        // render's commit and before its passive effect, as a key does when the window is busy. `act` would
        // run the effect at once, so the parts arrive and the key comes outside it, with React's scheduler.
        let parts = false;
        let keyed = false;
        const use = {
          score: () => 0,
          remembered: (text: string) => {
            if (parts && !keyed && text === "wi") {
              keyed = true;
              queueMicrotask(() => {
                const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
                const set = Reflect.get(descriptor ?? {}, "set") as (
                  this: HTMLInputElement,
                  value: string,
                ) => void;
                set.call(input(), "win");
                input().dispatchEvent(new Event("input", { bubbles: true }));
              });
            }
            return undefined;
          },
          record: vi.fn(),
        };
        await mount({ label: "target:", items: [], fill, use });
        await type(input(), "wi");
        const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
        environment.IS_REACT_ACT_ENVIRONMENT = false;
        try {
          parts = true;
          resolve({ items: [], find });
          await new Promise((done) => setTimeout(done, 50));
        } finally {
          environment.IS_REACT_ACT_ENVIRONMENT = true;
        }
        expect(keyed).toBe(true);
        expect(input().value).toBe("win");
        expect(find).toHaveBeenLastCalledWith("win");
        await type(input(), `${input().value}d`);
        expect(input().value).toBe("wind");
        expect(texts('[role="option"]')).toEqual(["D-2 Shield the wind vane"]);
      });
    });

    describe("the command help (SR-210 AK4)", () => {
      const helped = (id: string, title: string): Choice =>
        choice(id, title, { explain: { summary: `${title}.` }, help: { title, summary: `${title}.` } });
      const drawer = (): HTMLElement => query("#command-help");
      const open = (): boolean => drawer().dataset["open"] === "true";

      it("[SR-210/AK-pxr7] closes when its command leaves the hits, and does not open again when it comes back", async () => {
        let resolve: (parts: PromptFill) => void = () => undefined;
        const fill = new Promise<PromptFill>((done) => {
          resolve = done;
        });
        const first = helped("a", "List hints");
        const other = helped("b", "Sort list");
        await mount({ label: "Command", explains: true, items: [first, other], fill });
        await press(input(), "h", { ctrlKey: true });
        expect(open()).toBe(true);
        expect(query("#command-help h2").textContent).toBe("List hints");
        // The hits change without a key (the catalog arrives): the marked command is gone.
        await act(async () => {
          resolve({ items: [other] });
          await Promise.resolve();
        });
        await flush();
        expect(open()).toBe(false);
        expect(drawer().getAttribute("aria-hidden")).toBe("true");
        expect(texts('[role="option"] .name')).toEqual(["Sort list"]);
        expect(first.run).not.toHaveBeenCalled();
        expect(other.run).not.toHaveBeenCalled();
      });

      it("[SR-210/AK-pxr7] a key pressed while the help has the focus acts in the input; Ctrl/Cmd+C and a modifier alone stay with the help", async () => {
        await mount({ label: "Command", explains: true, items: [helped("a", "List hints")] });
        await press(input(), "h", { ctrlKey: true });
        expect(open()).toBe(true);
        // A selection in the help keeps its focus: the key that copies and the modifier before it.
        act(() => {
          drawer().focus();
        });
        for (const [key, init] of [
          ["Control", { ctrlKey: true }],
          ["Meta", { metaKey: true }],
          ["c", { ctrlKey: true }],
          ["c", { metaKey: true }],
        ] as const) {
          await press(drawer(), key, init);
          expect(document.activeElement, key).toBe(drawer());
        }
        expect(open()).toBe(true);
        // Any other key goes to the input and acts there: Escape closes the help, and the prompt stays.
        await press(drawer(), "Escape");
        expect(document.activeElement).toBe(input());
        expect(open()).toBe(false);
        expect(query("label").textContent).toBe("Command");
      });

      it("[SR-210/AK-pxr7] a click in the help that selects nothing gives the focus back to the input; one that selects keeps it", async () => {
        await mount({ label: "Command", explains: true, items: [helped("a", "List hints")] });
        await press(input(), "h", { ctrlKey: true });
        const release = async (): Promise<void> => {
          await act(async () => {
            drawer().dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            await Promise.resolve();
          });
        };
        // Text selected in the help: the focus stays, so Ctrl/Cmd+C copies it.
        act(() => {
          drawer().focus();
        });
        const range = document.createRange();
        range.selectNodeContents(query("#command-help .help-summary"));
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
        await release();
        expect(document.activeElement).toBe(drawer());
        // A plain click: the input has the focus again.
        document.getSelection()?.removeAllRanges();
        await release();
        expect(document.activeElement).toBe(input());
        expect(open()).toBe(true);
      });
    });

    it("ends a list argument with Enter on an empty input, and takes a candidate once something is typed", async () => {
      const empty = vi.fn();
      const refines = choice("a", "refines");
      await mount({ label: "refs:", items: [refines], empty });
      await press(input(), "Enter");
      expect(empty).toHaveBeenCalledTimes(1);
      await mount({ label: "refs:", items: [refines], empty });
      await type(input(), "ref");
      await press(input(), "Enter");
      expect(refines.run).toHaveBeenCalledTimes(1);
    });

    it("ends a list argument with Ctrl/Cmd+Enter on an empty input instead of taking the first candidate", async () => {
      const empty = vi.fn();
      const refines = choice("a", "refines", { more: vi.fn() });
      const { closed } = await mount({ label: "refs:", items: [refines], empty });
      await press(input(), "Enter", { ctrlKey: true });
      expect(empty).toHaveBeenCalledWith(true);
      expect(refines.run).not.toHaveBeenCalled();
      expect(refines.more).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalledTimes(1);
      await mount({ label: "refs:", items: [refines], empty });
      await press(input(), "Enter");
      expect(empty).toHaveBeenLastCalledWith(false);
    });

    it("remembers only a choice among the prompt's own items, never an element found for the text", async () => {
      const record = vi.fn();
      const use = { score: () => 0, remembered: () => undefined, record };
      await mount({
        label: "Command",
        items: [choice("own", "Overview")],
        find: () => Promise.resolve([choice("element:1", "SR-1 Zebra")]),
        use,
      });
      await type(input(), "zebra");
      await press(input(), "Enter");
      expect(record).not.toHaveBeenCalled();
      await type(input(), "over");
      await press(input(), "Enter");
      expect(record).toHaveBeenCalledWith("over", "own");
    });
    it("shows the element titled exactly like the typed text first, and Enter opens it (#195)", async () => {
      const recent = choice("sr-1", "SR-1 Requirement 1 of the package 1");
      const pkg = choice("pkg", "PKG-1 Package 1", { title: "Package 1" });
      await mount({ label: "Go to", items: [recent], find: () => Promise.resolve([pkg]) });
      await type(input(), "Package 1");
      expect(texts('[role="option"]')).toEqual(["PKG-1 Package 1", "SR-1 Requirement 1 of the package 1"]);
      await press(input(), "Enter");
      expect(pkg.run).toHaveBeenCalledTimes(1);
      expect(recent.run).not.toHaveBeenCalled();
    });
  });

  describe("what was chosen before", () => {
    const use = (remembered: Record<string, string> = {}, scores: Record<string, number> = {}) => ({
      score: (id: string): number => scores[id] ?? 0,
      remembered: (typed: string): string | undefined => remembered[typed],
      record: vi.fn<(typed: string, id: string) => void>(),
    });
    const filters = (extra: Partial<Prompt>): Prompt => ({
      label: "Command",
      items: [choice("type", "Filter list by type"), choice("status", "Filter list by status")],
      ...extra,
    });

    it("[SR-121/AK-ynwj] puts the command remembered for the typed text first, and Enter runs it", async () => {
      const prompt = filters({ use: use({ fl: "status" }) });
      const { closed } = await mount(prompt);
      expect(texts('[role="option"]')).toEqual(["Filter list by type", "Filter list by status"]);
      await type(input(), "fl");
      expect(texts('[role="option"]')).toEqual(["Filter list by status", "Filter list by type"]);
      expect(input().getAttribute("aria-activedescendant")).toBe("candidate-0");
      await press(input(), "Enter");
      expect(closed).toHaveBeenCalledTimes(1);
      expect(prompt.items[1]?.run).toHaveBeenCalledTimes(1);
      expect(prompt.items[0]?.run).not.toHaveBeenCalled();
    });

    it("[SR-108/AK-f6t5] orders equally good hits by use, and an empty text too", async () => {
      await mount(filters({ use: use({}, { status: 3 }) }));
      expect(texts('[role="option"]')).toEqual(["Filter list by status", "Filter list by type"]);
      await type(input(), "fil");
      expect(texts('[role="option"]')).toEqual(["Filter list by status", "Filter list by type"]);
    });

    it("[SR-121/AK-ynwj] records the typed text and the command on Enter and on a click", async () => {
      const recorded = use();
      await mount(filters({ use: recorded }));
      await type(input(), "fl");
      await press(input(), "ArrowDown");
      await press(input(), "Enter");
      expect(recorded.record).toHaveBeenLastCalledWith("fl", "status");
      await mount(filters({ use: recorded }));
      await type(input(), "flt");
      await act(async () => {
        query('[role="option"]').dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        await Promise.resolve();
      });
      expect(recorded.record).toHaveBeenLastCalledWith("flt", "type");
      expect(recorded.record).toHaveBeenCalledTimes(2);
    });

    it("[SR-121/AK-ynwj] records the typed text and the command on Ctrl/Cmd+Enter as on Enter", async () => {
      const recorded = use();
      const more = vi.fn();
      const prompt = filters({ use: recorded });
      await mount({
        ...prompt,
        items: [choice("type", "Filter list by type", { more }), ...prompt.items.slice(1)],
      });
      await type(input(), "flt");
      await press(input(), "Enter", { ctrlKey: true });
      expect(recorded.record).toHaveBeenCalledWith("flt", "type");
      expect(more).toHaveBeenCalledTimes(1);
    });

    it("records nothing for an Escape or for typed text", async () => {
      const recorded = use();
      await mount(filters({ use: recorded }));
      await type(input(), "fl");
      await press(input(), "Escape");
      expect(recorded.record).not.toHaveBeenCalled();
      const text = vi.fn();
      await mount({ label: "Search", items: [], text, use: recorded });
      await type(input(), "wind");
      await press(input(), "Enter");
      expect(text).toHaveBeenCalledWith("wind");
      expect(recorded.record).not.toHaveBeenCalled();
    });
  });

  it("[SR-122/AK-n8p6] moves the selection with Down, Up and Tab, and stays inside the list", async () => {
    await mount({ label: "Command", items: [choice("a", "One"), choice("b", "Two"), choice("c", "Three")] });
    const selected = (): string | null | undefined =>
      container.querySelector('[aria-selected="true"]')?.textContent;
    await press(input(), "ArrowUp");
    expect(selected()).toBe("One");
    await press(input(), "ArrowDown");
    expect(selected()).toBe("Two");
    await press(input(), "Tab");
    expect(selected()).toBe("Three");
    await press(input(), "ArrowDown");
    expect(selected()).toBe("Three");
    await press(input(), "ArrowUp");
    expect(selected()).toBe("Two");
    await press(input(), "x");
    expect(selected()).toBe("Two");
  });

  it("[SR-122/AK-kjhn] moves the selection with Ctrl+N and Ctrl+P, and stays inside the list", async () => {
    await mount({ label: "Command", items: [choice("a", "One"), choice("b", "Two"), choice("c", "Three")] });
    const selected = (): string | null | undefined =>
      container.querySelector('[aria-selected="true"]')?.textContent;
    await press(input(), "p", { ctrlKey: true });
    expect(selected()).toBe("One");
    await press(input(), "n", { ctrlKey: true });
    expect(selected()).toBe("Two");
    await press(input(), "N", { ctrlKey: true });
    expect(selected()).toBe("Three");
    await press(input(), "n", { ctrlKey: true });
    expect(selected()).toBe("Three");
    await press(input(), "p", { ctrlKey: true });
    expect(selected()).toBe("Two");
    await press(input(), "n", { ctrlKey: true, metaKey: true });
    expect(selected()).toBe("Two");
  });

  it("[SR-122/AK-h65p] Ctrl+N and Ctrl+P do not reach the window", async () => {
    await mount({ label: "Command", items: [choice("a", "One"), choice("b", "Two")] });
    const reached = vi.fn();
    window.addEventListener("keydown", reached);
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      input().dispatchEvent(event);
      await Promise.resolve();
    });
    window.removeEventListener("keydown", reached);
    expect(reached).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("runs the selected candidate on Enter, after it has closed the prompt", async () => {
    const order: string[] = [];
    const items = [
      choice("a", "One"),
      choice("b", "Two", {
        run: () => {
          order.push("run");
        },
      }),
    ];
    await mount({ label: "Command", items }, () => {
      order.push("close");
    });
    await press(input(), "ArrowDown");
    await press(input(), "Enter");
    expect(order).toEqual(["close", "run"]);
  });

  it("runs a candidate that is clicked, and ends the prompt on Escape", async () => {
    const items = [choice("a", "One"), choice("b", "Two")];
    const { closed } = await mount({ label: "Command", items });
    await act(async () => {
      query('[role="option"]:nth-child(2)').dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(items[1]?.run).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    await press(input(), "Escape");
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it("[SR-134/AK-cxgz] ends the prompt on a press of a mouse button outside it, in any step, and lets the press go on", async () => {
    const cancel = vi.fn();
    const items = [choice("a", "One")];
    const closed = vi.fn();
    await mount({ label: "Command", items, cancel }, closed);
    const mouseDown = (target: Element, button = 0): MouseEvent => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    };
    mouseDown(input());
    mouseDown(query(".prompt-label"));
    mouseDown(query(".card"));
    expect(closed).not.toHaveBeenCalled();
    const outside = document.createElement("p");
    const pressed = vi.fn();
    outside.addEventListener("mousedown", pressed);
    document.body.append(outside);
    mouseDown(outside, 3);
    mouseDown(outside, 4);
    expect(closed).not.toHaveBeenCalled();
    const event = mouseDown(outside, 2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith(true);
    expect(pressed).toHaveBeenCalledTimes(3);
    expect(event.defaultPrevented).toBe(false);
    expect(items[0]?.run).not.toHaveBeenCalled();
    outside.remove();
  });

  it("[SR-129/AK-rbjm] tells the prompt that Escape cancelled it, before it closes", async () => {
    const order: string[] = [];
    const cancel = vi.fn(() => order.push("cancel"));
    await mount(
      { label: "Insert reference", items: [choice("a", "One")], cancel },
      vi.fn(() => order.push("close")),
    );
    await press(input(), "Escape");
    expect(order).toEqual(["cancel", "close"]);
  });

  it("[SR-129/AK-nxbm] does not tell the prompt it was cancelled when a choice or free text answers it", async () => {
    const cancel = vi.fn();
    await mount({ label: "Insert reference", items: [choice("a", "One")], cancel });
    await press(input(), "Enter");
    expect(cancel).not.toHaveBeenCalled();
    await mount({ label: "Search", items: [], text: vi.fn(), cancel });
    await press(input(), "Enter");
    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps the selection in range with no candidates", async () => {
    await mount({ label: "Search", items: [], text: vi.fn() });
    await press(queryInput(), "ArrowDown");
    await press(queryInput(), "Tab");
    await press(queryInput(), "ArrowUp");
    await type(queryInput(), "a");
    expect(queryInput().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("runs free text on Enter (the search prompt), and does nothing with nothing to run", async () => {
    const text = vi.fn();
    const { closed } = await mount({ label: "Search", items: [], text });
    expect(container.querySelector("ul")).toBeNull();
    await type(input(), "wind speed");
    await press(input(), "Enter");
    expect(text).toHaveBeenCalledWith("wind speed");
    expect(closed).toHaveBeenCalledTimes(1);
    const none = await mount({ label: "Command", items: [] });
    await press(input(), "Enter");
    expect(none.closed).not.toHaveBeenCalled();
  });

  it("adds the elements that core finds, after the matching buffers, without the buffers twice", async () => {
    const find = vi.fn((text: string) =>
      Promise.resolve([
        choice("element:spec:1", "SR-036 Wind", { marks: [[7, 11]] }),
        choice("element:spec:2", "SR-037 Windy", { marks: [[7, 12]] }),
        choice("element:spec:3", `Hit for ${text}`),
      ]),
    );
    await mount({
      label: "Go to",
      items: [choice("element:spec:1", "SR-036 Wind"), choice("list", "All elements")],
      find,
    });
    expect(texts('[role="option"]')).toEqual(["SR-036 Wind", "All elements"]);
    expect(find).not.toHaveBeenCalled();
    await type(input(), "wind");
    expect(find).toHaveBeenCalledWith("wind");
    expect(texts('[role="option"]')).toEqual(["SR-036 Wind", "SR-037 Windy", "Hit for wind"]);
    expect(texts("mark")).toEqual(["Wind", "Windy"]);
    await type(input(), "");
    expect(texts('[role="option"]')).toEqual(["SR-036 Wind", "All elements"]);
  });

  it("[SR-115/AK-gxzy] Go to finds a buffer by a fuzzy text (initials, a slip) and keeps the order of use among equal matches; the elements shown last follow the buffers, an open element is listed once", async () => {
    const buffers = [
      choice("element:spec:8", "SR-038 Wind vane"),
      choice("element:spec:1", "SR-036 Wind speed"),
      choice("list", "All elements"),
      choice("overview", "Overview"),
    ];
    const recents = [choice("element:spec:2", "SR-037 Wind direction")];
    const find = vi.fn(() =>
      Promise.resolve([
        choice("element:spec:1", "SR-036 Wind speed", { marks: [[7, 11]] }),
        choice("element:spec:9", "SR-099 Windmill", { marks: [[7, 15]] }),
      ]),
    );
    const { closed } = await mount({
      label: "Go to",
      items: [...buffers, ...recents],
      find,
    });
    // Nothing typed: the buffers in order of use, then the element shown last that is not open.
    expect(texts('[role="option"] .name')).toEqual([
      "SR-038 Wind vane",
      "SR-036 Wind speed",
      "All elements",
      "Overview",
      "SR-037 Wind direction",
    ]);
    // Initials, and a slip (two letters swapped).
    await type(input(), "ae");
    expect(texts('[role="option"] .name')[0]).toBe("All elements");
    await type(input(), "ovrevie");
    expect(texts('[role="option"] .name')[0]).toBe("Overview");
    // Equal matches keep the order of use; core's hits follow, the open element not twice.
    await type(input(), "wind");
    expect(texts('[role="option"] .name')).toEqual([
      "SR-038 Wind vane",
      "SR-036 Wind speed",
      "SR-037 Wind direction",
      "SR-099 Windmill",
    ]);
    await press(input(), "ArrowDown");
    await press(input(), "ArrowDown");
    await press(input(), "Enter");
    expect(closed).toHaveBeenCalledOnce();
    expect(recents[0]?.run).toHaveBeenCalledOnce();
  });

  it("[SR-108/AK-qr4w] marks the matched words of an element hit, not the whole name", async () => {
    await mount({
      label: "Go to",
      items: [],
      find: () =>
        Promise.resolve([
          choice("e1", "SR-036 Windy day", {
            marks: [
              [0, 6],
              [7, 12],
            ],
          }),
        ]),
    });
    await type(input(), "windy");
    expect(texts("mark")).toEqual(["SR-036", "Windy"]);
  });

  it("drops an answer of core that comes after a newer question", async () => {
    const answers: ((choices: Choice[]) => void)[] = [];
    const find = vi.fn(
      () =>
        new Promise<Choice[]>((resolve) => {
          answers.push(resolve);
        }),
    );
    await mount({ label: "Go to", items: [], find });
    await type(input(), "wi");
    await type(input(), "win");
    await act(async () => {
      answers[1]?.([choice("new", "Newer")]);
      await Promise.resolve();
    });
    await act(async () => {
      answers[0]?.([choice("old", "Older")]);
      await Promise.resolve();
    });
    expect(texts('[role="option"]')).toEqual(["Newer"]);
  });

  describe("Enter before the hits have arrived (SR-119 AK1)", () => {
    /** A `find` whose answers the test gives, one per question, in the order they were asked. */
    const deferred = () => {
      const asked: { text: string; answer: (choices: Choice[]) => void }[] = [];
      const find = (text: string): Promise<Choice[]> =>
        new Promise<Choice[]>((resolve) => {
          asked.push({ text, answer: resolve });
        });
      const answer = async (text: string, choices: Choice[]): Promise<void> => {
        await act(async () => {
          asked.find((question) => question.text === text)?.answer(choices);
          await Promise.resolve();
        });
        await flush();
      };
      return { find, answer };
    };

    it("[SR-119/AK-mb64] opens the first hit as soon as the hits of the typed text arrive", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const hit = choice("e1", "SR-118 Calm start");
      await type(input(), "SR-118");
      await press(input(), "Enter");
      expect(hit.run).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await answer("SR-118", [hit, choice("e2", "SR-119 Other")]);
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("[SR-119/AK-mb64] opens the hit of the full text, not the hit of an earlier prefix", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const stale = choice("old", "S-001 Starts with S");
      const wanted = choice("new", "SR-118 Calm start");
      await type(input(), "S");
      await answer("S", [stale]);
      expect(texts('[role="option"]')).toEqual(["S-001 Starts with S"]);
      await type(input(), "SR-118");
      // The rows still hold the hits of "S": Enter must wait, not open one of them.
      await press(input(), "Enter");
      expect(stale.run).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await answer("SR-118", [wanted]);
      expect(wanted.run).toHaveBeenCalledTimes(1);
      expect(stale.run).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("says searching while an Enter waits, and not once typing has cancelled it (#467)", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const waitingSign = (): string | null | undefined =>
        container.querySelector('[role="status"]')?.textContent;
      await type(input(), "SR-1");
      expect(waitingSign()).toBeUndefined();
      await press(input(), "Enter");
      expect(waitingSign()).toBe("searching…");
      await type(input(), "SR-11");
      expect(waitingSign()).toBeUndefined();
      await press(input(), "Enter");
      expect(waitingSign()).toBe("searching…");
      const hit = choice("e1", "SR-118 Calm start");
      await answer("SR-11", [hit]);
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("says searching while an Enter waits for the parts of the prompt (#467)", async () => {
      let fill: (parts: PromptFill) => void = () => undefined;
      const hit = choice("draft", "draft");
      await mount({
        label: "Status",
        items: [],
        fill: new Promise<PromptFill>((resolve) => {
          fill = resolve;
        }),
      });
      await type(input(), "draft");
      await press(input(), "Enter");
      expect(container.querySelector('[role="status"]')?.textContent).toBe("searching…");
      await act(async () => {
        fill({ items: [hit] });
        await Promise.resolve();
      });
      await flush();
      expect(hit.run).toHaveBeenCalledTimes(1);
    });

    it("takes the typed text at once in a prompt whose hits only preview, while its parts still load", async () => {
      const text = vi.fn();
      const { closed } = await mount({
        label: "Name",
        items: [],
        preview: true,
        text,
        fill: new Promise<PromptFill>(() => undefined),
      });
      await type(input(), "Drafts");
      await press(input(), "Enter");
      // Nothing waits, so a key typed next cannot cancel it.
      expect(text).toHaveBeenCalledWith("Drafts");
      expect(closed).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it("takes the typed text with Ctrl/Cmd+Enter at once in a prompt whose hits only preview, while its parts still load", async () => {
      const more = vi.fn();
      const { closed } = await mount({
        label: "Name",
        items: [],
        preview: true,
        text: vi.fn(),
        more,
        fill: new Promise<PromptFill>(() => undefined),
      });
      await type(input(), "Open");
      await press(input(), "Enter", { ctrlKey: true, metaKey: true });
      expect(more).toHaveBeenCalledWith("Open");
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("[SR-119/AK-mb64] opens the hit when Enter comes after the hits arrived and before they are shown (#419)", async () => {
      const asked: ((choices: Choice[]) => void)[] = [];
      const find = (): Promise<Choice[]> =>
        new Promise<Choice[]>((resolve) => {
          asked.push(resolve);
        });
      const { closed } = await mount({ label: "Go to", items: [], find });
      const hit = choice("e1", "SR-118 Calm start");
      await type(input(), "SR-118");
      const field = input();
      // One act: the answer is in, but React renders the hits only after the key.
      await act(async () => {
        asked[0]?.([hit]);
        await Promise.resolve();
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      await flush();
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("takes the hit once when a second Enter comes before the prompt has closed (#419)", async () => {
      const asked: ((choices: Choice[]) => void)[] = [];
      const find = (): Promise<Choice[]> =>
        new Promise<Choice[]>((resolve) => {
          asked.push(resolve);
        });
      const { closed } = await mount({ label: "Go to", items: [], find });
      const hit = choice("e1", "SR-118 Calm start");
      await type(input(), "SR-118");
      const field = input();
      const enter = (): void => {
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      };
      await act(async () => {
        enter();
        await Promise.resolve();
      });
      await act(async () => {
        asked[0]?.([hit]);
        await Promise.resolve();
        enter();
      });
      await flush();
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("takes the hit once when two Enters come after the hits arrived and before the prompt has closed (#419)", async () => {
      const asked: ((choices: Choice[]) => void)[] = [];
      const find = (): Promise<Choice[]> =>
        new Promise<Choice[]>((resolve) => {
          asked.push(resolve);
        });
      const { closed } = await mount({ label: "Go to", items: [], find });
      const hit = choice("e1", "SR-118 Calm start");
      await type(input(), "SR-118");
      const field = input();
      await act(async () => {
        asked[0]?.([hit]);
        await Promise.resolve();
        const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        field.dispatchEvent(enter);
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      await flush();
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("gives an Enter typed while an earlier Enter waits to the prompt that follows: it ends the list there (#1763)", async () => {
      const { find, answer } = deferred();
      const ended = vi.fn();
      const closed = vi.fn();
      let ask: (serial: number) => void = () => undefined;
      const hit = choice("pkg", "PKG-0000d1 Sensors", {
        run: vi.fn(() => {
          ask(2);
        }),
      });
      // The value step of a list: its hit asks the step again, which ends on Enter in an empty input.
      const next: Prompt = { label: "packages", items: [], find: () => Promise.resolve([]), empty: ended };
      const Harness = (): React.ReactElement => {
        const [serial, setSerial] = useReducer((_: number, value: number) => value, 1);
        ask = setSerial;
        const first: Prompt = { label: "packages", items: [], find };
        return createElement(Minibuffer, {
          echo: "",
          prompt: { serial, prompt: serial === 1 ? first : next },
          onCommand: vi.fn(),
          onClose: closed,
        });
      };
      await render(createElement(Harness));
      await type(input(), "Sensors");
      await press(input(), "Enter");
      await press(input(), "Enter");
      expect(hit.run).not.toHaveBeenCalled();
      await answer("Sensors", [hit]);
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(ended).toHaveBeenCalledTimes(1);
    });

    it("drops an Enter typed ahead once typing cancels the wait (#1763)", async () => {
      const { find, answer } = deferred();
      const ended = vi.fn();
      let ask: (serial: number) => void = () => undefined;
      const hit = choice("pkg", "PKG-0000d1 Sensors", {
        run: vi.fn(() => {
          ask(2);
        }),
      });
      const next: Prompt = { label: "packages", items: [], find: () => Promise.resolve([]), empty: ended };
      const Harness = (): React.ReactElement => {
        const [serial, setSerial] = useReducer((_: number, value: number) => value, 1);
        ask = setSerial;
        const first: Prompt = { label: "packages", items: [], find };
        return createElement(Minibuffer, {
          echo: "",
          prompt: { serial, prompt: serial === 1 ? first : next },
          onCommand: vi.fn(),
          onClose: vi.fn(),
        });
      };
      await render(createElement(Harness));
      await type(input(), "Sens");
      await press(input(), "Enter");
      await press(input(), "Enter");
      // Typing cancels the waiting Enter and the one typed ahead.
      await type(input(), "Sensors");
      await press(input(), "Enter");
      await answer("Sensors", [hit]);
      expect(hit.run).toHaveBeenCalledTimes(1);
      expect(ended).not.toHaveBeenCalled();
    });

    it("drops an Enter typed ahead when another prompt replaces the waiting one (#1763)", async () => {
      const { find } = deferred();
      const ended = vi.fn();
      const other: Prompt = { label: "Commands", items: [], empty: ended, text: ended };
      let ask: (serial: number) => void = () => undefined;
      const Harness = (): React.ReactElement => {
        const [serial, setSerial] = useReducer((_: number, value: number) => value, 1);
        ask = setSerial;
        const first: Prompt = { label: "packages", items: [], find };
        return createElement(Minibuffer, {
          echo: "",
          prompt: { serial, prompt: serial === 1 ? first : other },
          onCommand: vi.fn(),
          onClose: vi.fn(),
        });
      };
      await render(createElement(Harness));
      await type(input(), "Sens");
      await press(input(), "Enter");
      await press(input(), "Enter");
      await act(async () => {
        ask(2);
        await Promise.resolve();
      });
      await flush();
      expect(ended).not.toHaveBeenCalled();
    });

    it("gives a Ctrl/Cmd+Enter typed ahead to the next prompt as Ctrl/Cmd+Enter (#1763)", async () => {
      const { find, answer } = deferred();
      const ended = vi.fn();
      let ask: (serial: number) => void = () => undefined;
      const hit = choice("pkg", "PKG-0000d1 Sensors", {
        run: vi.fn(() => {
          ask(2);
        }),
      });
      const next: Prompt = { label: "packages", items: [], find: () => Promise.resolve([]), empty: ended };
      const Harness = (): React.ReactElement => {
        const [serial, setSerial] = useReducer((_: number, value: number) => value, 1);
        ask = setSerial;
        const first: Prompt = { label: "packages", items: [], find };
        return createElement(Minibuffer, {
          echo: "",
          prompt: { serial, prompt: serial === 1 ? first : next },
          onCommand: vi.fn(),
          onClose: vi.fn(),
        });
      };
      await render(createElement(Harness));
      await type(input(), "Sensors");
      await press(input(), "Enter");
      await press(input(), "Enter", { ctrlKey: true, metaKey: true });
      await answer("Sensors", [hit]);
      expect(ended).toHaveBeenCalledExactlyOnceWith(true);
    });

    describe("a confirmation step (SR-218 AK3, SR-071 AK5)", () => {
      /** A confirmation whose answers the test counts. */
      const confirmation = () => {
        const yes = vi.fn();
        const back = vi.fn();
        const prompt = confirmationPrompt({
          label: "Bulk update elements · confirm:",
          verb: "apply",
          does: "writes",
          name: "confirm",
          text: "Writes 2 elements, skips 0 elements",
          yes,
          back,
        });
        return { prompt, yes, back };
      };
      /** A keydown whose press began at `timeStamp`. */
      const pressedAt = async (
        key: string,
        timeStamp: number,
        init: KeyboardEventInit = {},
      ): Promise<void> => {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
        Object.defineProperty(event, "timeStamp", { value: timeStamp });
        await act(async () => {
          input().dispatchEvent(event);
          await Promise.resolve();
        });
        await flush();
      };

      it("does nothing on a key that began before the step was shown, or that repeats", async () => {
        const { prompt, yes, back } = confirmation();
        const { closed } = await mount(prompt);
        await pressedAt("Enter", 1);
        await pressedAt("Enter", 1, { ctrlKey: true, metaKey: true });
        await press(input(), "Enter", { repeat: true });
        await press(input(), "Enter", { ctrlKey: true, metaKey: true, repeat: true });
        expect(yes).not.toHaveBeenCalled();
        expect(back).not.toHaveBeenCalled();
        expect(closed).not.toHaveBeenCalled();
        // A key pressed now takes the marked hit, "No".
        await pressedAt("Enter", performance.now() + 1);
        expect(back).toHaveBeenCalledTimes(1);
        expect(yes).not.toHaveBeenCalled();
      });

      it("takes no Enter or Ctrl/Cmd+Enter typed ahead while the prompt before waited (#1763)", async () => {
        for (const ahead of [{}, { ctrlKey: true, metaKey: true }]) {
          const { find, answer } = deferred();
          const { prompt, yes, back } = confirmation();
          let ask: (serial: number) => void = () => undefined;
          const hit = choice("value", "Why", {
            run: vi.fn(() => {
              ask(2);
            }),
          });
          const Harness = (): React.ReactElement => {
            const [serial, setSerial] = useReducer((_: number, value: number) => value, 1);
            ask = setSerial;
            const first: Prompt = { label: "value", items: [], find };
            return createElement(Minibuffer, {
              echo: "",
              prompt: { serial, prompt: serial === 1 ? first : prompt },
              onCommand: vi.fn(),
              onClose: vi.fn(),
            });
          };
          await render(createElement(Harness));
          await type(input(), "Why");
          await press(input(), "Enter");
          await press(input(), "Enter", ahead);
          await answer("Why", [hit]);
          expect(hit.run).toHaveBeenCalledTimes(1);
          expect(query(".prompt-label").textContent).toBe("Bulk update elements · confirm:");
          expect(yes).not.toHaveBeenCalled();
          expect(back).not.toHaveBeenCalled();
        }
      });

      it("takes a key pressed once the step is on the page, before its passive effects ran (#1982)", async () => {
        const { prompt, back } = confirmation();
        let ask: (serial: number) => void = () => undefined;
        // Presses Escape in the commit that puts the step on the page, after the layout effects of the prompt
        // and before any passive effect: as a key that comes after the frame showing the step and before React
        // ran the passive effects of that commit.
        const Presser = ({ serial }: { readonly serial: number }): null => {
          useLayoutEffect(() => {
            if (serial === 2) {
              const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
              Object.defineProperty(event, "timeStamp", { value: performance.now() });
              input().dispatchEvent(event);
            }
          }, [serial]);
          return null;
        };
        const Harness = (): React.ReactElement => {
          const [serial, setSerial] = useReducer((_: number, value: number) => value, 1);
          ask = setSerial;
          const first: Prompt = { label: "value", items: [choice("value", "Why")] };
          return createElement(
            Fragment,
            null,
            createElement(Minibuffer, {
              echo: "",
              prompt: { serial, prompt: serial === 1 ? first : prompt },
              onCommand: vi.fn(),
              onClose: vi.fn(),
            }),
            createElement(Presser, { serial }),
          );
        };
        await render(createElement(Harness));
        await act(async () => {
          ask(2);
          await Promise.resolve();
        });
        await flush();
        expect(back).toHaveBeenCalledTimes(1);
      });

      it("opens no command help, so Ctrl/Cmd+Enter after Ctrl+H still confirms (SR-210 AK4)", async () => {
        const { prompt, yes } = confirmation();
        await mount(prompt);
        await press(input(), "h", { ctrlKey: true });
        expect(container.querySelector('[aria-label="Command help"]')).toBeNull();
        await press(input(), "Enter", { ctrlKey: true, metaKey: true });
        expect(yes).toHaveBeenCalledTimes(1);
      });
    });

    it("waits for the hits of the typed text when the selected stale hit is also a buffer of the prompt (#195)", async () => {
      const { find, answer } = deferred();
      const recent = choice("sr-1", "SR-1 Old title");
      const { closed } = await mount({ label: "Go to", items: [recent], find });
      const staleHit = choice("sr-1", "SR-1 Foo", { title: "Foo" });
      const wanted = choice("new", "SR-2 Foox");
      await type(input(), "Foo");
      await answer("Foo", [staleHit]);
      await type(input(), "Foox");
      await press(input(), "Enter");
      expect(staleHit.run).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await answer("Foox", [wanted]);
      expect(wanted.run).toHaveBeenCalledTimes(1);
    });

    it("keeps the row picked before the hits arrived when an exact title comes first (#195)", async () => {
      const { find, answer } = deferred();
      const first = choice("b1", "Package list");
      const second = choice("b2", "Package graph");
      await mount({ label: "Go to", items: [first, second], find });
      await type(input(), "package");
      await press(input(), "ArrowDown");
      await answer("package", [choice("pkg", "PKG-1 Package", { title: "Package" })]);
      expect(texts('[role="option"]')).toEqual(["PKG-1 Package", "Package list", "Package graph"]);
      await press(input(), "Enter");
      expect(second.run).toHaveBeenCalledTimes(1);
    });

    it("opens the selected buffer at once, without waiting for the hits", async () => {
      const { find } = deferred();
      const buffer = choice("list", "All elements");
      const { closed } = await mount({ label: "Go to", items: [buffer], find });
      await type(input(), "all");
      await press(input(), "Enter");
      expect(buffer.run).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it("opens the first matching buffer before the hits when a hit was selected while waiting", async () => {
      const { find, answer } = deferred();
      const buffer = choice("list", "All elements");
      const { closed } = await mount({ label: "Go to", items: [buffer], find });
      const old = choice("old", "Older hit");
      await type(input(), "a");
      await answer("a", [old]);
      await type(input(), "al");
      await press(input(), "ArrowDown");
      await press(input(), "Enter");
      expect(closed).not.toHaveBeenCalled();
      await answer("al", [choice("new", "Newer hit")]);
      expect(buffer.run).toHaveBeenCalledTimes(1);
      expect(old.run).not.toHaveBeenCalled();
    });

    it("does nothing when the hits of the text are none", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      await type(input(), "nothing");
      await press(input(), "Enter");
      await answer("nothing", []);
      expect(closed).not.toHaveBeenCalled();
      // Waiting ended with the answer: a hit that comes later is not opened.
      expect(container.querySelector("input")).not.toBeNull();
    });

    it("stops waiting when more is typed", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const first = choice("a", "A hit");
      const second = choice("b", "B hit");
      await type(input(), "a");
      await press(input(), "Enter");
      await type(input(), "ab");
      await answer("a", [first]);
      await answer("ab", [second]);
      expect(first.run).not.toHaveBeenCalled();
      expect(second.run).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await press(input(), "Enter");
      expect(second.run).toHaveBeenCalledTimes(1);
    });

    it("waits on Ctrl/Cmd+Enter as on Enter, and takes the first hit with the optional arguments", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "ref:", items: [], find });
      const stale = choice("old", "S-001 Starts with S", { more: vi.fn() });
      const wanted = choice("new", "SR-118 Calm start", { more: vi.fn() });
      await type(input(), "S");
      await answer("S", [stale]);
      await type(input(), "SR-118");
      await press(input(), "Enter", { metaKey: true });
      expect(stale.more).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await answer("SR-118", [wanted]);
      expect(wanted.more).toHaveBeenCalledTimes(1);
      expect(wanted.run).not.toHaveBeenCalled();
      expect(closed).toHaveBeenCalledTimes(1);
      // A first hit without optional arguments is taken as with Enter.
      const plain = deferred();
      await render(
        createElement(Minibuffer, { echo: "", prompt: undefined, onCommand: vi.fn(), onClose: vi.fn() }),
      );
      await mount({ label: "Go to", items: [], find: plain.find });
      const hit = choice("e", "SR-119 Other");
      await type(input(), "SR-119");
      await press(input(), "Enter", { ctrlKey: true });
      await plain.answer("SR-119", [hit]);
      expect(hit.run).toHaveBeenCalledTimes(1);
    });

    it("stops waiting on Escape, and when the prompt is gone", async () => {
      const { find, answer } = deferred();
      const { closed } = await mount({ label: "Go to", items: [], find });
      const hit = choice("a", "A hit");
      await type(input(), "a");
      await press(input(), "Enter");
      await press(input(), "Escape");
      expect(closed).toHaveBeenCalledTimes(1);
      await answer("a", [hit]);
      expect(hit.run).not.toHaveBeenCalled();
      const later = deferred();
      const gone = await mount({ label: "Go to", items: [], find: later.find });
      const other = choice("b", "B hit");
      await type(input(), "b");
      await press(input(), "Enter");
      await mount(undefined);
      await later.answer("b", [other]);
      expect(other.run).not.toHaveBeenCalled();
      expect(gone.closed).not.toHaveBeenCalled();
    });
  });
});

describe("the marks of a value built from hits (SR-215 AK3, AK9)", () => {
  const prompt = (unmark: boolean) => {
    const removed: string[] = [];
    const back = vi.fn();
    const marked: Prompt = {
      label: "New saved filter open · where:",
      items: [{ id: "take", name: "Next: sort", run: vi.fn() }],
      marks: ["type: need", "status: draft"].map((label) => ({
        label,
        remove: () => {
          removed.push(label);
        },
      })),
      ...(unmark ? { unmark: true } : {}),
      back,
      explain: {
        name: "where",
        description: "Which elements",
        list: false,
        ends: false,
        skips: false,
        more: true,
        building: { enter: "takes the marked hit; all conditions must hold", unmark, json: unmark },
      },
    };
    return { marked, removed, back };
  };
  // A new question each time, so the input starts empty.
  let serial = 0;
  const mount = async (shown: Prompt, closed = vi.fn()) => {
    await render(
      createElement(Minibuffer, {
        echo: "",
        prompt: { serial: (serial += 1), prompt: shown },
        onCommand: vi.fn(),
        onClose: closed,
      }),
    );
    return closed;
  };

  it("[SR-215/AK-dt5s] shows each mark before the input, a box with its label and an ×", async () => {
    await mount(prompt(true).marked);
    expect(texts('[aria-label="Marks"] [role="listitem"]')).toEqual(["type: need×", "status: draft×"]);
    expect(query(".prompt-marks").nextElementSibling).toBe(queryInput());
    expect(query('[aria-label="Remove status: draft"]').tagName).toBe("BUTTON");
  });

  it("[SR-215/AK-rx2z] a click on the × of a mark removes that mark; the input keeps the focus", async () => {
    const { marked, removed } = prompt(true);
    const closed = await mount(marked);
    const unmark = query('[aria-label="Remove type: need"]');
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    unmark.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await click(unmark);
    expect(removed).toEqual(["type: need"]);
    expect(closed).toHaveBeenCalledWith(false);
  });

  it("[SR-134/AK-fmf6] [SR-215/AK-rx2z] Backspace on an empty input removes the last mark where the step removes one, else it goes back", async () => {
    const removing = prompt(true);
    await mount(removing.marked);
    await press(queryInput(), "Backspace");
    expect(removing.removed).toEqual(["status: draft"]);
    expect(removing.back).not.toHaveBeenCalled();
    // Typed text: Backspace deletes a character.
    const typing = prompt(true);
    await mount(typing.marked);
    await type(queryInput(), "ty");
    await press(queryInput(), "Backspace");
    expect(typing.removed).toEqual([]);
    // A step of the values: one step back, the marks stay.
    const values = prompt(false);
    await mount(values.marked);
    await press(queryInput(), "Backspace");
    expect(values.removed).toEqual([]);
    expect(values.back).toHaveBeenCalledTimes(1);
  });

  it("[SR-210/AK-t8sc] the explanation line names the keys of the step: what Enter does, Backspace for the last mark and { for JSON", async () => {
    await mount(prompt(true).marked);
    expect(query("#prompt-explain .explain-keys").textContent).toBe(
      "Enter takes the marked hit; all conditions must hold · Backspace on an empty input removes the last mark · { a condition in JSON · Ctrl+Enter more arguments · Escape back",
    );
    await mount({ ...prompt(false).marked });
    expect(query("#prompt-explain .explain-keys").textContent).toBe(
      "Enter takes the marked hit; all conditions must hold · Ctrl+Enter more arguments · Escape back",
    );
  });

  it("[SR-219/AK-vnsd] the explanation line says what the typed name replaces before the keys", async () => {
    const { marked } = prompt(false);
    const explain = marked.explain;
    if (explain === undefined) {
      throw new Error("no explanation");
    }
    await mount({
      ...marked,
      marks: [],
      explain: {
        ...explain,
        note: (text) => (text === "Rain" ? "Replaces the perspective Rain" : undefined),
      },
    });
    const keys =
      "Enter takes the marked hit; all conditions must hold · Ctrl+Enter more arguments · Escape back";
    expect(query("#prompt-explain .explain-keys").textContent).toBe(keys);
    await type(queryInput(), "Rain");
    expect(query("#prompt-explain .explain-keys").textContent).toBe(
      `Replaces the perspective Rain · ${keys}`,
    );
  });

  it("[SR-219/AK-pqry] the marks of the steps before stand first, without ×; Backspace removes only the step's own", async () => {
    const { marked, removed, back } = prompt(true);
    await mount({ ...marked, earlier: ["type: need", "grouped by Status"] });
    expect(texts('[aria-label="Marks"] [role="listitem"]')).toEqual([
      "type: need",
      "grouped by Status",
      "type: need×",
      "status: draft×",
    ]);
    expect(document.querySelectorAll(".prompt-unmark")).toHaveLength(2);
    await press(queryInput(), "Backspace");
    expect(removed).toEqual(["status: draft"]);
    // Without marks of its own, Backspace goes back a step.
    await mount({ ...marked, marks: [], earlier: ["type: need"] });
    await press(queryInput(), "Backspace");
    expect(back).toHaveBeenCalledTimes(1);
  });
});
