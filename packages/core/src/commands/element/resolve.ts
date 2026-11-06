// element.resolve (SR-060): a reference from another tool, a UUID or short ID with an optional version,
// resolved to the element as element.get shows it (title, text, status, current version; AK1), and
// whether the given version is still the current one (AK2). The same lookup as element.get
// (`getElement`, `resolveRef`): an unknown or ambiguous reference is `ref.unknown` or `ref.ambiguous`
// (AK3), and an input that picks one copy of a duplicate (ThomasBirkmaier/ReqSeq-archive#255) reaches both commands the same way.
// The input `versionDate` dates the current version as element.get does (D-013, ADR-0005). `names`
// and `incomplete` are those of element.get (`shownWithNames`, #456).
// The current version is the one of the element's file as it is now, computed for this one element
// (ADR-0005), not from a build of every element's version (ADR-0008, `currentVersions`). An element
// without one (a value that counts has no normal form) is shown as element.get shows it, without
// `version`, and a given version is neither "current" nor "outdated": `current` is "unknown" (ThomasBirkmaier/ReqSeq-archive#276).
//
// A short ID whose prefix fits no element stays `ref.unknown`, even when its tail fits an element of
// another type: it may also be a reference to an element that is gone or in a missing repository,
// so it is never retargeted. When the tail fits exactly one element, that element is named as the
// candidate (prefix changed since, ThomasBirkmaier/ReqSeq-archive#275).
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { ElementCopy } from "../../model/index.js";
import { getElement, shortIdState, UNKNOWN_TYPE_PREFIX } from "../../model/index.js";
import { shownWithNames } from "../../data/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { elementHints } from "../../hints/index.js";
import type { VersionForms } from "../../version/version.js";
import { formOf, sameVersion } from "../../version/version.js";

/**
 * `error` with the one element whose UUID ends with the tail of `ref` as candidate, if there is one
 * and `ref` itself names no element on the short IDs as they are now. `getElement` also gives
 * `ref.unknown` when the file changed on disk since the store read it (it reads the files again):
 * then `find` on the fresh short IDs finds the element, or the tail fits none, and the error stays
 * as it is. When `find` gives unknown, a single element with the tail has another prefix than `ref`
 * (with the same prefix `find` would have found it). With `copy` (ThomasBirkmaier/ReqSeq-archive#255), only an element in its
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
  // A type left out with a faulty metamodel file is no outdated prefix (#853 review): the message
  // already names the metamodel.
  if (!shortIds.metamodelValid && meant.startsWith(`${UNKNOWN_TYPE_PREFIX}-`)) {
    return error;
  }
  return new CommandError("ref.unknown", `${error.message}; prefix may be outdated; did you mean ${meant}?`, {
    ...error.details,
    candidates: [{ id: only.id, repository: only.repository, file: only.file }],
  });
};

/**
 * Whether `given` is the current version `computed` (AK2), compared in the form of `given`
 * (`sameVersion`, ADR-0005 "Normal form 2"): `"current"` or `"outdated"`; `"unknown"` when the
 * element has no version to compare with (a value that counts has no normal form; element.get
 * leaves `version` out and says why, ThomasBirkmaier/ReqSeq-archive#276); null when no version was given. Strings, not booleans,
 * so a caller that tests `current` for truth never takes `"unknown"` for current.
 */
const currentOf = (
  given: string | undefined,
  computed: VersionForms | undefined,
): CommandOutput<"element.resolve">["current"] =>
  given === undefined
    ? null
    : computed === undefined
      ? "unknown"
      : sameVersion(given, computed)
        ? "current"
        : "outdated";

export default defineCommand({
  name: "element.resolve",
  run: async (ctx, input): Promise<CommandOutput<"element.resolve">> => {
    const { version } = input;
    // Only versions of the normal forms this tool computes can be compared (ADR-0005).
    if (version !== undefined && formOf(version) === undefined) {
      throw new CommandError(
        "input.invalid",
        `version ${version} has a normal form this tool does not know; it computes n1 and n2`,
        { command: "element.resolve", fields: ["version"] },
      );
    }
    const copy = { repository: input.repository, file: input.file };
    try {
      const shown = await getElement(ctx.workspace, input.ref, elementHints, input.versionDate, copy);
      // With its verification and validation status, the variants that replace or exclude it, and
      // `names` and `incomplete`, as element.get shows it (SR-031, SR-034, SR-038, SR-046 AK3, #456).
      const { element, ...rest } = await shownWithNames(ctx.workspace, shown);
      return { element, current: currentOf(version, shown.forms), ...rest };
    } catch (error) {
      if (error instanceof CommandError && error.code === "ref.unknown") {
        throw await withOutdatedPrefix(ctx.workspace, input.ref, copy, error);
      }
      throw error;
    }
  },
});
