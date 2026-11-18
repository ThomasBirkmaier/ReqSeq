// The context and the buffers the tests of the app's actions share (`actions.test.ts` and the tests of each
// group of actions).
import { vi } from "vitest";
import type { Mock } from "vitest";
import { ACTIONS, commandPrompt } from "./actions.js";
import type { Action, ActionContext, Prompt } from "./action-types.js";
import type { BufferAction, Buffers } from "./buffers.js";
import {
  elementBuffer,
  listBuffer,
  graphBuffer,
  metamodelBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  withMatrix,
} from "./buffers.js";
import type { Call } from "./call.js";
import type { Theme } from "./theme.js";
import type { Scheme } from "../shared/theme.js";

/** A theme over a flag: `system` is dark, `choice` is what a command chose. */
export const fakeTheme = (system = false): Theme & { readonly choice: () => Scheme | undefined } => {
  let choice: Scheme | undefined;
  const shown = (): Scheme => choice ?? (system ? "dark" : "light");
  return {
    shown,
    chosen: () => choice !== undefined,
    toggle: () => {
      choice = shown() === "dark" ? "light" : "dark";
      return choice;
    },
    follow: () => {
      choice = undefined;
    },
    choice: () => choice,
  };
};

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** What `setup` gives: the context, and what the actions did with it. */
export interface Setup {
  readonly context: ActionContext;
  readonly dispatched: BufferAction[];
  readonly asked: Prompt[];
  readonly echoed: string[];
  readonly call: Mock<(name: string) => Promise<unknown>>;
  readonly armed: (string | undefined)[];
  readonly discarded: string[];
  readonly left: boolean[];
  readonly cycledTo: string[];
}

/** A context over `buffers`, with the commands answered by `answers` and what the actions did recorded. */
export const setup = (
  buffers: Buffers,
  answers: Record<string, unknown> = {},
  workspace = true,
  extra: Partial<ActionContext> = {},
): Setup => {
  const dispatched: BufferAction[] = [];
  const armed: (string | undefined)[] = [];
  const discarded: string[] = [];
  const asked: Prompt[] = [];
  const echoed: string[] = [];
  const cycledTo: string[] = [];
  const left: boolean[] = [];
  const call = vi.fn<(name: string) => Promise<unknown>>((name: string) => {
    const output = answers[name];
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
  const context: ActionContext = {
    workspace,
    buffers,
    mac: false,
    theme: fakeTheme(),
    call: call as unknown as Call,
    dispatch: (action) => dispatched.push(action),
    ask: (prompt) => asked.push(prompt),
    echo: (message) => echoed.push(message),
    modified: false,
    closeArmed: () => false,
    armClose: (value) => armed.push(value),
    discard: (key) => discarded.push(key),
    drafted: () => false,
    cycleOrder: buffers.map((buffer) => buffer.key),
    cycled: (key) => {
      cycledTo.push(key);
    },
    leaveEditor: () => {
      left.push(true);
    },
    ...extra,
  };
  return { context, dispatched, asked, echoed, call, armed, discarded, left, cycledTo };
};

export const action = (id: string): Action => {
  const found = ACTIONS.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no action ${id}`);
  }
  return found;
};

/** Runs "Filter list" and chooses `kind` in its first step (SR-124 AK5). */
export const filterBy = (context: ActionContext, asked: readonly Prompt[], kind: string): void => {
  action("filter").run(context);
  asked
    .at(-1)
    ?.items.find((item) => item.name === kind)
    ?.run();
};

export const list = listBuffer("All elements");
export const filtered = listBuffer("type: need", { where: { type: ["need"] } }, [
  { by: "title", order: "asc" },
]);
export const element = elementBuffer("u1", "spec", "SR-036 Title");

export const titles = (context: ActionContext): string[] =>
  commandPrompt(context).items.map((item) => item.name);

/** A context for every kind of buffer and state in which actions apply, to check what holds for all of them. */
export const everyContext = (): ActionContext[] => {
  const controls = {
    save: vi.fn(),
    edit: vi.fn(),
    editTitle: vi.fn(),
    follow: vi.fn(),
    copy: vi.fn(),
    addProperty: vi.fn(),
    clearProperty: vi.fn(),
    insertImage: vi.fn(),
    text: vi.fn(),
    listValue: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
    prompting: vi.fn(),
  };
  const page = { ...controls, members: true };
  return [
    setup([element], {}, true, { element: controls }).context,
    setup([element], {}, true, { element: page }).context,
    setup([element]).context,
    setup([list]).context,
    setup([filtered]).context,
    // The matrix (SR-125): the list in matrix mode (a package page above offers it too).
    setup([withMatrix(filtered, true)]).context,
    setup([overviewBuffer()]).context,
    setup([neighbourhoodBuffer("uuid", "spec", "X")]).context,
    // The graph (SR-111): Ctrl/Cmd+Shift+G back to the element.
    setup([graphBuffer("uuid", "spec", "X")]).context,
    // The metamodel (SR-130).
    setup([metamodelBuffer()]).context,
    setup([metamodelBuffer("text")]).context,
    setup([], {}, true).context,
    // Two buffers: Alt+N and Alt+P switch between them (SR-115 AK5).
    setup([element, list]).context,
    // A split window: Alt+O to the other area (SR-150 AK7).
    setup([element, list], {}, true, {
      layout: { other: list.key, split: vi.fn(), unsplit: vi.fn(), beside: vi.fn() },
    }).context,
    // Follow agent (SR-117): Ctrl/Cmd+Shift+O on and off, on every buffer.
    ...[false, true].flatMap((on) =>
      [[element], [list], [graphBuffer("uuid", "spec", "X")], [overviewBuffer()]].map(
        (buffers) =>
          setup(buffers, {}, true, {
            element: controls,
            follow: { on, start: vi.fn(), stop: vi.fn() },
          }).context,
      ),
    ),
  ];
};
