// @vitest-environment happy-dom
import { act, createElement, useReducer } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetamodelGetOutput } from "@reqseq/core";
import type { Buffer, BufferAction, MetamodelBuffer } from "./buffers.js";
import { metamodelBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import * as layoutModule from "./metamodel-layout.js";
import { FIXTURE_METAMODEL, effectiveType, metamodelOutput } from "./metamodel-test-data.js";
import { MetamodelView } from "./MetamodelView.js";
import type { MetamodelChange } from "./metamodel-changes.js";
import { NO_CHANGE } from "./metamodel-changes.js";
import { menuEntries, placeAt } from "./context-menu.js";
import type { MenuPlace } from "./context-menu.js";
import { metamodelGiven } from "./metamodel-menu.js";
import type { BufferData } from "./modeline.js";

vi.mock("./metamodel-layout.js", { spy: true });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.mocked(layoutModule.layoutMetamodel).mockRestore();
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

const press = async (key: string, held: KeyboardEventInit = {}, on = ".metamodel"): Promise<void> => {
  await act(async () => {
    query(on).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...held }));
    await Promise.resolve();
  });
  await flush();
};

/** A call that answers `metamodel.get` with `answer()`; an Error is a failed call. */
const fakeCall = (answer: () => MetamodelGetOutput | Error = () => FIXTURE_METAMODEL) =>
  vi.fn(() => {
    const output = answer();
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
const asCall = (call: ReturnType<typeof fakeCall>): Call => call as unknown as Call;

/** The metamodel buffer in a real buffer state, and what happened to it. */
const mount = async (
  call: Call,
  initial: MetamodelBuffer = metamodelBuffer(),
  changed: MetamodelChange = NO_CHANGE,
) => {
  const actions: BufferAction[] = [];
  const data: [string, BufferData | undefined][] = [];
  const echoed: string[] = [];
  const drawn: string[] = [];
  let reduce: ((action: BufferAction) => void) | undefined;
  const Harness = ({ revision }: { revision: number }): React.ReactElement => {
    const [buffers, dispatch] = useReducer(reduceBuffers, [initial] as readonly Buffer[]);
    reduce = dispatch;
    const current = buffers[0];
    if (current?.kind !== "metamodel") {
      return createElement("p", { id: "elsewhere" }, current?.key ?? "none");
    }
    return createElement(MetamodelView, {
      call,
      buffer: current,
      revision,
      dispatch: (action) => {
        actions.push(action);
        dispatch(action);
      },
      onData: (bufferKey, loaded) => data.push([bufferKey, loaded]),
      onEcho: (message) => echoed.push(message),
      onDrawn: (bufferKey) => drawn.push(bufferKey),
      changed,
    });
  };
  const show = async (revision: number): Promise<void> => {
    await act(async () => {
      root.render(createElement(Harness, { revision }));
      await Promise.resolve();
    });
    await flush();
  };
  await show(0);
  /** Changes the buffer as an action of the window would (Ctrl/Cmd+T). */
  const change = async (action: BufferAction): Promise<void> => {
    await act(async () => {
      reduce?.(action);
      await Promise.resolve();
    });
    await flush();
  };
  return { actions, data, echoed, drawn, show, change };
};

const selected = (): string | undefined => {
  const box = container.querySelector<HTMLElement>('.mm-type[aria-selected="true"]');
  return box === null ? undefined : (box.dataset["type"] ?? "any");
};

describe("MetamodelView", () => {
  it("[SR-130/AK-s795] shows each type with name, prefix, properties and statuses, inherited properties muted, the initial and invalid statuses marked, and each curve with its label", async () => {
    const call = fakeCall();
    const { data } = await mount(asCall(call));
    expect(call).toHaveBeenCalledWith("metamodel.get", {});
    const boxes = [...container.querySelectorAll<HTMLElement>(".mm-type")].map((box) => [
      box.dataset["type"] ?? (box.dataset["any"] === undefined ? "?" : "any"),
      [...box.querySelectorAll(".mm-head > span")].map((part) => `${part.className}:${part.textContent}`),
      [...box.querySelectorAll<HTMLElement>(".mm-property")].map(
        (line) => `${line.textContent}${line.classList.contains("inherited") ? " (inherited)" : ""}`,
      ),
    ]);
    expect(boxes).toEqual([
      ["item", ["mm-name:Item", "mm-abstract:abstract", "mm-prefix:ITM"], ["Title"]],
      [
        "requirement",
        ["mm-name:System Requirement", "mm-prefix:SR"],
        ["Title (inherited)", "Rationale", "Package"],
      ],
      [
        "software-requirement",
        ["mm-name:Software Requirement", "mm-prefix:SWR"],
        ["Title (inherited)", "Rationale (inherited)", "Package (inherited)", "Component"],
      ],
      ["decision", ["mm-name:Decision", "mm-prefix:D"], ["Title"]],
      ["package", ["mm-name:Package", "mm-prefix:PKG"], ["Title"]],
      ["any", ["mm-name:Any type"], []],
    ]);
    expect(query('[data-type="item"]').getAttribute("title")).toBe(
      "Item · ITM · abstract\nTitle\nStatuses: Draft (initial status), Approved, Retired (invalid)",
    );
    expect(query('[data-type="item"]').getAttribute("aria-label")).toBe(
      "Item · ITM · abstract, Title, Statuses: Draft (initial status), Approved, Retired (invalid)",
    );
    const statuses = (type: string): string[] =>
      [...query(`[data-type="${type}"]`).querySelectorAll<HTMLElement>(".mm-status")].map(
        (tag) => `${tag.textContent}${tag.className.replace("mm-status", "")}`,
      );
    // The inherited statuses too; a type without statuses has no row of them.
    expect(statuses("software-requirement")).toEqual(["Draft initial", "Approved", "Retired invalid"]);
    expect(statuses("decision")).toEqual(["Open", "Decided"]);
    expect(query('[data-type="package"]').querySelector(".mm-statuses")).toBeNull();
    expect(query("[data-any]").className).toBe("mm-type any");
    const labels = [...container.querySelectorAll<HTMLElement>(".mm-label")]
      .map((label) => {
        const lines = [...label.querySelectorAll<HTMLElement>(".mm-line")].map((line) => {
          const named =
            line.dataset["kind"] ??
            line.dataset["property"] ??
            (line.dataset["extends"] === undefined ? "?" : "extends");
          return `${named}=${line.textContent}`;
        });
        return `${label.dataset["source"] ?? ""} > ${label.dataset["target"] ?? ""}: ${lines.join(" | ")}`;
      })
      .sort();
    expect(labels).toEqual(
      [
        "type:requirement > type:item: extends=extends",
        "type:software-requirement > type:requirement: extends=extends | derives-from=Derives from",
        "type:software-requirement > type:software-requirement: derives-from=Derives from",
        "type:requirement > type:requirement: replaces=Replaces",
        "type:requirement > type:software-requirement: delegates-to=Delegates to",
        "any > type:decision: based-on=Based on · any source | concerns=Concerns · any source",
        "any > type:requirement: concerns=Concerns · any source",
        "any > any: refines=Refines · any source and target",
        "type:decision > any: traces-to=Traces to · any target",
        "type:requirement > type:package: packages=Package",
      ].sort(),
    );
    expect(query(".mm-line.extends").textContent).toBe("extends");
    // One curve per label, each ending in an arrowhead at its target.
    const paths = [...container.querySelectorAll<SVGPathElement>("path.mm-edge")];
    expect(paths).toHaveLength(10);
    expect(
      paths.every((path) =>
        /^url\(#mm-arrow(-extends|-selected)?\)$/.test(path.getAttribute("marker-end") ?? ""),
      ),
    ).toBe(true);
    expect(container.querySelectorAll("marker")).toHaveLength(3);
    expect(query(".metamodel").dataset["laidOut"]).toBe("6");
    expect(data.at(-1)).toEqual(["metamodel", { kind: "metamodel", types: 5 }]);
  });

  it("[SR-130/AK-g9gk] arrows move the selection between the boxes and leave Ctrl and Cmd keys to the window", async () => {
    const { actions } = await mount(asCall(fakeCall()));
    // The first type is selected when the buffer opens.
    expect(selected()).toBe("item");
    expect(query(".metamodel").getAttribute("aria-activedescendant")).toBe("mm-type-0");
    await press("ArrowDown");
    expect(selected()).toBe("requirement");
    expect(actions.at(-1)).toEqual({ type: "select", key: "metamodel", node: "type:requirement" });
    await press("ArrowRight");
    expect(selected()).toBe("decision");
    await press("PageDown");
    expect(selected()).toBe("any");
    await press("Home");
    expect(selected()).toBe("item");
    const before = actions.length;
    for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      await press("ArrowDown", held);
    }
    // A key that is no move, and a move that leads nowhere, do nothing.
    await press("t");
    await press("ArrowUp");
    expect(actions).toHaveLength(before);
    expect(selected()).toBe("item");
  });

  it("lights up the curves of the selected box while they are at most half of the curves, the inheritance in its own grey", async () => {
    await mount(asCall(fakeCall()), { ...metamodelBuffer(), selected: "type:item" });
    const classOf = (source: string, target: string): string =>
      query(`path[data-source="${source}"][data-target="${target}"]`).getAttribute("class") ?? "";
    expect(classOf("type:requirement", "type:item")).toBe("mm-edge selected");
    expect(classOf("type:software-requirement", "type:requirement")).toBe("mm-edge extends");
    expect(classOf("any", "type:decision")).toBe("mm-edge");
    expect(query('path[data-source="any"][data-target="type:decision"]').getAttribute("marker-end")).toBe(
      "url(#mm-arrow)",
    );
    // The curves of the selected box are drawn last.
    const order = [...container.querySelectorAll<SVGPathElement>("path.mm-edge")].map(
      (path) => path.dataset["target"],
    );
    expect(order.at(-1)).toBe("type:item");
  });

  it("selects a box by a click, and the first type when the selected one is gone", async () => {
    let answer = FIXTURE_METAMODEL;
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { show } = await mount(asCall(fakeCall(() => answer)), {
      ...metamodelBuffer(),
      selected: "type:gone",
    });
    expect(selected()).toBe("item");
    await act(async () => {
      query('[data-type="package"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(selected()).toBe("package");
    // The same answer is not laid out again; a changed one is, the selection kept while its box is there.
    const laidOut = vi.mocked(layoutModule.layoutMetamodel).mock.calls.length;
    scrolled.mockClear();
    await show(1);
    expect(vi.mocked(layoutModule.layoutMetamodel).mock.calls.length).toBe(laidOut);
    answer = metamodelOutput({ types: [effectiveType("package"), effectiveType("other")] });
    await show(2);
    expect(vi.mocked(layoutModule.layoutMetamodel).mock.calls.length).toBe(laidOut + 1);
    expect(selected()).toBe("package");
    expect(scrolled).toHaveBeenCalled();
    scrolled.mockRestore();
  });

  it("says that the metamodel defines no types, and why when the call or the layout fails", async () => {
    let answer: MetamodelGetOutput | Error = new Error("No metamodel");
    const { echoed, show, data, drawn } = await mount(asCall(fakeCall(() => answer)));
    expect(query(".metamodel p.quiet").textContent).toBe("No metamodel");
    // The view cannot draw its buffer and says so: a switch in motion to it starts at once (SR-212).
    expect(drawn).toEqual(["metamodel"]);
    expect(query(".metamodel").getAttribute("aria-activedescendant")).toBeNull();
    expect(echoed).toEqual(["No metamodel"]);
    expect(data).toEqual([]);
    await press("ArrowDown");
    expect(selected()).toBeUndefined();
    answer = metamodelOutput({ relations: [{ key: "r", name: "R" }] });
    await show(1);
    expect(query(".metamodel p.quiet").textContent).toBe("The metamodel defines no types.");
    expect(query(".metamodel").getAttribute("aria-activedescendant")).toBeNull();
    expect(data.at(-1)).toEqual(["metamodel", { kind: "metamodel", types: 0 }]);
    answer = FIXTURE_METAMODEL;
    await show(2);
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
    // A later failure keeps what the sheet shows.
    answer = new Error("Gone");
    await show(3);
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
    vi.mocked(layoutModule.layoutMetamodel).mockImplementationOnce(() => {
      throw new Error("Not possible");
    });
    answer = metamodelOutput({ types: [effectiveType("a")] });
    await show(4);
    expect(echoed.at(-1)).toBe("The metamodel could not be laid out: Error: Not possible");
    expect(drawn).toEqual(["metamodel", "metamodel", "metamodel"]);
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
  });

  it("drops the answer of a call that a newer one replaced", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const { show } = await mount(call as unknown as Call);
    await show(1);
    await act(async () => {
      answers[0]?.({ ok: true, output: metamodelOutput({ types: [effectiveType("a")] }) });
      answers[1]?.({ ok: true, output: FIXTURE_METAMODEL });
      await Promise.resolve();
    });
    await flush();
    expect(container.querySelectorAll(".mm-type")).toHaveLength(6);
  });
});

/** The selected row of the text. */
const selectedRow = (): string | undefined =>
  container.querySelector<HTMLElement>('.mm-row[aria-selected="true"]')?.dataset["row"];

describe("MetamodelView as text", () => {
  it("[SR-130/AK-y6rs] shows each type with key, name, prefix, parent, properties with value kind, required and whether they count to the version, and statuses, and each relation kind with its source and target types", async () => {
    const { data } = await mount(asCall(fakeCall()), metamodelBuffer("text"));
    expect(container.querySelector(".mm-type")).toBeNull();
    expect(query(".metamodel-text").dataset["rows"]).toBe("13");
    expect(data.at(-1)).toEqual(["metamodel", { kind: "metamodel", types: 5 }]);
    const section = query('[data-row="type:software-requirement"]');
    expect([...section.querySelectorAll(".mm-text-head > span")].map((part) => part.textContent)).toEqual([
      "Software Requirement",
      "SWR",
      "software-requirement",
    ]);
    expect(section.querySelector("[data-parent]")?.textContent).toBe("extends System Requirement");
    expect(
      [...section.querySelectorAll<HTMLElement>(".mm-text-property")].map((line) => [
        [...line.children].map((part) => part.textContent),
        line.classList.contains("inherited"),
      ]),
    ).toEqual([
      [["Title", "title", "text", "required", ""], true],
      [["Rationale", "rationale", "text", "", ""], true],
      [["Package", "packages", "list of relation → Package", "", ""], true],
      [["Component", "component", "list of choice", "required", "counts to version"], false],
    ]);
    expect(section.querySelector("[data-statuses]")?.textContent).toBe("Statuses Draft · Approved · Retired");
    expect(query('[data-row="type:item"] .mm-note').textContent).toBe("abstract");
    expect(container.querySelector('[data-row="type:item"] [data-parent]')).toBeNull();
    expect(query('[data-row="type:package"] [data-statuses]').textContent).toBe("Statuses none");
    const relation = query('[data-row="relation:concerns"]');
    expect(relation.querySelector("[data-source]")?.textContent).toBe("any type");
    expect(relation.querySelector("[data-target]")?.textContent).toBe("System Requirement, Decision");
    expect(query('[data-row="relation:blocks"] [data-source]').textContent).toBe("none");
    expect([...container.querySelectorAll(".mm-group")].map((group) => group.textContent)).toEqual([
      "Types",
      "Relation kinds",
    ]);
  });

  it("[SR-130/AK-y6rs] shows the most entries of a list property and each minimum and maximum of a relation kind", async () => {
    const output = metamodelOutput({
      types: [effectiveType("need", ["criteria"])],
      properties: [
        { key: "criteria", name: "Criteria", kind: "text", many: true, "max-items": 3, content: true },
      ],
      relations: [
        {
          key: "derives-from",
          name: "Derives from",
          limits: [
            { "target-type": "need", min: 1 },
            { "target-type": "need", max: 2 },
            { "target-type": "need", min: 1, max: 3 },
          ],
        },
      ],
    });
    await mount(asCall(fakeCall(() => output)), metamodelBuffer("text"));
    expect(query('[data-row="type:need"] [data-property="criteria"] .mm-value').textContent).toBe(
      "list of text · at most 3",
    );
    expect(
      [...container.querySelectorAll('[data-row="relation:derives-from"] [data-limit]')].map(
        (line) => line.textContent,
      ),
    ).toEqual(["limit → NEED: at least 1", "limit → NEED: at most 2", "limit → NEED: 1 to 3"]);
  });

  it("[SR-130/AK-g9gk] Ctrl/Cmd+T's switch keeps the selected type: the text opens on it, and a type selected in the text is the graph's", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { actions, change } = await mount(asCall(fakeCall()), {
      ...metamodelBuffer(),
      selected: "type:decision",
    });
    expect(selected()).toBe("decision");
    scrolled.mockClear();
    await change({ type: "open", buffer: { ...metamodelBuffer("text"), selected: "type:decision" } });
    expect(container.querySelector(".mm-type")).toBeNull();
    expect(selectedRow()).toBe("type:decision");
    expect(query(".metamodel-text").getAttribute("aria-activedescendant")).toBe("mm-row-3");
    expect(scrolled).toHaveBeenCalledWith({ block: "start" });
    // Down and Up, Ctrl+N and Ctrl+P, Page Down, Home and End move through the rows.
    await press("ArrowDown", {}, ".metamodel-text");
    expect(selectedRow()).toBe("type:package");
    expect(actions.at(-1)).toEqual({ type: "select", key: "metamodel", node: "type:package" });
    expect(scrolled).toHaveBeenLastCalledWith({ block: "nearest" });
    await press("n", { ctrlKey: true }, ".metamodel-text");
    expect(selectedRow()).toBe("relation:derives-from");
    await press("p", { ctrlKey: true }, ".metamodel-text");
    expect(selectedRow()).toBe("type:package");
    await press("ArrowDown", {}, ".metamodel-text");
    await press("PageDown", {}, ".metamodel-text");
    expect(selectedRow()).toBe("relation:refines");
    await press("End", {}, ".metamodel-text");
    expect(selectedRow()).toBe("relation:blocks");
    await press("PageDown", {}, ".metamodel-text");
    expect(selectedRow()).toBe("relation:blocks");
    // Ctrl/Cmd+T and the other shortcuts are the window's.
    const before = actions.length;
    await press("t", { ctrlKey: true }, ".metamodel-text");
    await press("t", { metaKey: true }, ".metamodel-text");
    await press("Enter", {}, ".metamodel-text");
    expect(actions).toHaveLength(before);
    // A relation kind is no box: back in the graph, the type selected last stays selected.
    await change({
      type: "open",
      buffer: { ...metamodelBuffer("graph"), selected: "type:package", row: "relation:blocks" },
    });
    expect(selected()).toBe("package");
    await change({
      type: "open",
      buffer: { ...metamodelBuffer("text"), selected: "type:package", row: "relation:blocks" },
    });
    expect(selectedRow()).toBe("relation:blocks");
    await press("Home", {}, ".metamodel-text");
    expect(selectedRow()).toBe("type:item");
    await act(async () => {
      query('[data-row="type:requirement"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
    expect(selectedRow()).toBe("type:requirement");
    await change({ type: "open", buffer: { ...metamodelBuffer("graph"), selected: "type:requirement" } });
    expect(selected()).toBe("requirement");
    scrolled.mockRestore();
  });

  it("opens on the first row when the selected type is not a row, says why when the call fails, and lists the problems", async () => {
    let answer: MetamodelGetOutput | Error = new Error("No metamodel");
    const { show, actions } = await mount(asCall(fakeCall(() => answer)), {
      ...metamodelBuffer("text"),
      selected: "any",
    });
    expect(query(".metamodel-text p.quiet").textContent).toBe("No metamodel");
    expect(query(".metamodel-text").getAttribute("aria-activedescendant")).toBeNull();
    await press("ArrowDown", {}, ".metamodel-text");
    expect(actions).toEqual([]);
    answer = {
      ...metamodelOutput({}),
      problems: [{ code: "metamodel.invalid", severity: "error", message: "broken" }],
    };
    await show(1);
    expect(query(".metamodel-text p.quiet").textContent).toBe("The metamodel defines no types.");
    expect([...container.querySelectorAll(".mm-problem")].map((line) => line.textContent)).toEqual([
      "error  metamodel.invalid  broken",
    ]);
    answer = metamodelOutput({ relations: [{ key: "r", name: "R" }] });
    await show(2);
    expect(selectedRow()).toBe("relation:r");
    expect([...container.querySelectorAll(".mm-group")].map((group) => group.textContent)).toEqual([
      "Relation kinds",
    ]);
    answer = FIXTURE_METAMODEL;
    await show(3);
    expect(selectedRow()).toBe("type:item");
    expect(container.querySelector(".mm-problem")).toBeNull();
  });
});

describe("MetamodelView's context menus (SR-199)", () => {
  /** The place of a press on `selector`, and the arguments its menu gives, as "command: field=value (label)". */
  const menuAt = (selector: string): { place: MenuPlace | undefined; given: string[] } => {
    const target = query(selector);
    // The view is inside an area of the sheet in the window.
    container.setAttribute("data-area", "left");
    const place = placeAt(target);
    const given = place === undefined ? undefined : metamodelGiven(place, target);
    return {
      place,
      given: Object.entries(given ?? {}).map(
        ([command, values]) =>
          `${command}: ${values.map((value) => `${value.field}=${JSON.stringify(value.value)} (${value.label})`).join(", ")}`,
      ),
    };
  };
  const ids = (place: MenuPlace): string[] =>
    menuEntries(
      { place, target: container, point: { x: 0, y: 0 } },
      [
        "command:metamodel.addType",
        "command:metamodel.addRelationKind",
        "metamodel-text",
        "copy-mermaid",
        "command:metamodel.addProperty",
        "command:metamodel.addStatus",
        "command:metamodel.changeType",
        "command:metamodel.removeType",
        "command:metamodel.changeProperty",
        "command:metamodel.removeProperty",
        "command:metamodel.changeStatus",
        "command:metamodel.removeStatus",
        "command:metamodel.changeRelationKind",
        "command:metamodel.removeRelationKind",
      ].map((id) => ({ id, name: id, run: () => undefined })),
    ).map((entry) => entry.id);

  it("[SR-199/AK-w4jd] gives the sheet's menu outside the boxes and labels, on an inheritance curve or line and on Any type", async () => {
    await mount(asCall(fakeCall()));
    for (const selector of [
      ".metamodel",
      "[data-any]",
      "[data-any] .mm-head",
      '.mm-edge[data-source="type:requirement"][data-target="type:item"]',
      ".mm-line[data-extends]",
    ]) {
      expect(menuAt(selector), selector).toEqual({ place: "metamodel-graph", given: [] });
    }
    expect(ids("metamodel-graph")).toEqual([
      "command:metamodel.addType",
      "command:metamodel.addRelationKind",
      "metamodel-text",
      "copy-mermaid",
    ]);
    // A curve of relation kinds only, and a box outside its definitions: the buffer's menu (SR-194 AK6).
    expect(menuAt('.mm-edge[data-source="type:requirement"][data-target="type:requirement"]').place).toBe(
      "buffer",
    );
    expect(menuAt('[data-type="item"]').place).toBe("buffer");
  });

  it("[SR-199/AK-gh1p] gives the type's commands on its name or prefix, the type given, as the source type of a new relation kind", async () => {
    await mount(asCall(fakeCall()));
    for (const selector of ['[data-type="decision"] .mm-name', '[data-type="decision"] .mm-prefix']) {
      expect(menuAt(selector), selector).toEqual({
        place: "metamodel-type",
        given: [
          'metamodel.addProperty: type="decision" (Decision)',
          'metamodel.addStatus: type="decision" (Decision)',
          'metamodel.changeType: type="decision" (Decision)',
          'metamodel.addRelationKind: sourceTypes=["decision"] (Decision)',
          'metamodel.removeType: type="decision" (Decision)',
        ],
      });
    }
    expect(ids("metamodel-type")).toEqual([
      "command:metamodel.addProperty",
      "command:metamodel.addStatus",
      "command:metamodel.changeType",
      "command:metamodel.addRelationKind",
      "command:metamodel.removeType",
    ]);
  });

  it("[SR-199/AK-xd26] gives a property's commands with the type that has it itself, and a status's with its type", async () => {
    await mount(asCall(fakeCall()));
    // Rationale is inherited by Software Requirement from System Requirement.
    expect(menuAt('[data-type="software-requirement"] [data-property="rationale"]')).toEqual({
      place: "metamodel-property",
      given: [
        'metamodel.changeProperty: property="rationale" (Rationale), type="requirement" (System Requirement)',
        'metamodel.removeProperty: type="requirement" (System Requirement), property="rationale" (Rationale)',
      ],
    });
    // The label line of the relation property Package, from the type that has it.
    expect(menuAt('.mm-line[data-property="packages"]').given).toEqual([
      'metamodel.changeProperty: property="packages" (Package), type="requirement" (System Requirement)',
      'metamodel.removeProperty: type="requirement" (System Requirement), property="packages" (Package)',
    ]);
    expect(menuAt('[data-type="software-requirement"] [data-status="retired"]')).toEqual({
      place: "metamodel-status",
      given: [
        'metamodel.changeStatus: status="retired" (Retired)',
        'metamodel.removeStatus: type="software-requirement" (Software Requirement), status="retired" (Retired)',
      ],
    });
    expect(ids("metamodel-property")).toEqual([
      "command:metamodel.changeProperty",
      "command:metamodel.removeProperty",
    ]);
    expect(ids("metamodel-status")).toEqual([
      "command:metamodel.changeStatus",
      "command:metamodel.removeStatus",
    ]);
  });

  it("[SR-199/AK-r1q0] gives a relation kind's commands on its label line, the kind given", async () => {
    await mount(asCall(fakeCall()));
    expect(menuAt('.mm-line[data-kind="delegates-to"]')).toEqual({
      place: "metamodel-kind",
      given: [
        'metamodel.changeRelationKind: kind="delegates-to" (Delegates to)',
        'metamodel.removeRelationKind: kind="delegates-to" (Delegates to)',
      ],
    });
    expect(ids("metamodel-kind")).toEqual([
      "command:metamodel.changeRelationKind",
      "command:metamodel.removeRelationKind",
    ]);
  });

  it("gives nothing on a place without its definitions, or outside the graph's places", async () => {
    await mount(asCall(fakeCall()));
    const bare = document.createElement("div");
    for (const place of [
      "metamodel-type",
      "metamodel-property",
      "metamodel-status",
      "metamodel-kind",
    ] as const) {
      bare.setAttribute("data-menu", place);
      expect(metamodelGiven(place, bare)).toBeUndefined();
    }
    expect(metamodelGiven("metamodel-type", undefined)).toBeUndefined();
    expect(metamodelGiven("buffer", query(".metamodel"))).toBeUndefined();
    // A name left out is the key.
    bare.setAttribute("data-menu", "metamodel-kind");
    bare.setAttribute("data-given-kind", "k");
    expect(metamodelGiven("metamodel-kind", bare)?.["metamodel.removeRelationKind"]).toEqual([
      { field: "kind", value: "k", label: "k" },
    ]);
  });
});

describe("MetamodelView's last change (SR-130 AK7)", () => {
  const changedIn = (selector: string): string[] =>
    [...container.querySelectorAll<HTMLElement>(`${selector}.changed`)].map(
      (place) =>
        `${place.closest<HTMLElement>("[data-type]")?.dataset["type"] ?? place.closest<HTMLElement>("[data-row]")?.dataset["row"] ?? ""}:${place.textContent}`,
    );

  it("[SR-130/AK-wb12] marks every place of a changed or new definition in the graph and the text, and nothing without a change", async () => {
    const change: MetamodelChange = {
      types: ["decision"],
      properties: [{ key: "rationale", type: "requirement" }],
      statuses: [{ key: "retired" }],
      kinds: ["delegates-to"],
    };
    await mount(asCall(fakeCall()), metamodelBuffer(), change);
    expect(changedIn(".mm-head")).toEqual(["decision:DecisionD"]);
    // The property in the type that got it and in the type that inherits it from there.
    expect(changedIn(".mm-property")).toEqual(["requirement:Rationale", "software-requirement:Rationale"]);
    expect(changedIn(".mm-status")).toEqual([
      "item:Retired",
      "requirement:Retired",
      "software-requirement:Retired",
    ]);
    expect(changedIn(".mm-line")).toEqual([":Delegates to"]);
    root.unmount();
    root = createRoot(container);
    await mount(asCall(fakeCall()), metamodelBuffer("text"), change);
    expect(changedIn(".mm-text-head")).toEqual([
      "type:decision:DecisionDdecision",
      "relation:delegates-to:Delegates todelegates-toSystem Requirement → Software Requirement",
    ]);
    expect(changedIn(".mm-text-property").length).toBe(2);
    expect(changedIn(".mm-text-status").length).toBe(3);
    root.unmount();
    root = createRoot(container);
    await mount(asCall(fakeCall()));
    expect(container.querySelectorAll(".changed")).toHaveLength(0);
  });
});
