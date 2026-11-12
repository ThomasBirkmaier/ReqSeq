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
//
// A reference to an acceptance criterion as a test name writes it (SR-205 AK5), `[SR-036/AK-k7f3]` or
// `SR-036/AK-k7f3`, is split at the first `/` as enrich-junit splits it (`criterionReferenceOf`): the
// part before resolves as above (with the outdated-prefix candidate), and `criterion` gives the
// criterion of the current version with that key, with number, text and reference; the element
// carries all of them (`criterionReferences`, AK1). A key no criterion carries is `ref.unknown`, a
// key two carry `ref.ambiguous` (SR-204 AK10). A number suffix (`AK2`) is refused: test names name
// criteria by key (SR-029 AK13), and a number would point at another criterion after a move. A text
// that itself names one element, such as the identifier `ECU/AK2`, stays that element's reference.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { BracketReference, CriterionReferences, ElementCopy } from "../../model/index.js";
import {
  criterionReferenceOf,
  elementStoreState,
  getElement,
  resolveRef,
  shortIdState,
  UNKNOWN_TYPE_PREFIX,
} from "../../model/index.js";
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

/**
 * The criterion `ref` (a criterion reference with a key, `reference.criterion`) names among
 * `references`, the criteria of the element it resolved to (see the file comment).
 */
const criterionOf = (
  given: string,
  reference: BracketReference & { readonly criterion: string },
  references: CriterionReferences | undefined,
  element: { readonly id: string; readonly repository: string; readonly file: string },
): NonNullable<CommandOutput<"element.resolve">["criterion"]> => {
  const key = reference.criterion;
  const found = references?.criteria.filter((c) => c.key === key) ?? [];
  const [only, ...others] = found;
  if (only === undefined) {
    throw new CommandError(
      "ref.unknown",
      `${reference.ref} has no acceptance criterion with the criterion key ${key} in its current version`,
      { ref: given, criterion: key },
    );
  }
  if (others.length > 0) {
    throw new CommandError(
      "ref.ambiguous",
      `${reference.ref} has ${String(found.length)} acceptance criteria with the criterion key ${key} (${found.map((c) => `AK${String(c.criterion)}`).join(", ")}); give each its own key (SR-204)`,
      {
        ref: given,
        criterion: key,
        criteria: found.map((c) => c.criterion),
        candidates: [{ id: element.id, repository: element.repository, file: element.file }],
      },
    );
  }
  return only;
};

/**
 * The reference to an element and the key of the criterion `ref` names, read as a criterion
 * reference (`reference`, from `criterionReferenceOf`); `input.invalid` for one that names a
 * criterion by number or in another form (see the file comment).
 */
const criterionReferenceIn = (
  ref: string,
  reference: BracketReference,
): BracketReference & { readonly criterion?: string } => {
  if (reference.malformed !== undefined) {
    throw new CommandError(
      "input.invalid",
      `${ref} names no acceptance criterion: write AK- and its criterion key, such as [SR-036/AK-k7f3]`,
      { command: "element.resolve", fields: ["ref"], reason: "criterion-malformed" },
    );
  }
  if (typeof reference.criterion === "number") {
    throw new CommandError(
      "input.invalid",
      `${ref} names an acceptance criterion by number, which points at another criterion once criteria move; name it by its criterion key, such as [${reference.ref}/AK-k7f3], as element.get gives it`,
      { command: "element.resolve", fields: ["ref"], reason: "criterion-by-number" },
    );
  }
  return {
    ref: reference.ref,
    ...(reference.criterion === undefined ? {} : { criterion: reference.criterion }),
  };
};

/**
 * Whether `ref` itself names one element (an identifier such as `ECU/AK2`): then it is that element's
 * reference, also where it reads as a reference to a criterion.
 */
const namesOneElement = async (workspace: Workspace, ref: string, copy: ElementCopy): Promise<boolean> => {
  const [store, shortIds] = await Promise.all([
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  try {
    resolveRef(store, shortIds, ref, copy);
    return true;
  } catch {
    return false;
  }
};

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
    const read = criterionReferenceOf(input.ref);
    const reference =
      read === undefined || (await namesOneElement(ctx.workspace, input.ref, copy))
        ? undefined
        : criterionReferenceIn(input.ref, read);
    const ref = reference?.ref ?? input.ref;
    let shown;
    try {
      shown = await getElement(ctx.workspace, ref, elementHints, input.versionDate, copy);
    } catch (error) {
      if (error instanceof CommandError && error.code === "ref.unknown") {
        throw await withOutdatedPrefix(ctx.workspace, ref, copy, error);
      }
      throw error;
    }
    // With its verification and validation status, the variants that replace or exclude it, and
    // `names` and `incomplete`, as element.get shows it (SR-031, SR-034, SR-038, SR-046 AK3, #456).
    const { element, ...rest } = await shownWithNames(ctx.workspace, shown);
    const key = reference?.criterion;
    const criterion =
      key === undefined
        ? undefined
        : criterionOf(input.ref, { ...reference, ref, criterion: key }, rest.criterionReferences, element);
    return {
      element,
      ...(criterion === undefined ? {} : { criterion }),
      current: currentOf(version, shown.forms),
      ...rest,
    };
  },
});
