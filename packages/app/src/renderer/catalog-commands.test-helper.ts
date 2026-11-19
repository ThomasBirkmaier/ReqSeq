// The context, the catalog and the helpers the tests of the catalog commands share (`catalog-commands.test.ts` and
// the tests of each topic, `catalog-commands-*.test.ts`).
import { getCommandRuntime } from "@reqseq/core";
import { cliUsage } from "../core/cli-usage.js";
import { vi } from "vitest";
import type { Mock } from "vitest";
import { listedEntry } from "../core/listing.js";
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext, Choice, Prompt } from "./action-types.js";
import { ACTIONS } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import type { Call } from "./call.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { isWindows } from "./keys.js";
import { catalogItems } from "./catalog-commands.js";

export const PLATFORM_SEP = isWindows(navigator.platform) ? "\\" : "/";

const runtime = getCommandRuntime();
/** The catalog as the bridge lists it (`commands()`), with what this version implements. */
export const CATALOG: readonly CommandListing[] = runtime.contracts.commands.map((entry) => ({
  ...listedEntry(entry, runtime.contracts.schemas),
  implemented: runtime.commands.has(entry.name),
  cliUsage: cliUsage(entry, runtime.contracts.schemas),
}));

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export type Answer = unknown;

/** A preview of `element.bulkUpdate` that writes no element, as its output schema has it. */
export const BULK_PREVIEW = {
  applied: false,
  count: 0,
  affected: [],
  unchanged: 0,
  skipped: [],
  files: [],
  problems: [],
  plan: `p1:${"0".repeat(64)}`,
};

/** What `setup` gives: the context, and what the commands did with it. */
export interface Setup {
  readonly context: CatalogContext;
  readonly asked: Prompt[];
  readonly echoed: string[];
  /** The messages `report` said (also in `echoed`), with what a click on each opens (SR-223 AK8). */
  readonly reported: { readonly message: string; readonly open: () => void }[];
  readonly dispatched: BufferAction[];
  readonly call: Mock<(name: string, input: Record<string, unknown>) => Promise<unknown>>;
  readonly reopened: () => number;
  readonly changed: () => void;
}

/** A context over `buffers` whose commands answer with `answers[name](input)`; an Error is a failure. */
export const setup = (
  buffers: Buffers,
  answers: Record<string, (input: Record<string, unknown>) => Answer> = {},
): Setup => {
  const asked: Prompt[] = [];
  const echoed: string[] = [];
  const reported: { readonly message: string; readonly open: () => void }[] = [];
  const dispatched: BufferAction[] = [];
  let reopened = 0;
  let revision = 3;
  const call = vi.fn((name: string, input: Record<string, unknown>) => {
    // A bulk update answers with a preview unless the test gives its own (SR-071 AK5 reads its counts).
    const output = (answers[name] ?? (name === "element.bulkUpdate" ? () => BULK_PREVIEW : undefined))?.(
      input,
    );
    return Promise.resolve(
      output instanceof Error
        ? {
            ok: false,
            code: output.name,
            message: output.message,
            ...("details" in output ? { details: output.details } : {}),
          }
        : { ok: true, output },
    );
  });
  const context: CatalogContext = {
    workspace: true,
    buffers,
    mac: false,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: call as unknown as Call,
    dispatch: (action) => dispatched.push(action),
    ask: (prompt) => asked.push(prompt),
    echo: (message) => echoed.push(message),
    report: (message, open) => {
      echoed.push(message);
      reported.push({ message, open });
    },
    modified: false,
    closeArmed: () => false,
    armClose: () => undefined,
    discard: () => undefined,
    drafted: () => false,
    cycleOrder: [],
    cycled: () => undefined,
    leaveEditor: () => undefined,
    revision: () => revision,
    reopen: () => {
      reopened += 1;
    },
  };
  return {
    context,
    asked,
    echoed,
    reported,
    dispatched,
    call,
    reopened: () => reopened,
    changed: () => {
      revision += 1;
    },
  };
};

export const command = (name: string): CommandListing => {
  const found = CATALOG.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no command ${name}`);
  }
  return found;
};

export const item = (items: readonly Choice[], name: string): Choice => {
  const found = items.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no item ${name} in ${items.map((candidate) => candidate.name).join(", ")}`);
  }
  return found;
};

/** The last prompt asked, filled with the parts that came later (`fill`), as the minibuffer shows it. */
export const last = async (asked: readonly Prompt[]): Promise<Prompt> => {
  await flush();
  const prompt = asked.at(-1);
  if (prompt === undefined) {
    throw new Error("nothing asked");
  }
  return prompt.fill === undefined ? prompt : { ...prompt, ...(await prompt.fill) };
};

/** A refusal of core with `details`, as the bridge gives it (`input.invalid`). */
export const refusedWith = (message: string, details: Record<string, unknown>): Error =>
  Object.assign(new Error(message), { name: "input.invalid", details });

/**
 * A read command that asks an element and then, optional, a relation kind that element may have: the
 * arguments of `relation.options`, which the prompt neither lists nor finds (SR-133 AK4), under a name of
 * its own, so the tests of the argument entry keep their command.
 */
export const KINDS: CommandListing = {
  ...command("relation.options"),
  name: "test.kinds",
  title: "Show kinds",
};

/** The catalog with `KINDS`. */
export const WITH_KINDS: readonly CommandListing[] = [...CATALOG, KINDS];

export const start = (context: ActionContext & CatalogContext, name: string, more = false): void => {
  const listing = name === KINDS.name ? KINDS : command(name);
  const choice = item(catalogItems(context, WITH_KINDS, ACTIONS), listing.title);
  (more ? choice.more : choice.run)?.();
};

export const OPTIONS = {
  kinds: [
    { kind: "derives-from", name: "derives from", targetTypes: ["need"] },
    { kind: "refines", name: "refines", targetTypes: ["need"] },
  ],
};

/** A search hit of a need, numbered `n`. */
export const hit = (
  n: number,
): {
  id: string;
  shortId: string;
  type: string;
  title: string;
  repository: string;
  file: string;
  terms: string[];
  fields: string[];
} => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-00000${String(n)}`,
  type: "need",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  terms: ["tit"],
  fields: ["title"],
});

/** What `hint.list` gives for the shown element: one hint that can be confirmed, one that cannot. */
export const HINTS = {
  hints: [
    { code: "relation.outdated", severity: "warning", message: "Relation Refines is outdated", hintId: "h1" },
    { code: "element.missing-required", severity: "warning", message: "Required property x has no value" },
  ],
  incomplete: false,
};
