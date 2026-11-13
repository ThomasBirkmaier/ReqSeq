// "Open perspective" (SR-214 AK1–AK4, SR-213 AK6–AK8) and the perspective buffer: the prompt, the opening
// with its check, and the list actions on the buffer. The actions run against a context that records what
// they dispatch, ask and echo.
import { describe, expect, it, vi } from "vitest";
import { ACTIONS } from "./actions.js";
import type { ActionContext, Choice, Prompt } from "./actions.js";
import type { Buffers, ListBuffer } from "./buffers.js";
import {
  LIST_KEY,
  bufferName,
  listBuffer,
  listGroup,
  listHeading,
  listSort,
  listing,
  perspectiveBuffer,
  perspectiveKey,
  reduceBuffers,
  withMatrix,
  withQuery,
} from "./buffers.js";
import type { Call } from "./call.js";
import { statusStep, typeStep } from "./list-filters.js";
import { NONE, OPEN_PERSPECTIVE, openPerspective } from "./perspective-actions.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const DRAFTS = {
  name: "Drafts",
  file: "perspectives/drafts.yaml",
  filter: "Sensors",
  where: { status: ["draft"] },
  group: "type",
  sort: [{ by: "title" }],
};

const SAVED = {
  where: { status: ["draft"] },
  filter: "Sensors",
  group: "type",
  sort: [{ by: "title", order: "asc" as const }],
};

type Answers = Record<string, (input: Record<string, unknown>) => unknown>;

const ok = (output: unknown) => ({ ok: true, output });

/** A context that shows `shown` and answers the commands with `answers`; a missing answer fails. */
const start = (answers: Answers, shown: Buffers = [listBuffer("All elements")], used: string[] = []) => {
  let buffers: Buffers = shown;
  const asked: Prompt[] = [];
  const echoed: string[] = [];
  const opened: string[] = [];
  const call = vi.fn((name: string, input: Record<string, unknown>) =>
    Promise.resolve(answers[name]?.(input) ?? { ok: false, code: "x.failed", message: `${name} failed` }),
  );
  const context: ActionContext = {
    workspace: true,
    buffers,
    mac: false,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: call as unknown as Call,
    dispatch: (action) => {
      buffers = reduceBuffers(buffers, action);
      (context as { buffers: Buffers }).buffers = buffers;
    },
    ask: (prompt) => asked.push(prompt),
    echo: (message) => echoed.push(message),
    modified: false,
    closeArmed: () => false,
    armClose: () => undefined,
    discard: () => undefined,
    drafted: () => false,
    cycleOrder: [],
    cycled: () => undefined,
    leaveEditor: () => undefined,
    perspectives: {
      used: () => used,
      opened: (name) => {
        opened.push(name);
        used.unshift(name);
      },
    },
  };
  const shownList = (): ListBuffer => {
    const [current] = buffers;
    if (current?.kind !== "list") {
      throw new Error("no list");
    }
    return current;
  };
  return { context, asked, echoed, opened, call, shownList, buffers: () => buffers };
};

const action = (id: string) => {
  const found = ACTIONS.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(id);
  }
  return found;
};

const listed =
  (perspectives: unknown[], more: Record<string, unknown> = {}) =>
  () =>
    ok({ perspectives, ...more });

const checked =
  (problems: unknown[] = []) =>
  () =>
    ok({ elements: [], total: 0, problems });

/** The rows of the last prompt, by name, with whether each can be chosen. */
const rows = (asked: Prompt[]): string[] =>
  (asked.at(-1)?.items ?? []).map((item: Choice) => (item.inert === true ? `(${item.name})` : item.name));

describe("Open perspective: the prompt (SR-214 AK1)", () => {
  it("[SR-214/AK-sd9r] lists only the perspectives, those opened last first, then by name ignoring case", async () => {
    const perspective = (name: string) => ({ name, file: `perspectives/${name}.yaml`, where: { all: [] } });
    const { context, asked } = start(
      { "perspective.list": listed(["beta", "Alpha", "gamma", "Delta"].map(perspective)) },
      undefined,
      ["GAMMA", "gone", "Delta"],
    );
    action(OPEN_PERSPECTIVE).run(context);
    await flush();
    expect(asked.at(-1)?.label).toBe("Perspective");
    expect(rows(asked)).toEqual(["gamma", "Delta", "Alpha", "beta"]);
    // No order of use of the command prompt (SR-121 AK2): the order is that of the perspectives.
    expect(asked.at(-1)?.use).toBeUndefined();
  });

  it("[SR-214/AK-sd9r] says that there is none, unless a file is faulty or a repository missing", async () => {
    const none = start({ "perspective.list": listed([]) });
    action(OPEN_PERSPECTIVE).run(none.context);
    await flush();
    expect(none.echoed).toEqual([NONE]);
    expect(none.asked).toHaveLength(0);
    const missing = start({ "perspective.list": listed([], { incomplete: true }) });
    action(OPEN_PERSPECTIVE).run(missing.context);
    await flush();
    expect(rows(missing.asked)).toEqual([`(${NONE})`, "(incomplete: a repository is missing)"]);
    const failed = start({});
    action(OPEN_PERSPECTIVE).run(failed.context);
    await flush();
    expect(failed.echoed).toEqual(["perspective.list failed"]);
    // Only with a workspace.
    expect(action(OPEN_PERSPECTIVE).available({ ...none.context, workspace: false })).toBe(false);
  });

  it("[SR-213/AK-qp6d] names each faulty file with its reason after the perspectives, which cannot be chosen", async () => {
    const { context, asked } = start({
      "perspective.list": listed([DRAFTS], {
        problems: [
          {
            code: "perspective.invalid",
            severity: "error",
            message: "must have where",
            file: "perspectives/x.yaml",
          },
          {
            code: "file.unreadable",
            severity: "error",
            message: "perspectives/y.yaml: bad YAML",
            file: "perspectives/y.yaml",
          },
          { code: "file.unreadable", severity: "error", message: "folder unreadable" },
        ],
      }),
    });
    action(OPEN_PERSPECTIVE).run(context);
    await flush();
    expect(rows(asked)).toEqual([
      "Drafts",
      "(perspectives/x.yaml: must have where)",
      "(perspectives/y.yaml: bad YAML)",
      "(folder unreadable)",
    ]);
    // A row that informs runs nothing.
    asked.at(-1)?.items.at(-1)?.run();
  });
});

describe("Open perspective: opening (SR-214 AK2–AK4, SR-213 AK6, AK7)", () => {
  const answers: Answers = {
    "perspective.list": listed([DRAFTS]),
    "element.list": checked(),
  };

  it("[SR-214/AK-kqd2] opens it as a buffer of its own: its name as heading, its selection as first step, its grouping and sort", async () => {
    const { context, asked, shownList, opened, call, buffers } = start(answers);
    action(OPEN_PERSPECTIVE).run(context);
    await flush();
    asked.at(-1)?.items[0]?.run();
    await flush();
    const list = shownList();
    expect(list.key).toBe(perspectiveKey("Drafts"));
    expect(listHeading(list)).toBe("Drafts");
    expect(list.steps).toEqual([
      {
        label: "perspective: Drafts",
        heading: "Drafts",
        selection: { where: { status: ["draft"] }, filter: "Sensors" },
        perspective: true,
      },
    ]);
    expect(list.selection).toEqual({ where: { status: ["draft"] }, filter: "Sensors" });
    expect(list.group).toBe("type");
    expect(listSort(list)).toEqual([{ by: "title", order: "asc" }]);
    // The plain list stays as it is, behind it.
    expect(buffers().map((buffer) => buffer.key)).toEqual([perspectiveKey("Drafts"), LIST_KEY]);
    // The opening asks core with the perspective, and is recorded for the order of the prompt.
    expect(call).toHaveBeenCalledWith("element.list", {
      perspective: "Drafts",
      limit: 1,
      fields: ["identifier"],
    });
    expect(opened).toEqual(["Drafts"]);
  });

  it("[SR-214/AK-kqd2] asks with no sort of its own: without a stored sort, the saved filter's or the workspace order holds", () => {
    const { sort: _sort, ...unsorted } = SAVED;
    const list = perspectiveBuffer({ name: "Drafts", saved: unsorted });
    expect(listSort(list)).toBeUndefined();
    expect(bufferName(list)).toBe("perspective: Drafts · grouped by type");
    expect(listSort(perspectiveBuffer({ name: "Drafts", saved: { ...unsorted, sort: [] } }))).toEqual([]);
  });

  it("[SR-214/AK-wngq] two perspectives are two buffers, and the same one in another case is one", async () => {
    const other = { name: "Approved", file: "perspectives/approved.yaml", where: { status: ["approved"] } };
    const { context, buffers } = start({ ...answers, "perspective.list": listed([DRAFTS, other]) });
    await openPerspective(context, "Drafts");
    await openPerspective(context, "Approved");
    await openPerspective(context, "approved");
    expect(buffers().map((buffer) => buffer.key)).toEqual([
      perspectiveKey("Approved"),
      perspectiveKey("Drafts"),
      LIST_KEY,
    ]);
    expect(perspectiveKey("approved")).toBe(perspectiveKey("APPROVED"));
  });

  it("[SR-214/AK-rgnq] opening it again shows the buffer as the perspective is saved", async () => {
    const { context, shownList, buffers } = start(answers);
    await openPerspective(context, "Drafts");
    const changed = withMatrix(
      withQuery(shownList(), {
        steps: [...shownList().steps, statusStep("draft")],
        sort: [],
        group: "status",
      }),
      true,
    );
    context.dispatch({ type: "open", buffer: { ...changed, cursor: 4 } });
    context.dispatch({ type: "open", buffer: listBuffer("All elements") });
    await openPerspective(context, "Drafts");
    expect(shownList()).toEqual(perspectiveBuffer({ name: "Drafts", saved: SAVED }));
    expect(shownList().matrix).toBeUndefined();
    expect(buffers()).toHaveLength(2);
  });

  it("[SR-213/AK-tj6p] a perspective core refuses is not opened, and core's message is said", async () => {
    const refused = start({
      ...answers,
      "element.list": () => ({
        ok: false,
        code: "input.invalid",
        message: 'perspective "Drafts" names the saved filter "Sensors", which does not exist',
      }),
    });
    await openPerspective(refused.context, "Drafts");
    expect(refused.echoed).toEqual([
      'perspective "Drafts" names the saved filter "Sensors", which does not exist',
    ]);
    expect(refused.buffers().map((buffer) => buffer.key)).toEqual([LIST_KEY]);
    expect(refused.opened).toEqual([]);
    // The list fails, or the perspective went between the two reads.
    const failed = start({ "element.list": checked() });
    await openPerspective(failed.context, "Drafts");
    expect(failed.echoed).toEqual(["perspective.list failed"]);
    const gone = start({ ...answers, "perspective.list": listed([]) });
    await openPerspective(gone.context, "Drafts");
    expect(gone.echoed).toEqual(["No perspective is named Drafts"]);
  });

  it("[SR-213/AK-zz87] a grouping that can no longer be chosen: the list without groups, and core's warning", async () => {
    const { context, shownList, echoed } = start({
      ...answers,
      "element.list": checked([
        { code: "perspective.group-unavailable", severity: "warning", message: "cannot group by type" },
      ]),
    });
    await openPerspective(context, "Drafts");
    expect(shownList().group).toBeUndefined();
    expect(shownList().perspective?.saved?.group).toBeUndefined();
    expect(shownList().perspective?.warning).toBeUndefined();
    expect(echoed).toEqual(["cannot group by type"]);
  });
});

describe("the list actions on a perspective buffer", () => {
  const opened = (): ListBuffer => perspectiveBuffer({ name: "Drafts", saved: SAVED });

  it("keep the buffer and its perspective; the matrix keeps the grouping without showing it", () => {
    const filtered = withQuery(opened(), { steps: [...opened().steps, typeStep("need")] });
    expect(filtered.key).toBe(perspectiveKey("Drafts"));
    expect(filtered.perspective).toEqual(opened().perspective);
    expect(listHeading(filtered)).toBe("Drafts · type: need");
    const matrix = withMatrix(filtered, true);
    expect(matrix.group).toBe("type");
    expect(listGroup(matrix)).toBeUndefined();
    expect(bufferName(matrix)).toBe("perspective: Drafts · type: need · sorted by title · matrix");
    expect(listGroup(withMatrix(withQuery(matrix, { sort: [] }), false))).toBe("type");
    // A plain list drops it, as before (SR-149).
    expect(withMatrix({ ...listBuffer("All elements"), group: "type" }, true).group).toBeUndefined();
  });

  it("Clear list filter and Clear all list filters stop at the selection of the perspective", () => {
    const filtered = withQuery(opened(), {
      steps: [...opened().steps, typeStep("need"), statusStep("draft")],
    });
    const { context, shownList } = start({}, [filtered]);
    expect(action("clear-filters").available(context)).toBe(true);
    action("clear-filters").run(context);
    expect(shownList().steps).toEqual(opened().steps);
    expect(action("clear-filters").available(context)).toBe(false);
    expect(action("clear-filter").available(context)).toBe(false);
    // The saved filter of the perspective is its one saved filter (SR-101).
    expect(action("filter-saved").available(context)).toBe(false);
    // In the matrix the grouping it keeps is not offered to ungroup.
    const matrix = start({}, [withMatrix(opened(), true)]);
    expect(action("ungroup").available(matrix.context)).toBe(false);
  });

  it("a perspective buffer that came back with nothing saved lists nothing and offers no list action until opened again", async () => {
    const faulty = perspectiveBuffer({ name: "Broken", error: "The perspective is in a faulty file" });
    expect(listing(faulty)).toBe(false);
    expect(listing(opened())).toBe(true);
    expect(listHeading(faulty)).toBe("Broken");
    const { context, shownList } = start(
      {
        "perspective.list": listed([
          { name: "Broken", file: "perspectives/broken.yaml", where: { all: [] } },
        ]),
        "element.list": checked(),
      },
      [faulty],
    );
    // Neither the matrix, a filter, a sort nor a grouping: they would act on every element.
    for (const id of ["matrix", "filter-type", "filter-text", "sort", "group", "clear-filters"]) {
      expect(action(id).available(context)).toBe(false);
    }
    // Opening it again replaces it with the perspective as saved.
    await openPerspective(context, "Broken");
    expect(shownList().perspective?.error).toBeUndefined();
    expect(shownList().key).toBe(faulty.key);
    expect(action("matrix").available(context)).toBe(true);
  });
});
