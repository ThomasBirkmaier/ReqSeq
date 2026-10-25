// element.resolve (SR-060): a reference from another tool, a UUID or short ID with an optional version,
// resolved to the element as element.get shows it (title, text, status, current version; AK1), and
// whether the given version is still the current one (AK2). The same lookup as element.get
// (`getElement`, `resolveRef`): an unknown or ambiguous reference is `ref.unknown` or `ref.ambiguous`
// (AK3), and an input that picks one copy of a duplicate (#255) reaches both commands the same way.
// The input `versionDate` dates the current version as element.get does (D-013, ADR-0005).
// The current version is the one of the element's file as it is now, computed for this one element
// (ADR-0005), not from a build of every element's version (ADR-0008, `currentVersions`).
//
// A short ID whose prefix fits no element stays `ref.unknown`, even when its tail fits an element of
// another type: it may also be a reference to an element that is gone or in a missing repository,
// so it is never retargeted. When the tail fits exactly one element, that element is named as the
// candidate (prefix changed since, #275).
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { ElementCopy } from "../../model/index.js";
import { getElement, shortIdState } from "../../model/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { supersededValidityFindingsOf } from "../../variants/index.js";
import { NORMAL_FORM } from "../../version/version.js";

/**
 * `error` with the one element whose UUID ends with the tail of `ref` as candidate, if there is one
 * and `ref` itself names no element on the short IDs as they are now. `getElement` also gives
 * `ref.unknown` when the file changed on disk since the store read it (it reads the files again):
 * then `find` on the fresh short IDs finds the element, or the tail fits none, and the error stays
 * as it is. When `find` gives unknown, a single element with the tail has another prefix than `ref`
 * (with the same prefix `find` would have found it). With `copy` (#255), only an element in its
 * repository and/or file is named.
 */
const withOutdatedPrefix = async (
  workspace: Workspace,
  ref: string,
  copy: ElementCopy,
  error: CommandError,
): Promise<CommandError> => {
  const shortIds = await workspace.get(shortIdState);
  const [only, ...others] = shortIds
    .withTail(ref)
    .filter(
      (e) =>
        (copy.repository === undefined || e.repository === copy.repository) &&
        (copy.file === undefined || e.file === copy.file),
    );
  if (only === undefined || others.length > 0 || shortIds.find(ref).kind !== "unknown") {
    return error;
  }
  const meant = shortIds.of(only);
  return new CommandError("ref.unknown", `${error.message}; prefix may be outdated; did you mean ${meant}?`, {
    ...error.details,
    candidates: [{ id: only.id, repository: only.repository, file: only.file }],
  });
};

export default defineCommand({
  name: "element.resolve",
  run: async (ctx, input): Promise<CommandOutput<"element.resolve">> => {
    const { version } = input;
    // Only versions of the normal form this tool computes can be compared (ADR-0005).
    if (version !== undefined && !version.startsWith(`${NORMAL_FORM}:`)) {
      throw new CommandError(
        "input.invalid",
        `version ${version} has a normal form this tool does not know; it computes ${NORMAL_FORM}`,
        { command: "element.resolve", fields: ["version"] },
      );
    }
    const copy = { repository: input.repository, file: input.file };
    try {
      const element = await getElement(
        ctx.workspace,
        input.ref,
        supersededValidityFindingsOf,
        input.versionDate,
        copy,
      );
      return { element, current: version === undefined ? null : version === element.version };
    } catch (error) {
      if (error instanceof CommandError && error.code === "ref.unknown") {
        throw await withOutdatedPrefix(ctx.workspace, input.ref, copy, error);
      }
      throw error;
    }
  },
});
