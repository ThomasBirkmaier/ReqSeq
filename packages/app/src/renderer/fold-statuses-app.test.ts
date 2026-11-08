// @vitest-environment happy-dom
// Elements in folded statuses at the end of lists (SR-201): the collapsed section, the command that chooses
// the statuses, the keys and the click on the section row, and the choice kept for this user only.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult, ReqSeqBridge, WorkspaceChange } from "../shared/protocol.js";
import { App } from "./App.js";
import { FOLD_KEY } from "./fold-statuses.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
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

const keyDown = async (
  target: EventTarget,
  key: string,
  modifiers: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }),
    );
    await Promise.resolve();
  });
  await flush();
};

const type = async (value: string): Promise<void> => {
  const input = query("input");
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setValue = Reflect.get(descriptor ?? {}, "set") as (this: HTMLElement, value: string) => void;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

/** Opens the command prompt, types `name` and runs the first candidate. */
const runCommand = async (name: string): Promise<void> => {
  await keyDown(window, "P", { ctrlKey: true, shiftKey: true });
  await type(name);
  await keyDown(query("input"), "Enter");
};

/** "Fold status in lists" for the status named `name`. */
const foldStatus = async (name: string): Promise<void> => {
  await runCommand("Fold status in lists");
  await type(name);
  await keyDown(query("input"), "Enter");
};

const STATUSES = [
  { key: "draft", name: "Draft" },
  { key: "approved", name: "Approved" },
  { key: "obsolete", name: "Obsolete", invalid: true },
];

const element = (n: number, status: string, title: string) => ({
  id: `uuid-${String(n)}`,
  shortId: `N-00${String(n)}`,
  identifier: `N-00${String(n)}`,
  type: "need",
  status,
  title,
  repository: "spec",
  file: `f${String(n)}.md`,
  text: "",
  properties: {},
  relations: [],
});
const ELEMENTS = [
  element(1, "draft", "See the wind"),
  element(2, "obsolete", "See the fog"),
  element(3, "approved", "See the rain"),
];

type Condition = Readonly<Record<string, unknown>>;

/** The few conditions the lists build here, as core reads them. */
const holds = (candidate: (typeof ELEMENTS)[number], condition: Condition | undefined): boolean => {
  if (condition === undefined) {
    return true;
  }
  if (Array.isArray(condition["all"])) {
    return (condition["all"] as Condition[]).every((part) => holds(candidate, part));
  }
  if (condition["not"] !== undefined) {
    return !holds(candidate, condition["not"] as Condition);
  }
  if (condition["invalid"] !== undefined) {
    return STATUSES.some((status) => status.key === candidate.status && status.invalid === true);
  }
  if (Array.isArray(condition["type"])) {
    return (condition["type"] as string[]).includes(candidate.type);
  }
  return (condition["status"] as string[]).includes(candidate.status);
};

const bridge = () => {
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    "workspace.status": () => ({ name: "Weather station", readOnly: false }),
    "metamodel.get": () => ({
      relations: [],
      types: [{ key: "need", name: "Need", properties: [] }],
      statuses: STATUSES,
      properties: [],
      meanings: {},
    }),
    "element.facets": () => ({
      total: 3,
      types: [{ key: "need", count: 3 }],
      statuses: STATUSES.map(({ key }) => ({ key, count: 1 })),
      properties: [],
      incomplete: false,
    }),
    "element.list": (input) => {
      const where = (input["selection"] as { where?: Condition } | undefined)?.where;
      const found = ELEMENTS.filter((candidate) => holds(candidate, where));
      return { elements: found, total: found.length };
    },
    "element.search": (input) => {
      const where = (input["selection"] as { where?: Condition } | undefined)?.where;
      const hits = ELEMENTS.filter((candidate) => holds(candidate, where)).map((hit) => ({
        ...hit,
        score: 1,
        fields: ["title"],
        terms: ["see"],
      }));
      return { hits, total: hits.length, incomplete: false };
    },
    "element.get": (input) => ({ element: ELEMENTS.find((candidate) => candidate.id === input["ref"]) }),
    "trace.neighbourhood": (input) => ({
      root: input["ref"],
      nodes: [],
      total: 0,
      edges: [],
      incomplete: false,
    }),
  };
  const invoke = vi.fn((name: string, input: Record<string, unknown> = {}): Promise<InvokeResult> =>
    Promise.resolve({ ok: true, output: (handlers[name] ?? NO_SUMMARY[name])?.(input) }),
  );
  const listeners = new Set<(change: WorkspaceChange) => void>();
  /** A change of the workspace from outside: the shown buffers read again. */
  const changed = async (): Promise<void> => {
    await act(async () => {
      for (const listener of listeners) {
        listener({
          reason: "external",
          scope: "elements",
          elements: { added: [], changed: ["uuid-3"], removed: [] },
        });
      }
      await Promise.resolve();
    });
    await flush();
  };
  return {
    invoke,
    changed,
    bridge: {
      invoke,
      commands: () => Promise.resolve([]),
      copyText: () => Promise.resolve(true),
      pasteText: () => Promise.resolve(true),
      recentWorkspaces: () => Promise.resolve([]),
      openWorkspace: () => Promise.resolve({ ok: true }),
      listFolder: () => Promise.resolve({ name: "", entries: [] }),
      onSave: () => () => undefined,
      openDocs: () => Promise.resolve({ ok: true as const }),
      onHelp: () => () => undefined,
      on: (event: string, listener: (data: never) => void) => {
        if (event !== "workspace-changed") {
          return () => undefined;
        }
        const added = listener as (change: WorkspaceChange) => void;
        listeners.add(added);
        return () => listeners.delete(added);
      },
    } satisfies ReqSeqBridge,
  };
};

const open = async () => {
  const fake = bridge();
  await act(async () => {
    root.render(createElement(App, { bridge: fake.bridge }));
    await Promise.resolve();
  });
  await flush();
  return fake;
};

/** What the list shows, row by row: an element by its ID, the section row by its text. */
const shown = (): string[] =>
  [...container.querySelectorAll<HTMLElement>(".list .row")].map((row) =>
    row.classList.contains("fold-row")
      ? row.textContent.trim()
      : (row.querySelector(".id")?.textContent ?? ""),
  );

const section = (): HTMLElement => query(".row.fold-row");

describe("statuses folded in lists (SR-201)", () => {
  it("[SR-201/AK1] without a choice the elements in an invalid status stand at the end, collapsed, with their count", async () => {
    const fake = await open();
    await runCommand("List all elements");
    expect(shown()).toEqual(["N-001", "N-003", "▸ Folded statuses (1)"]);
    expect(section().getAttribute("aria-expanded")).toBe("false");
    expect(fake.invoke).toHaveBeenCalledWith(
      "element.list",
      expect.objectContaining({ selection: { where: { not: { status: ["obsolete"] } } } }),
    );
    expect(fake.invoke).toHaveBeenCalledWith(
      "element.list",
      expect.objectContaining({ selection: { where: { status: ["obsolete"] } } }),
    );
    // The heading counts every element of the list.
    expect(query(".list h1").textContent).toContain("3");
  });

  it("[SR-201/AK1] a filtered list folds within its filter, and a tree folds nothing", async () => {
    const fake = await open();
    await runCommand("List all elements");
    await runCommand("Filter list by type");
    await keyDown(query("input"), "Enter");
    expect(fake.invoke).toHaveBeenCalledWith(
      "element.list",
      expect.objectContaining({
        selection: { where: { all: [{ type: ["need"] }, { not: { status: ["obsolete"] } }] } },
      }),
    );
    expect(shown()).toEqual(["N-001", "N-003", "▸ Folded statuses (1)"]);
    await runCommand("Sort list");
    await type("Hierarchy");
    await keyDown(query("input"), "Enter");
    expect(shown()).toEqual(["N-001", "N-002", "N-003"]);
  });

  it("[SR-201/AK2] choosing a status folds it in every list, choosing it again puts its elements back in place", async () => {
    await open();
    await runCommand("List all elements");
    await foldStatus("Approved");
    expect(shown()).toEqual(["N-001", "▸ Folded statuses (2)"]);
    await foldStatus("Obsolete");
    expect(shown()).toEqual(["N-001", "N-002", "▸ Folded statuses (1)"]);
    await foldStatus("Approved");
    expect(shown()).toEqual(["N-001", "N-002", "N-003"]);
    await runCommand("Fold invalid statuses in lists");
    expect(shown()).toEqual(["N-001", "N-003", "▸ Folded statuses (1)"]);
  });

  it("[SR-201/AK3] the section row opens and closes by click, Enter, Tab, Right and Left, and is collapsed again when the list opens again", async () => {
    await open();
    await runCommand("List all elements");
    const list = query(".list");
    await act(async () => {
      section().click();
      await Promise.resolve();
    });
    expect(shown()).toEqual(["N-001", "N-003", "▾ Folded statuses (1)", "N-002"]);
    expect(section().getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      section().click();
      await Promise.resolve();
    });
    expect(shown()).toHaveLength(3);
    await keyDown(list, "End");
    expect(section().getAttribute("aria-selected")).toBe("true");
    await keyDown(list, "Enter");
    expect(shown()).toHaveLength(4);
    await keyDown(list, "Tab");
    expect(shown()).toHaveLength(3);
    await keyDown(list, "ArrowRight");
    expect(shown()).toHaveLength(4);
    await keyDown(list, "ArrowRight");
    expect(shown()).toHaveLength(4);
    // A folded row opens like any other; back on the list, the section is collapsed again.
    await keyDown(list, "ArrowDown");
    await keyDown(list, "Enter");
    expect(container.querySelector(".list")).toBeNull();
    await keyDown(window, "p", { altKey: true });
    expect(shown()).toEqual(["N-001", "N-003", "▸ Folded statuses (1)"]);
    await keyDown(query(".list"), "ArrowLeft");
    expect(shown()).toHaveLength(3);
  });

  it("[SR-201/AK4] the choice holds after a restart, for every workspace, and writes nothing of a workspace", async () => {
    const first = await open();
    await foldStatus("Draft");
    expect(JSON.parse(window.localStorage.getItem(FOLD_KEY) ?? "null")).toEqual({
      fold: ["draft"],
      unfold: [],
    });
    const effects = first.invoke.mock.calls.map(([name]) => name);
    for (const name of effects) {
      expect(name).not.toMatch(/\.(create|update|save|setStatus|supersede|store|record)/);
    }
    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await open();
    await runCommand("List all elements");
    expect(shown()).toEqual(["N-003", "▸ Folded statuses (2)"]);
  });

  it("[SR-201/AK1] a search result folds its hits in folded statuses the same way", async () => {
    const fake = await open();
    await keyDown(window, "F", { ctrlKey: true, shiftKey: true });
    await type("see");
    await keyDown(query("input"), "Enter");
    expect(shown()).toEqual(["N-001", "N-003", "▸ Folded statuses (1)"]);
    expect(fake.invoke).toHaveBeenCalledWith(
      "element.search",
      expect.objectContaining({ query: "see", selection: { where: { status: ["obsolete"] } } }),
    );
  });

  it("[SR-201/AK3] an open section stays open when the list reads again, and Left on a folded row closes it", async () => {
    const fake = await open();
    await runCommand("List all elements");
    const list = query(".list");
    await keyDown(list, "End");
    await keyDown(list, "ArrowRight");
    await keyDown(list, "ArrowDown");
    await fake.changed();
    expect(shown()).toEqual(["N-001", "N-003", "▾ Folded statuses (1)", "N-002"]);
    // The selected folded row is still the marked element after the list read again.
    fake.invoke.mockClear();
    await runCommand("Open to the right");
    expect(fake.invoke).toHaveBeenCalledWith("element.get", expect.objectContaining({ ref: "uuid-2" }));
    await keyDown(query(".list"), "ArrowLeft");
    expect(shown()).toHaveLength(3);
    expect(section().getAttribute("aria-selected")).toBe("true");
  });
});
