// For tests only: the input of `element.update` as a caller that read the element first sends it. A
// change of the text or the title needs the write precondition `expectedFileSha256` (SR-106, #269), so
// a test that writes text or title without one gets the `fileSha256` that `element.get` gives now.
import type { CommandOutput } from "../catalog.js";
import type { InvokeContext } from "./invoke.js";
import { invoke } from "./invoke.js";

interface UpdateFields {
  readonly ref?: unknown;
  readonly repository?: unknown;
  readonly text?: unknown;
  readonly title?: unknown;
  readonly expectedFileSha256?: unknown;
}

/** What `readFirst` gives: the input, with the hash when it changes text or title. */
export type ReadFirst<T> = T & { readonly expectedFileSha256?: string };

/** `input` with `expectedFileSha256` from `element.get` when it changes text or title without one. */
export const readFirst = async <T extends object>(
  input: T,
  context: InvokeContext,
): Promise<ReadFirst<T>> => {
  const { ref, repository, text, title, expectedFileSha256 } = input as UpdateFields;
  if ((text === undefined && title === undefined) || expectedFileSha256 !== undefined) {
    return input;
  }
  const shown = (await invoke(
    "element.get",
    { ref, repository },
    { workspace: context.workspace },
  )) as CommandOutput<"element.get">;
  return { ...input, expectedFileSha256: shown.fileSha256 };
};

/** The input of any command call: `readFirst` for `element.update`, else as it is. */
export const readFirstFor = <T extends object>(
  name: string,
  input: T,
  context: InvokeContext,
): Promise<ReadFirst<T>> => (name === "element.update" ? readFirst(input, context) : Promise.resolve(input));
