// Versions computed while the element store is read (#439, ADR-0008 "Cold start"): the thread that
// parses a file already holds its text, so it computes the element's version there (ADR-0005), in
// the read workers of a cold load as in this thread, and for ReqSeq's own writes. The store keeps
// them next to its records (`loadedVersionOf`); `current-versions.ts` takes them while the file's
// `lstat` matches the store's snapshot.
//
// - Only for an element whose text links no image (`imageLinks` without ignore globs, a lexical
//   test, so the result does not depend on the `ignore` of the layout): the images are checked on
//   use (ADR-0008), so an element with images keeps the lazy path of `current-versions.ts`.
// - Any error while computing (a value without a normal form, `.inf`, `.nan`, or a bug) gives no
//   loaded version: the read never fails because of it, and the lazy path reports it as today.
// - Each version names the fingerprint of the definitions it was computed with (`versionDefinitions`
//   of its type: SHA-256 of their JSON), so a user can tell whether it still holds for the
//   metamodel of the workspace now. A store keeps the `Versioning` it was read with for its later
//   reads (watcher batches, writes); a changed metamodel does not reset the store.
// - A loaded version holds one value per normal form, by its prefix (`n1` today, D-027), so that a
//   later form can be added or computed lazily next to it.
import type {
  VersionFile,
  VersionInput,
  VersionPropertyDefinition,
  VersionValue,
} from "../version/version.js";
import { computeVersion, NORMAL_FORM, sha256Hex } from "../version/version.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";
import { imageLinks } from "./images.js";

/** The definitions of the properties an element's type has (`versionDefinitions`) and their fingerprint. */
export interface TypeVersioning {
  readonly definitions: readonly VersionPropertyDefinition[];
  /** SHA-256 (hex) of the JSON of `definitions`. */
  readonly fingerprint: string;
}

/** What computing versions while reading needs: plain data, so it goes to a worker thread as it is. */
export interface Versioning {
  /** By element type of the metamodel. */
  readonly byType: ReadonlyMap<string, TypeVersioning>;
  /** For a type the metamodel does not have (no definitions). */
  readonly unknown: TypeVersioning;
}

/** The version of an element as read, per normal form, and the fingerprint of the definitions it used. */
export interface LoadedVersion {
  /** By normal form prefix (`n1`): the version (`n1:<16 hex>`). */
  readonly byForm: Readonly<Record<string, string>>;
  /** `TypeVersioning.fingerprint` of the element's type when it was computed. */
  readonly fingerprint: string;
}

/** The definitions of the properties the element's type has, in metamodel order; none for an unknown type. */
export const versionDefinitions = (
  record: Pick<ElementRecord, "type">,
  metamodel: Metamodel,
): VersionPropertyDefinition[] => {
  const keys = new Set(findType(metamodel, record.type)?.properties ?? []);
  return metamodel.properties
    .filter((p) => keys.has(p.key))
    .map((p) => ({ key: p.key, kind: p.kind, ...(p.content === undefined ? {} : { content: p.content }) }));
};

/**
 * What the version of an element is computed from (ADR-0005): its text, its values, the definitions
 * of its type (`versionDefinitions`) and the images its text embeds. The one input both the lazy
 * path (`elementVersion`, `view.ts`) and the versions as read (`loadedVersion`) build.
 */
export const versionInputOf = (
  record: Pick<ElementRecord, "data">,
  body: string,
  definitions: readonly VersionPropertyDefinition[],
  images: readonly VersionFile[],
): VersionInput => ({
  text: body,
  properties: record.data as Readonly<Record<string, VersionValue>>,
  definitions,
  files: images,
});

const typeVersioning = (definitions: readonly VersionPropertyDefinition[]): TypeVersioning => ({
  definitions,
  fingerprint: sha256Hex(JSON.stringify(definitions)),
});

/** The `Versioning` of `metamodel`; undefined for one that is not valid, which loads no versions. */
export const versioningOf = (metamodel: Metamodel | undefined): Versioning | undefined =>
  metamodel?.valid === true
    ? {
        byType: new Map(
          metamodel.effectiveTypes.map((t) => [
            t.key,
            typeVersioning(versionDefinitions({ type: t.key }, metamodel)),
          ]),
        ),
        unknown: typeVersioning([]),
      }
    : undefined;

/** The `TypeVersioning` of `type` in `versioning`. */
export const typeVersioningOf = (versioning: Versioning, type: string): TypeVersioning =>
  versioning.byType.get(type) ?? versioning.unknown;

/**
 * The version of `element` from `body`, the text after its frontmatter, by `versioning`; undefined
 * for an element whose text links an image, and when computing fails (see the file comment).
 */
export const loadedVersion = (
  element: ElementRecord,
  body: string,
  versioning: Versioning,
): LoadedVersion | undefined => {
  try {
    if (imageLinks(element.file, body).length > 0) {
      return undefined;
    }
    const typed = typeVersioningOf(versioning, element.type);
    const version = computeVersion(versionInputOf(element, body, typed.definitions, []));
    return { byForm: { [NORMAL_FORM]: version }, fingerprint: typed.fingerprint };
  } catch {
    return undefined;
  }
};

/** The fingerprints of each `Versioning`, by their text, built once. */
const fingerprints = new WeakMap<Versioning, ReadonlyMap<string, string>>();

/**
 * `version` with its fingerprint as the one string `versioning` holds (a structured clone from a
 * worker copies every string, about 4 MB at N-036); unchanged when `versioning` has no such fingerprint.
 */
export const internedVersion = (version: LoadedVersion, versioning: Versioning): LoadedVersion => {
  let known = fingerprints.get(versioning);
  if (known === undefined) {
    known = new Map(
      [...versioning.byType.values(), versioning.unknown].map((t) => [t.fingerprint, t.fingerprint]),
    );
    fingerprints.set(versioning, known);
  }
  const fingerprint = known.get(version.fingerprint);
  return fingerprint === undefined ? version : { ...version, fingerprint };
};
