// Typed text in an argument of the command prompt (`catalog-commands.ts`): a reference to an acceptance
// criterion (`withTypedReference`), a folder below an offered value (`typedFill`), and a path completed from
// its folder (`pathFill`, SR-143 AK2).

import type { ActionContext, Choice, PromptFill } from "./action-types.js";
import { criterionReferenceOf } from "@reqseq/core/criterion-items";
import { isWindows } from "./keys.js";
import { pathSeeker } from "./path-completion.js";
import type { Value } from "./catalog-entry.js";

/**
 * `find` with the typed text itself first when it is a reference to an acceptance criterion as a test
 * name writes it (`[SR-036/AK-k7f3]`, `criterionReferenceOf` of core), which no search finds: "Resolve
 * reference" takes it so (SR-205 AK5), and core says what is wrong with it. `take` gives the text;
 * without it (a relation target, or an argument of another command than element.resolve) nothing is added.
 */
export const withTypedReference =
  (
    find: (query: string) => Promise<readonly Choice[]>,
    take: ((text: string, more: boolean) => void) | undefined,
  ) =>
  async (query: string): Promise<readonly Choice[]> => {
    const found = await find(query);
    const text = query.trim();
    if (take === undefined || criterionReferenceOf(text)?.criterion === undefined) {
      return found;
    }
    return [
      {
        id: `reference:${text}`,
        name: `Use ${text}`,
        run: () => {
          take(text, false);
        },
        more: () => {
          take(text, true);
        },
      },
      ...found,
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
