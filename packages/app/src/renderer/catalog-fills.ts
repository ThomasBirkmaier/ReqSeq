// Typed text in an argument of the command prompt (`catalog-commands.ts`): a reference to an acceptance
// criterion (`withTypedReference`, also named so in "Go to", `criterionEntry`), a folder below an offered value (`typedFill`), and a path completed from
// its folder (`pathFill`, SR-143 AK2).

import type { ActionContext, Choice, PromptFill } from "./action-types.js";
import type { ElementResolveOutput } from "@reqseq/core";
import { criterionLabel, criterionReferenceOf } from "@reqseq/core/criterion-items";
import { elementBufferOf } from "./buffers.js";
import type { ElementBuffer } from "./buffers.js";
import { isWindows } from "./keys.js";
import { pathSeeker } from "./path-completion.js";
import type { Value } from "./catalog-entry.js";

/**
 * The entry of a criterion reference `element.resolve` resolved (SR-205 AK5): the requirement's buffer, and
 * its name with the criterion's number and text (SR-222 AK4). None without a criterion.
 */
export const criterionEntry = (
  output: Pick<ElementResolveOutput, "element" | "criterion">,
): { readonly buffer: ElementBuffer; readonly name: string } | undefined => {
  const { element, criterion } = output;
  if (criterion === undefined) {
    return undefined;
  }
  const buffer = elementBufferOf(element);
  return { buffer, name: `${buffer.name} · ${criterionLabel(criterion)} · ${criterion.text}` };
};

/** The hits without the one of `buffer`: its requirement stands only as the criterion's entry (SR-222 AK4). */
export const withoutHitOf = (found: readonly Choice[], buffer: ElementBuffer): Choice[] =>
  found.filter((choice) => choice.id !== buffer.key);

/**
 * `find` with the typed text itself first when it is a reference to an acceptance criterion as a test
 * name writes it (`[SR-036/AK-k7f3]`, `criterionReferenceOf` of core): "Resolve reference" takes it so
 * (SR-205 AK5). When `element.resolve` resolves it, the entry names the requirement with the criterion's
 * number and text, and the requirement's search hit is left out (SR-222 AK4); else it is "Use <text>",
 * and core says what is wrong with it when it runs. `take` gives the text; without it (a relation target,
 * or an argument of another command than element.resolve, which take no reference) nothing is added.
 */
export const withTypedReference =
  (
    context: Pick<ActionContext, "call">,
    find: (query: string) => Promise<readonly Choice[]>,
    take: ((text: string, more: boolean) => void) | undefined,
  ) =>
  async (query: string): Promise<readonly Choice[]> => {
    const text = query.trim();
    if (take === undefined || criterionReferenceOf(text)?.criterion === undefined) {
      return find(query);
    }
    const [found, answer] = await Promise.all([find(query), context.call("element.resolve", { ref: text })]);
    const entry = answer.ok ? criterionEntry(answer.output) : undefined;
    return [
      {
        id: `reference:${text}`,
        name: entry?.name ?? `Use ${text}`,
        run: () => {
          take(text, false);
        },
        more: () => {
          take(text, true);
        },
      },
      ...(entry === undefined ? found : withoutHitOf(found, entry.buffer)),
    ];
  };

/**
 * Typed text besides the hits of a list (an evidence location): Enter with no hit takes it, and a text that
 * names a folder below one of the values ("evidence/manual/2026") is first as "Use <text>", so Enter takes it
 * and not the value it starts with.
 */
export const typedFill = (
  values: readonly Value[],
  take: (text: string, more: boolean) => void,
): PromptFill => ({
  literal: (text) =>
    values.some(({ value }) => typeof value === "string" && value !== "." && text.startsWith(`${value}/`))
      ? {
          id: `use:${text}`,
          name: `Use ${text}`,
          run: () => {
            take(text, false);
          },
          more: () => {
            take(text, true);
          },
        }
      : undefined,
  text: (text) => {
    take(text, false);
  },
  more: (text) => {
    take(text, true);
  },
});

/** `text` below the folder `base`: joined with `/`, which core takes on every platform. */
const below = (base: string, text: string): string =>
  base === "" ? text : `${base.replace(/[\\/]+$/u, "")}/${text}`;

/**
 * The parts of a path argument (SR-143 AK2): the typed text itself first, "Use <path>", so Enter takes a
 * path that names nothing yet (a new export file, AK4), then the entries of its folder, which complete
 * it; relative from the workspace root, `~` for the home folder (core's rule of the app, as the command
 * then resolves it). With `base`, the text is relative to that folder (a metamodel path below a new
 * workspace's folder) and listed there.
 */
export const pathFill = (
  context: ActionContext,
  files: boolean,
  take: (text: string, more: boolean) => void,
  base?: string,
): PromptFill => ({
  literal: (text) =>
    text.trim() === ""
      ? undefined
      : {
          id: `use:${text}`,
          name: `Use ${text}`,
          hint: files ? "file" : "folder",
          run: () => {
            take(text, false);
          },
          more: () => {
            take(text, true);
          },
        },
  seek: pathSeeker({
    windows: isWindows(navigator.platform),
    list: async (path) => {
      const answer = await context.call("workspace.listFolder", {
        path: base === undefined ? path : below(base, path),
        files,
      });
      return answer.ok ? answer.output : { failed: answer.message };
    },
  }),
  text: (text) => {
    take(text, false);
  },
  more: (text) => {
    take(text, true);
  },
});
