// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import { act, createElement, useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Buffer, BufferAction } from "./buffers.js";
import { nth } from "./lists.js";
import { bufferName, overviewBuffer, reduceBuffers } from "./buffers.js";
import type { Call } from "./call.js";
import { OverviewView, useOverview } from "./OverviewView.js";
import type { RecentEntry } from "./recent.js";
import type { BufferData } from "./modeline.js";
import type { NextStep } from "./next-steps.js";
import type { StepRow } from "./overview.js";
import {
  asCall,
  click,
  container,
  fakeCall,
  flush,
  press,
  query,
  render,
  texts,
  unrecorded,
} from "./components.test-helper.js";

describe("OverviewView", () => {
  const FACETS = {
    total: 4,
    types: [
      { key: "need", name: "Need", count: 1 },
      { key: "system-requirement", name: "System Requirement", count: 3 },
    ],
    incomplete: false,
  };
  const element = (n: number) => ({
    id: `uuid-${String(n)}`,
    repository: "spec",
    shortId: `SR-${String(n)}`,
    title: `Title ${String(n)}`,
  });
  const entry = (n: number): RecentEntry => ({ id: `uuid-${String(n)}`, repository: "spec" });
  /** The UUIDs of a list of the recent elements (`readRecent`), or none for a list of counts. */
  const idsOf = (input: Record<string, unknown>): string[] | undefined =>
    (input["selection"] as { ids?: string[] } | undefined)?.ids;
  /** The recent elements of `ids` as `element.list` gives them; it fails as a whole on a UUID in `gone`. */
  const listOf = (ids: readonly string[], gone: ReadonlySet<string>): unknown =>
    ids.some((id) => gone.has(id))
      ? Object.assign(new Error("gone"), { code: "ref.unknown" })
      : { elements: ids.map((id) => element(Number(id.replace("uuid-", "")))) };
  const handlers = (
    gone: ReadonlySet<string> = new Set(),
  ): Record<string, (input: Record<string, unknown>) => unknown> => ({
    "element.facets": () => FACETS,
    "element.list": (input: Record<string, unknown>) => listOf(idsOf(input) ?? [], gone),
  });

  /** The overview as the app uses it: the loading hook, the view, and what it reported. */
  const mount = async (
    call: Call,
    initial: {
      recent?: RecentEntry[];
      active?: boolean;
      turn?: () => Promise<void>;
      steps?: readonly StepRow[];
    } = {},
  ) => {
    const opened: Buffer[] = [];
    const stepped: NextStep[] = [];
    const data: [string, BufferData | undefined][] = [];
    const echoed: string[] = [];
    const actions: BufferAction[] = [];
    const perspectives: string[] = [];
    const echo = (message: string): void => {
      echoed.push(message);
    };
    let setRevision: (revision: number) => void = () => undefined;
    let setRecent: (recent: RecentEntry[]) => void = () => undefined;
    let setActive: (active: boolean) => void = () => undefined;
    const Harness = (): React.ReactElement => {
      const [revision, changeRevision] = useReducer((_: number, next: number) => next, 0);
      const [recent, changeRecent] = useReducer(
        (_: RecentEntry[], next: RecentEntry[]) => next,
        initial.recent ?? [],
      );
      const [active, changeActive] = useReducer((_: boolean, next: boolean) => next, initial.active ?? true);
      setRevision = changeRevision;
      setRecent = changeRecent;
      setActive = changeActive;
      const [buffers, dispatch] = useReducer(reduceBuffers, [overviewBuffer()]);
      const overview = useOverview(call, revision, recent, active, echo, initial.turn);
      const [shown] = buffers;
      if (shown?.kind !== "overview") {
        return createElement("p", { id: "elsewhere" }, shown === undefined ? "none" : bufferName(shown));
      }
      return createElement(OverviewView, {
        buffer: shown,
        data: overview.data,
        perspectives: overview.perspectives,
        recents: overview.recents,
        onPerspective: (name) => perspectives.push(name),
        steps: initial.steps ?? [],
        onStep: (step) => stepped.push(step),
        dispatch: (action) => {
          actions.push(action);
          if (action.type === "open") {
            opened.push(action.buffer);
          }
          dispatch(action);
        },
        onData: (key, loaded) => data.push([key, loaded]),
      });
    };
    await render(createElement(Harness));
    const change = async (apply: () => void): Promise<void> => {
      await act(async () => {
        apply();
        await Promise.resolve();
      });
      await flush();
    };
    return {
      opened,
      stepped,
      data,
      echoed,
      actions,
      perspectives,
      revision: (next: number) =>
        change(() => {
          setRevision(next);
        }),
      recent: (next: RecentEntry[]) =>
        change(() => {
          setRecent(next);
        }),
      active: (next: boolean) =>
        change(() => {
          setActive(next);
        }),
    };
  };
  const options = (): string[] => texts('[role="option"]');
  const listbox = (): HTMLElement => query('[role="listbox"]');

  it("[SR-118/AK-yggg] shows a line per type with its count, one text with a space: Need 1", async () => {
    await mount(asCall(fakeCall(handlers())));
    expect(options()).toEqual(["Need 1", "System Requirement 3"]);
    expect(listbox().getAttribute("aria-label")).toBe("Overview");
    expect(container.querySelector("[data-buffer]")).toBe(listbox());
    expect(query('[role="option"]').getAttribute("aria-label")).toBe("Need 1");
    expect(query(".count").textContent).toBe("1");
  });

  it("is an empty listbox while the counts load, and reports no data to the modeline", async () => {
    const answers: ((value: unknown) => void)[] = [];
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const view = await mount(unrecorded(call) as unknown as Call);
    expect(options()).toEqual([]);
    expect(listbox().getAttribute("aria-activedescendant")).toBeNull();
    expect(view.data.at(-1)).toEqual(["overview", undefined]);
    await act(async () => {
      answers[0]?.({ ok: true, output: FACETS });
      answers[1]?.({ ok: true, output: { perspectives: [] } });
      await Promise.resolve();
    });
    await flush();
    expect(options()).toHaveLength(2);
    expect(view.data.at(-1)).toEqual(["overview", { kind: "overview", total: 4, incomplete: false }]);
  });

  it("reads the recent elements with their repository, newest first, and leaves out one that cannot be read", async () => {
    const call = fakeCall(handlers(new Set(["uuid-2"])));
    await mount(unrecorded(call) as unknown as Call, { recent: [entry(3), entry(2), entry(1)] });
    expect(options()).toEqual(["Need 1", "System Requirement 3", "SR-3Title 3", "SR-1Title 1"]);
    expect(call).toHaveBeenCalledWith("element.list", { selection: { ids: ["uuid-3", "uuid-2", "uuid-1"] } });
    expect(call).not.toHaveBeenCalledWith("element.get", expect.anything());
    expect(texts(".group")).toEqual(["Recent"]);
  });

  it("asks for the counts once per revision and for the recent elements when they change", async () => {
    const call = fakeCall(handlers());
    const view = await mount(unrecorded(call) as unknown as Call);
    const asked = (name: string): number => call.mock.calls.filter(([called]) => called === name).length;
    expect(asked("element.facets")).toBe(1);
    await view.recent([entry(1)]);
    expect(asked("element.facets")).toBe(1);
    expect(options()).toHaveLength(3);
    await view.revision(1);
    expect(asked("element.facets")).toBe(2);
    expect(asked("element.list")).toBe(2);
  });

  it("asks for nothing while it is not shown, and shows what it has at once when it is shown again", async () => {
    const call = fakeCall(handlers());
    const view = await mount(unrecorded(call) as unknown as Call, { active: false, recent: [entry(1)] });
    expect(call).not.toHaveBeenCalled();
    await view.active(true);
    expect(call.mock.calls.map(([called]) => called)).toEqual([
      "element.facets",
      "perspective.list",
      "element.list",
    ]);
    await view.active(false);
    await view.active(true);
    // The counts of this revision are there; only the recent elements are read again.
    expect(call.mock.calls.filter(([called]) => called === "element.facets")).toHaveLength(1);
    expect(options()).toEqual(["Need 1", "System Requirement 3", "SR-1Title 1"]);
  });

  it("drops the answers that come after it was left or the workspace changed", async () => {
    const pending: { name: string; resolve: (value: unknown) => void }[] = [];
    const call = vi.fn(
      (name: string) =>
        new Promise((resolve) => {
          pending.push({ name, resolve });
        }),
    );
    const view = await mount(unrecorded(call) as unknown as Call, { recent: [entry(1)] });
    await view.active(false);
    await act(async () => {
      for (const { name, resolve } of pending) {
        resolve({
          ok: true,
          output:
            name === "element.facets"
              ? FACETS
              : name === "perspective.list"
                ? { perspectives: [] }
                : { elements: [element(1)] },
        });
      }
      await Promise.resolve();
    });
    await view.active(true);
    expect(options()).toEqual([]);
    // Each read twice: before it was left, and when it was shown again.
    expect(call).toHaveBeenCalledTimes(6);
  });

  it("echoes why the counts could not be read", async () => {
    const view = await mount(
      asCall(fakeCall({ "element.facets": () => new Error("The workspace is not valid") })),
    );
    expect(view.echoed).toEqual(["The workspace is not valid"]);
    expect(options()).toEqual([]);
  });

  it("moves the selection with the arrow keys, Home and End, inside the lines, and keeps Cmd+P for the window", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    const selected = (): string => query('[aria-selected="true"]').id;
    // No line is selected yet (SR-122): the first Down selects the first one.
    expect(container.querySelector('[aria-selected="true"]')).toBeNull();
    await press(listbox(), "ArrowDown");
    expect(selected()).toBe("overview-0");
    await press(listbox(), "ArrowDown");
    await press(listbox(), "ArrowDown");
    expect(selected()).toBe("overview-2");
    await press(listbox(), "ArrowUp");
    expect(selected()).toBe("overview-1");
    await press(listbox(), "Home");
    expect(selected()).toBe("overview-0");
    await press(listbox(), "ArrowUp");
    expect(selected()).toBe("overview-0");
    await press(listbox(), "End");
    expect(selected()).toBe("overview-2");
    const keys = view.actions.length;
    const event = new KeyboardEvent("keydown", { key: "p", metaKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      listbox().dispatchEvent(event);
      await Promise.resolve();
    });
    expect(event.defaultPrevented).toBe(false);
    expect(view.actions).toHaveLength(keys);
  });

  it("opens the list of a type line and the element of a recent line on Enter, and a clicked line", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    await press(listbox(), "ArrowDown");
    await press(listbox(), "ArrowDown");
    await press(listbox(), "Enter");
    expect(view.opened[0]).toMatchObject({ kind: "list", label: "type: system-requirement" });
    expect(query("#elsewhere").textContent).toBe("type: system-requirement");
  });

  it("opens an element on a click, and does nothing on Enter without lines", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    await click(nth([...container.querySelectorAll('[role="option"]')], 2));
    expect(view.opened[0]).toMatchObject({ kind: "element", id: "uuid-1" });
    const empty = await mount(asCall(fakeCall({ "element.facets": () => new Error("x") })));
    await press(listbox(), "Enter");
    await press(listbox(), "End");
    expect(empty.opened).toEqual([]);
  });

  it("[SR-122/AK-mqwc] Enter with no line selected opens the first line and selects it", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    expect(listbox().getAttribute("aria-activedescendant")).toBeNull();
    await press(listbox(), "Enter");
    expect(view.actions[0]).toEqual({ type: "cursor", key: "overview", cursor: 0 });
    expect(view.opened[0]).toMatchObject({ kind: "list", label: "type: need" });
  });

  it("keeps the selection on a line when the lines became fewer", async () => {
    const view = await mount(asCall(fakeCall(handlers())), { recent: [entry(1)] });
    await press(listbox(), "End");
    expect(query('[aria-selected="true"]').id).toBe("overview-2");
    await view.recent([]);
    expect(query('[aria-selected="true"]').id).toBe("overview-1");
  });

  const listed = (name: string) => ({ name, file: `perspectives/${name}.yaml`, where: { all: [] } });
  /** The overview's handlers with the perspectives `names`; `counts` answers `element.list` with one. */
  const withPerspectives = (
    names: readonly string[],
    counts: (name: string) => unknown = (name) => ({ total: name.length, partial: [] }),
  ) => ({
    ...handlers(),
    "perspective.list": () => ({ perspectives: names.map(listed) }),
    "element.list": (input: Record<string, unknown>) => {
      const ids = idsOf(input);
      return ids === undefined ? counts(String(input["perspective"])) : listOf(ids, new Set());
    },
  });

  it("[SR-118/AK-h5f7] shows at most ten perspectives under Perspectives, by name ignoring case, each with the count of its selection", async () => {
    const names = [
      "kilo",
      "Bravo",
      "alpha",
      "Juliet",
      "echo",
      "Delta",
      "india",
      "golf",
      "Hotel",
      "foxtrot",
      "charlie",
    ];
    const call = fakeCall(withPerspectives(names));
    await mount(asCall(call), { recent: [entry(1)] });
    expect(texts(".group")).toEqual(["Perspectives", "Recent"]);
    expect(options()).toEqual([
      "Need 1",
      "System Requirement 3",
      "alpha 5",
      "Bravo 5",
      "charlie 7",
      "Delta 5",
      "echo 4",
      "foxtrot 7",
      "golf 4",
      "Hotel 5",
      "india 5",
      "Juliet 6",
      "SR-1Title 1",
    ]);
    expect(query('.perspective[role="option"]').getAttribute("aria-label")).toBe("alpha 5");
    // The count is the total of `element.list` with the perspective, in the call given (the window's view);
    // the eleventh is not counted.
    const listCalls = call.mock.calls
      .filter(([name, input]) => name === "element.list" && input["selection"] === undefined)
      .map(([, input]) => input);
    expect(listCalls).toHaveLength(10);
    expect(listCalls[0]).toEqual({ perspective: "alpha", limit: 1, fields: ["identifier"], sort: [] });
  });

  it("[SR-118/AK-hvth] shows the types and the names of the perspectives first, and each count once it is computed", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const call = fakeCall(handlers());
    const waiting = vi.fn((name: string, input: Record<string, unknown>) =>
      name === "perspective.list"
        ? Promise.resolve({ ok: true, output: { perspectives: [listed("Open"), listed("Drafts")] } })
        : name === "element.list"
          ? new Promise((resolve) => {
              pending.set(String(input["perspective"]), resolve);
            })
          : call(name, input),
    );
    await mount(unrecorded(waiting) as unknown as Call);
    expect(options()).toEqual(["Need 1", "System Requirement 3", "Drafts", "Open"]);
    // One count at a time: the second is asked for once the first answered.
    expect([...pending.keys()]).toEqual(["Drafts"]);
    await act(async () => {
      pending.get("Drafts")?.({ ok: true, output: { total: 7, partial: [] } });
      await Promise.resolve();
    });
    await flush();
    expect(options()).toEqual(["Need 1", "System Requirement 3", "Drafts 7", "Open"]);
    await act(async () => {
      pending.get("Open")?.({ ok: true, output: { total: 2, partial: [] } });
      await Promise.resolve();
    });
    await flush();
    expect(options()).toEqual(["Need 1", "System Requirement 3", "Drafts 7", "Open 2"]);
  });

  it("[SR-118/AK-jtg3] a perspective line opens its perspective, on Enter and on a click", async () => {
    const view = await mount(asCall(fakeCall(withPerspectives(["Drafts", "Open"]))));
    await press(listbox(), "End");
    await press(listbox(), "Enter");
    await click(nth([...container.querySelectorAll('[role="option"]')], 2));
    expect(view.perspectives).toEqual(["Open", "Drafts"]);
    expect(view.opened).toEqual([]);
  });

  it("[SR-118/AK-hvth] asks for each count only when it is its turn: the window idle and no other call pending", async () => {
    const turns: (() => void)[] = [];
    const turn = (): Promise<void> =>
      new Promise((resolve) => {
        turns.push(resolve);
      });
    const call = fakeCall(withPerspectives(["A", "B"]));
    await mount(asCall(call), { turn });
    const counts = (): number => call.mock.calls.filter(([name]) => name === "element.list").length;
    expect(options()).toEqual(["Need 1", "System Requirement 3", "A", "B"]);
    expect(counts()).toBe(0);
    await act(async () => {
      turns[0]?.();
      await Promise.resolve();
    });
    await flush();
    expect(counts()).toBe(1);
    expect(options()).toEqual(["Need 1", "System Requirement 3", "A 1", "B"]);
    await act(async () => {
      turns[1]?.();
      await Promise.resolve();
    });
    await flush();
    expect(options()).toEqual(["Need 1", "System Requirement 3", "A 1", "B 1"]);
  });

  it("counts only while it is shown, and shown again asks only for the perspectives not counted yet", async () => {
    const pending: { name: string; resolve: (value: unknown) => void }[] = [];
    const call = fakeCall(handlers());
    const held = vi.fn((name: string, input: Record<string, unknown>) =>
      name === "perspective.list"
        ? Promise.resolve({ ok: true, output: { perspectives: ["A", "B", "C"].map(listed) } })
        : name === "element.list"
          ? new Promise((resolve) => {
              pending.push({ name: String(input["perspective"]), resolve });
            })
          : call(name, input),
    );
    const view = await mount(unrecorded(held) as unknown as Call);
    expect(pending.map((asked) => asked.name)).toEqual(["A"]);
    await view.active(false);
    // The count that answers after the overview was left is kept; no further one is asked for.
    await act(async () => {
      pending[0]?.resolve({ ok: true, output: { total: 1, partial: [] } });
      await Promise.resolve();
    });
    await flush();
    expect(pending.map((asked) => asked.name)).toEqual(["A"]);
    await view.active(true);
    expect(options()).toEqual(["Need 1", "System Requirement 3", "A 1", "B", "C"]);
    expect(pending.map((asked) => asked.name)).toEqual(["A", "B"]);
  });

  it("shows a short reason instead of the count of a perspective that cannot be listed, the message on hover", async () => {
    const counts = (name: string): unknown =>
      name === "Broken"
        ? Object.assign(new Error('Perspective "Broken": its saved filter "Gone" does not exist'), {
            code: "input.invalid",
          })
        : { total: 3, partial: [] };
    await mount(asCall(fakeCall(withPerspectives(["Broken", "Fine"], counts))));
    expect(options()).toEqual(["Need 1", "System Requirement 3", "Broken cannot be listed", "Fine 3"]);
    expect(query(".perspective .reason").getAttribute("title")).toBe(
      'Perspective "Broken": its saved filter "Gone" does not exist',
    );
  });

  it("shows the types without perspectives and echoes why they could not be listed", async () => {
    const view = await mount(
      asCall(fakeCall({ ...handlers(), "perspective.list": () => new Error("The folder cannot be read") })),
    );
    expect(options()).toEqual(["Need 1", "System Requirement 3"]);
    expect(view.echoed).toEqual(["The folder cannot be read"]);
  });

  describe("a workspace in which core counts no element (SR-118 AK9)", () => {
    const STEPS: readonly StepRow[] = [
      { step: { command: "element.create", input: {}, open: [] }, name: "Create element", key: "Ctrl+K E" },
      { step: { command: "reqif.import", input: {}, open: [] }, name: "Import ReqIF file" },
    ];
    const EMPTY = { total: 0, types: [], incomplete: false };

    it("shows the first steps in the middle, then only the perspectives, and runs a step on a click or Enter", async () => {
      const call = fakeCall({ ...withPerspectives(["Drafts"]), "element.facets": () => EMPTY });
      const view = await mount(asCall(call), { recent: [entry(1)], steps: STEPS });
      // No recent element and no type line: the steps, then the perspectives.
      expect(options()).toEqual(["Create elementCtrl+K E", "Import ReqIF file", "Drafts 6"]);
      expect(texts(".group")).toEqual(["Perspectives"]);
      expect(listbox().classList.contains("first-steps")).toBe(true);
      expect(query(".start-line").getAttribute("aria-label")).toBe("Create element");
      expect(texts(".start-key")).toEqual(["Ctrl+K E"]);
      await click(nth([...container.querySelectorAll<HTMLElement>(".start-line")], 1));
      await press(listbox(), "ArrowUp");
      await press(listbox(), "Enter");
      expect(view.stepped.map((step) => step.command)).toEqual(["reqif.import", "element.create"]);
      expect(view.opened).toEqual([]);
      expect(view.data.at(-1)).toEqual(["overview", { kind: "overview", total: 0, incomplete: false }]);
    });

    it("shows no first step in a workspace with elements", async () => {
      await mount(asCall(fakeCall(handlers())), { steps: STEPS });
      expect(options()).toEqual(["Need 1", "System Requirement 3"]);
      expect(listbox().classList.contains("first-steps")).toBe(false);
    });
  });

  it("counts the perspectives again when the workspace changed, and drops a count of the revision before", async () => {
    let total = 1;
    const pending: ((value: unknown) => void)[] = [];
    const call = fakeCall(withPerspectives(["Drafts"]));
    const slow = vi.fn((name: string, input: Record<string, unknown>) =>
      name === "element.list" && total === 1
        ? new Promise((resolve) => {
            pending.push(resolve);
          })
        : call(name, { ...input }),
    );
    const view = await mount(unrecorded(slow) as unknown as Call);
    expect(options()).toEqual(["Need 1", "System Requirement 3", "Drafts"]);
    total = 2;
    await view.revision(1);
    await act(async () => {
      pending[0]?.({ ok: true, output: { total: 99, partial: [] } });
      await Promise.resolve();
    });
    await flush();
    expect(options()).toEqual(["Need 1", "System Requirement 3", "Drafts 6"]);
  });
});
