// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { DEFAULT_SORT } from "./buffers.js";
import type { Handler } from "./App.test-helper.js";
import {
  fakeBridge,
  row,
  workspace,
  container,
  render,
  text,
  shownAll,
  shownOne,
  query,
  keyDown,
  pressed,
  type,
  mod,
  runCommand,
  calls,
} from "./App.test-helper.js";

describe("App, the package page (SR-112)", () => {
  /** A package "Stufe-3" and three elements that name it; the start list is of no concern to these tests. */
  const withPackage = (forMembers?: Handler): Record<string, Handler> => {
    const handlers = workspace();
    const members = [row(2), row(3), row(4)];
    handlers["metamodel.get"] = () => ({
      relations: [],
      types: [
        { key: "need", name: "Need", properties: [] },
        { key: "package", name: "Package", meaning: "package", properties: [] },
      ],
      properties: [],
      statuses: [{ key: "draft" }],
      meanings: { package: ["package"], packages: ["packages"] },
    });
    handlers["element.get"] = (input) => {
      const id = String(input["ref"]);
      return {
        element:
          id === "uuid-p"
            ? row(0, {
                id: "uuid-p",
                shortId: "PKG-0000d1",
                type: "package",
                title: "Stufe-3",
                text: "Third stage",
              })
            : row(Number(id.replace("uuid-", "")), { text: "Hello" }),
      };
    };
    handlers["element.search"] = (input) => {
      const found = String(input["query"]).toLowerCase().startsWith("stufe")
        ? row(0, { id: "uuid-p", shortId: "PKG-0000d1", type: "package", title: "Stufe-3" })
        : row(2);
      return {
        hits: [{ ...found, score: 1, fields: ["title"], terms: [String(input["query"])] }],
        total: 1,
        incomplete: false,
      };
    };
    handlers["element.list"] = (input) => {
      const selection = input["selection"] as { where?: { package?: string } } | undefined;
      if (selection?.where?.package === undefined) {
        return { elements: [row(1)], total: 1 };
      }
      if (forMembers !== undefined) {
        return forMembers(input);
      }
      const sort = input["sort"] as { by: string; order: string }[] | undefined;
      if (sort?.[0]?.by === "hierarchy") {
        return {
          elements: members,
          tree: [0, 1, 0].map((depth, at) => ({ id: `uuid-${String(at + 2)}`, repository: "spec", depth })),
          total: 3,
        };
      }
      return {
        elements: sort?.[0]?.order === "desc" ? [...members].reverse() : members,
        total: 3,
        incomplete: false,
      };
    };
    return handlers;
  };

  const openPackage = async (handlers = withPackage()) => {
    const fake = fakeBridge(handlers);
    await render(fake.bridge);
    await keyDown(window, "p", mod());
    await type("stufe");
    await keyDown(query("input"), "Enter");
    return fake;
  };

  const memberCalls = (invoke: ReturnType<typeof fakeBridge>["invoke"]): unknown[] =>
    calls(invoke, "element.list").filter(
      (input) => (input as { selection?: unknown }).selection !== undefined,
    );

  const memberTitles = (): string[] =>
    [...shownAll(".members .row .title")].map((title) => title.textContent);

  it("[SR-112/AK-fzbz] an opened package shows below its title and text every element that names it", async () => {
    const { invoke } = await openPackage();
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(memberCalls(invoke)).toEqual([
      { selection: { where: { package: "uuid-p" } }, sort: DEFAULT_SORT, limit: 200, offset: 0 },
    ]);
    const parts = [...shownAll("article h1, article .cm-editor, article .members h2, article .members .row")];
    expect(parts.map((part) => part.tagName)).toEqual(["H1", "DIV", "H2", "DIV", "DIV", "DIV"]);
    expect(parts[1]?.className).toContain("cm-editor");
    expect(query(".members h2").textContent).toBe("← packages 3");
    expect(memberTitles()).toEqual(["Title 2", "Title 3", "Title 4"]);
    // The page is the element: the modeline names it with the number of its elements (SR-114 AK3), and
    // the focus is on its text, not on the elements.
    expect(text("Modeline")).toBe("PKG-0000d1 · Package · draft3 elementsWeather stationread-only");
    expect(document.activeElement).toBe(query("article"));
  });

  it("[SR-112/AK-fzbz] an element that is no package asks for no elements", async () => {
    const fake = fakeBridge(withPackage());
    await render(fake.bridge);
    await keyDown(window, "p", { ctrlKey: true });
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
    expect(shownOne(".members")).toBeNull();
    expect(memberCalls(fake.invoke)).toEqual([]);
  });

  it("[SR-112/AK-fzbz] a package that no element names shows no heading", async () => {
    await openPackage(withPackage(() => ({ elements: [], total: 0 })));
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(shownOne(".members h2")).toBeNull();
    expect(query(".members").hasAttribute("hidden")).toBe(true);
  });

  it("echoes why the elements of a package could not be listed", async () => {
    await openPackage(withPackage(() => new Error("The reference matches several elements")));
    expect(text("Minibuffer")).toBe("The reference matches several elements");
    expect(query(".members .quiet").textContent).toBe("The reference matches several elements");
  });

  it("the elements of a package are asked for once, and moving through them asks for nothing more", async () => {
    const { invoke } = await openPackage();
    expect(memberCalls(invoke)).toHaveLength(1);
    await keyDown(query("article"), "ArrowDown");
    for (let n = 0; n < 3; n += 1) {
      await keyDown(query(".members .list"), "ArrowDown");
    }
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-2$/);
    expect(memberCalls(invoke)).toHaveLength(1);
    expect(calls(invoke, "element.get")).toHaveLength(1);
  });

  it("Down moves into the elements, Enter opens one, and Ctrl+P Enter comes back to the same row", async () => {
    const { invoke } = await openPackage();
    await keyDown(query("article"), "ArrowDown");
    expect(document.activeElement).toBe(query(".members .list"));
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 3");
    await keyDown(window, "p", { ctrlKey: true });
    expect(query('[role="option"]').textContent).toContain("Stufe-3");
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Stufe-3");
    // The focus is on the row that was used, as it is on a list.
    expect(document.activeElement).toBe(query(".members .list"));
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-1$/);
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 4");
    // The element left for the package is drawn in advance as its previous buffer (SR-212 AK5): read once
    // more, hidden; the package page is drawn from what it read when shown, and read no more.
    expect(calls(invoke, "element.get").map((input) => (input as { ref: string }).ref)).toEqual([
      "uuid-p",
      "uuid-3",
      "uuid-3",
      "uuid-4",
    ]);
  });

  it("Enter on the first row opens it, and Ctrl+P Enter comes back to row 0 with Down and Enter opening the next", async () => {
    await openPackage();
    await keyDown(query("article"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(document.activeElement).toBe(query(".members .list"));
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-0$/);
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 3");
  });

  it("Escape in the elements returns the focus to the page, and Enter on the page still edits the text", async () => {
    await openPackage();
    await keyDown(query("article"), "ArrowDown");
    await keyDown(query(".members .list"), "Escape");
    expect(document.activeElement).toBe(query("article"));
    await keyDown(query("article"), "Enter");
    expect(EditorView.findFromDOM(query(".cm-editor"))?.hasFocus).toBe(true);
  });

  it('[SR-112/AK-vv6f] "Sort list" sorts the elements of the package, and the page stays the same element', async () => {
    const { invoke } = await openPackage();
    await runCommand("sort list");
    expect(query("label").textContent).toBe("Sort by");
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("Order");
    await type("desc");
    await keyDown(query("input"), "Enter");
    expect(memberCalls(invoke).at(-1)).toEqual({
      selection: { where: { package: "uuid-p" } },
      sort: [{ by: "title", order: "desc" }],
      limit: 200,
      offset: 0,
    });
    expect(memberTitles()).toEqual(["Title 4", "Title 3", "Title 2"]);
    expect(query(".members h2").textContent).toBe("← packages 3 · sorted by title descending");
    // The element buffer was replaced in place: its text was not asked for again, and no second buffer is open.
    expect(calls(invoke, "element.get")).toHaveLength(1);
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(document.activeElement).toBe(query("article"));
  });

  it('[SR-112/AK-vv6f] "Hierarchy (tree)" shows the elements of the package as the derivation tree', async () => {
    const { invoke } = await openPackage();
    await runCommand("sort list");
    await type("hier");
    await keyDown(query("input"), "Enter");
    expect(memberCalls(invoke).at(-1)).toEqual({
      selection: { where: { package: "uuid-p" } },
      sort: [{ by: "hierarchy", order: "asc" }],
      limit: 200,
      offset: 0,
    });
    expect(
      [...container.querySelectorAll<HTMLElement>(".members .row .title")].map(
        (title) => title.style.paddingLeft,
      ),
    ).toEqual(["0rem", "1.25rem", "0rem"]);
    expect(query(".members h2").textContent).toBe("← packages 3 · tree");
  });

  it("[SR-112/AK-vv6f] the sort and the row of the elements are kept while the buffer is open", async () => {
    await openPackage();
    await runCommand("sort list");
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(query("label").textContent).toBe("Order");
    await type("desc");
    await keyDown(query("input"), "Enter");
    await keyDown(query("article"), "ArrowDown");
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Enter");
    expect(query("article h1").textContent).toBe("Title 3");
    await keyDown(window, "p", { ctrlKey: true });
    await keyDown(query("input"), "Enter");
    expect(memberTitles()).toEqual(["Title 4", "Title 3", "Title 2"]);
    expect(query(".members h2").textContent).toBe("← packages 3 · sorted by title descending");
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-1$/);
  });

  it("asks for the elements again when the workspace changed, and keeps them until the answer", async () => {
    const { invoke, change } = await openPackage();
    await change("written");
    expect(memberCalls(invoke)).toHaveLength(2);
    expect(memberTitles()).toEqual(["Title 2", "Title 3", "Title 4"]);
  });

  it("has no package page when the metamodel cannot be read", async () => {
    const handlers = withPackage();
    handlers["metamodel.get"] = () => new Error("The metamodel is broken");
    const { invoke } = await openPackage(handlers);
    expect(query("article h1").textContent).toBe("Stufe-3");
    expect(shownOne(".members")).toBeNull();
    expect(memberCalls(invoke)).toEqual([]);
  });

  it("[SR-122/AK-mqwc] on a package page Ctrl+N selects the first element, walks the elements, and Ctrl+P on the first goes back to the page", async () => {
    await openPackage();
    const ctrlN = await pressed(query("article"), "n", { ctrlKey: true });
    expect(ctrlN.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(query(".members .list"));
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-0$/);
    await keyDown(query(".members .list"), "n", { ctrlKey: true });
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-1$/);
    await keyDown(query(".members .list"), "p", { ctrlKey: true });
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-0$/);
    const back = await pressed(query(".members .list"), "p", { ctrlKey: true });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(query("article"));
    expect(shownOne("label")).toBeNull();
  });

  it("[SR-122/AK-mqwc] Ctrl+N on the page goes to the first element also when another one was used", async () => {
    await openPackage();
    await keyDown(query("article"), "ArrowDown");
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "ArrowDown");
    await keyDown(query(".members .list"), "Escape");
    expect(document.activeElement).toBe(query("article"));
    await keyDown(query("article"), "n", { ctrlKey: true });
    expect(document.activeElement).toBe(query(".members .list"));
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-0$/);
  });

  /** A package page with the text box "topic" below its text. */
  const withTopic = (): Record<string, Handler> => {
    const handlers = withPackage();
    const metamodel = handlers["metamodel.get"];
    handlers["metamodel.get"] = (input) => {
      const model = metamodel?.(input) as {
        types: { key: string; properties: string[] }[];
        properties: unknown[];
      };
      return {
        ...model,
        types: model.types.map((type) =>
          type.key === "package" ? { ...type, properties: ["topic"] } : type,
        ),
        properties: [{ key: "topic", name: "Topic", kind: "text" }],
      };
    };
    const get = handlers["element.get"];
    handlers["element.get"] = (input) => {
      const answer = get?.(input) as { element: Record<string, unknown> };
      return input["ref"] === "uuid-p"
        ? { element: { ...answer.element, properties: { topic: "Wind" } } }
        : answer;
    };
    return handlers;
  };

  it.each(["MacIntel", "Win32", "Linux x86_64"])(
    "[SR-155/AK-zw14] on %s, Ctrl+N and Ctrl+P on a field act as Down and Up, from the last field into the elements",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await openPackage(withTopic());
      const field = (label: string): HTMLElement => query(`.field[data-field="${label}"]`);
      const focus = (label: string): void => {
        act(() => {
          field(label).focus();
        });
      };
      focus("Title");
      // Ctrl+P on the first field only moves: nowhere, and it is not Go to.
      expect((await pressed(field("Title"), "p", { ctrlKey: true })).defaultPrevented).toBe(true);
      expect(shownOne("label")).toBeNull();
      expect(document.activeElement).toBe(field("Title"));
      expect((await pressed(field("Title"), "n", { ctrlKey: true })).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(query('[data-field="Text"] .cm-content'));
      focus("topic");
      await keyDown(field("topic"), "p", { ctrlKey: true });
      expect(document.activeElement).toBe(query('[data-field="Text"] .cm-content'));
      focus("topic");
      await keyDown(field("topic"), "n", { ctrlKey: true });
      expect(document.activeElement).toBe(query(".members .list"));
    },
  );

  it("[SR-122/AK-mqwc] Ctrl+N on the last element stays there and goes no further", async () => {
    await openPackage();
    await keyDown(query("article"), "n", { ctrlKey: true });
    await keyDown(query(".members .list"), "End");
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-2$/);
    const last = await pressed(query(".members .list"), "n", { ctrlKey: true });
    expect(last.defaultPrevented).toBe(true);
    expect(query('.members [aria-selected="true"]').id).toMatch(/_row-2$/);
    expect(document.activeElement).toBe(query(".members .list"));
  });

  it("[SR-155/AK-tfxs] Ctrl+N on an element that is no package, or on a package without elements, goes to its first field", async () => {
    const fake = fakeBridge(withPackage());
    await render(fake.bridge);
    await keyDown(window, "p", { ctrlKey: true });
    await type("title");
    await keyDown(query("input"), "Enter");
    expect(query("article h1").textContent).toBe("Title 2");
    expect((await pressed(query("article"), "n", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect((document.activeElement as HTMLElement | null)?.dataset["field"]).toBe("Title");
    await openPackage(withPackage(() => ({ elements: [], total: 0 })));
    expect((await pressed(query("article"), "n", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect((document.activeElement as HTMLElement | null)?.dataset["field"]).toBe("Title");
  });

  it.each(["Win32", "Linux x86_64"])(
    "[SR-122/AK-xm88] on %s, Ctrl+P on a package page outside its elements is still Go to",
    async (platform) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      await openPackage();
      const ctrlP = await pressed(query("article"), "p", { ctrlKey: true });
      expect(ctrlP.defaultPrevented).toBe(true);
      expect(query("label").textContent).toBe("Go to");
    },
  );

  it("[SR-145/AK-bfb2] on macOS, the physical Ctrl+P on a package page outside its elements is not Go to; Cmd+P is", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await openPackage();
    expect((await pressed(query("article"), "p", { ctrlKey: true })).defaultPrevented).toBe(false);
    expect(shownOne("label")).toBeNull();
    await keyDown(query("article"), "p", { metaKey: true });
    expect(query("label").textContent).toBe("Go to");
  });

  it.each(["ArrowDown", "n"])(
    "[SR-155/AK-zw14] %s at the last line of the text, the last field of a package page, goes into its elements",
    async (key) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
      await openPackage();
      await keyDown(query("article"), "Enter");
      const content = query("article .cm-content");
      expect(document.activeElement).toBe(content);
      await keyDown(content, key, key === "n" ? { ctrlKey: true } : {});
      expect(document.activeElement).toBe(query(".members .list"));
      expect(shownOne("label")).toBeNull();
    },
  );

  it("[SR-155/AK-zw14] Ctrl+N walks a package page through its editors into its elements, Ctrl+P back", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    await openPackage(withTopic());
    const field = query('.field[data-field="Title"]');
    act(() => {
      field.focus();
    });
    const text = query('[data-field="Text"] .cm-content');
    const topic = query('[data-field="topic"] .cm-content');
    await keyDown(field, "n", { ctrlKey: true });
    expect(document.activeElement).toBe(text);
    await keyDown(text, "n", { ctrlKey: true });
    expect(document.activeElement).toBe(topic);
    await keyDown(topic, "p", { ctrlKey: true });
    expect(document.activeElement).toBe(text);
    await keyDown(text, "n", { ctrlKey: true });
    await keyDown(topic, "n", { ctrlKey: true });
    expect(document.activeElement).toBe(query(".members .list"));
    expect(shownOne("label")).toBeNull();
  });
});
