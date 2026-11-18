// The helpers of the tests of the renderer's components: a React root in a happy-dom container per test,
// a fake call, and the keys, typing and clicks of a user. Test code only.
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import type { Call } from "./call.js";
import { NO_SUMMARY } from "./package-summary-test-data.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export let container: HTMLElement;
export let root: Root;

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
});

export const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

export const render = async (node: React.ReactElement): Promise<void> => {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  await flush();
};

/** The answer of `trace.neighbourhood` for an element without parents, children and incoming links. */
export const alone = (input: Record<string, unknown>): unknown => ({
  root: input["ref"],
  nodes: [{ id: input["ref"], repository: "spec", depth: 0, expanded: true }],
  total: 1,
  edges: [],
  incomplete: false,
});

/** What `fakeCall` answers: the output of a command, or its error. */
export interface FakeAnswer {
  ok: boolean;
  code?: string;
  message?: string;
  output?: unknown;
}

/**
 * A call that answers each command with `handlers[name](input)`; an Error is the error of the command.
 * Unless a handler says otherwise, an element has no neighbourhood (the parents line asks on every page).
 */
export const fakeCall = (
  handlers: Record<string, (input: Record<string, unknown>) => unknown>,
): ReturnType<typeof vi.fn<(name: string, input: Record<string, unknown>) => Promise<FakeAnswer>>> =>
  vi.fn((name: string, input: Record<string, unknown>) => {
    const output = (handlers[name] ?? (name === "trace.neighbourhood" ? alone : NO_SUMMARY[name]))?.(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "code" in output ? String(output.code) : "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
/**
 * A list asks for the verification of its rows after them (SR-137, `withVerification`); `unrecorded` answers
 * that with nothing to show and without passing it on, so a test counts the pages a list asks for. The tests
 * of SR-137 answer it themselves.
 */
export const unrecorded =
  (call: (name: string, input: Record<string, unknown>) => unknown) =>
  (name: string, input: Record<string, unknown>): unknown =>
    input["withVerification"] === true ? Promise.resolve({ ok: true, output: {} }) : call(name, input);
export const asCall = (call: ReturnType<typeof fakeCall>): Call => unrecorded(call) as unknown as Call;
/**
 * `call` for `element.list` only, so a test counts its pages; the line of coverage under the heading of a
 * list (SR-148) gets the fake bridge's empty answer.
 */
export const withSummary = (call: (name: string, input: never) => Promise<unknown>): Call =>
  unrecorded((name: string, input: Record<string, unknown>) =>
    name === "element.list"
      ? call(name, input as never)
      : Promise.resolve({ ok: true, output: NO_SUMMARY[name]?.() }),
  ) as unknown as Call;

export const query = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

export const queryInput = (): HTMLInputElement => {
  const found = container.querySelector("input");
  if (found === null) {
    throw new Error("There is no input");
  }
  return found;
};

export const press = async (target: Element, key: string, init: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    await Promise.resolve();
  });
  await flush();
};

export const type = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    // React tracks the value; only the prototype's setter lets it see the change.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setValue = Reflect.get(descriptor ?? {}, "set") as (this: HTMLInputElement, value: string) => void;
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

export const click = async (target: Element): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await flush();
};

export const texts = (selector: string): string[] =>
  [...container.querySelectorAll(selector)].map((element) => element.textContent);

/** A row of `element.list`. */
export interface Row {
  id: string;
  shortId: string;
  type: string;
  status: string;
  title: string;
  repository: string;
  file: string;
  properties: Record<string, never>;
  relations: never[];
}

export const row = (n: number, extra: object = {}): Row => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-${String(n).padStart(6, "0")}`,
  type: "system-requirement",
  status: "draft",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  properties: {},
  relations: [],
  ...extra,
});

export const rowsOf = (from: number, to: number): Row[] =>
  Array.from({ length: to - from }, (_, at) => row(from + at));

/** A new root in the same container, for a test that unmounted the one it had. */
export const renewRoot = (): void => {
  root = createRoot(container);
};
