// Generator of small abstract workspaces for the status model (#1395): two repositories (each variant-independent or
// not), up to three variants (some with an invalid status, with exclusions), and up to seven elements from a small
// UUID pool, so twins (two files of one UUID in one repository) occur, with validities, derivation and replacement
// items that name the repository or not, cycles, emergent and invalid elements, needs, and records for the core or a
// variant. Each element's own part comes from `statusModelElement` (#1394). Only verification records name a variant:
// a validation record with a variant is refused by the reader (SR-038 AK4), which is level 2 (#1396). Pure, so a seed
// replays a case and shrinking works.
import fc from "fast-check";
import { renderDate, statusModelElement } from "./generator.js";
import { CURRENT, type ModelElement, type ModelRecord } from "./model.js";
import type { ModelRef, ModelVariant, ModelWorkspace, ModelWorkspaceElement } from "./workspace-model.js";

export const REPOSITORIES = ["spec", "lib"] as const;
export const VARIANT_IDS = ["A", "B", "C"] as const;
/** The UUID pool; two elements of one repository that draw the same are twins. */
export const ELEMENT_IDS = ["e1", "e2", "e3", "e4", "e5", "e6"] as const;
export const MAX_ELEMENTS = 7;

const repositoryArbitrary = fc.constantFrom(...REPOSITORIES);

// The first repository is drawn more often, so most relations resolve in their source's own repository.
const refArbitrary: fc.Arbitrary<ModelRef> = fc
  .record({
    id: fc.constantFrom(...ELEMENT_IDS),
    repository: fc.option(repositoryArbitrary, { nil: undefined, freq: 2 }),
  })
  .map(({ id, repository }) => (repository === undefined ? { id } : { id, repository }));

/** An item naming the UUID by position of an element before `index` (itself for the first), in its repository. */
function lowerRefArbitrary(index: number): fc.Arbitrary<ModelRef> {
  return fc
    .constantFrom(...ELEMENT_IDS.slice(0, Math.max(1, Math.min(index, ELEMENT_IDS.length))))
    .map((id) => ({ id }));
}

function variantsArbitrary(): fc.Arbitrary<ModelVariant[]> {
  return fc.integer({ min: 0, max: VARIANT_IDS.length }).chain((count) =>
    fc.tuple(
      ...VARIANT_IDS.slice(0, count).map((id) =>
        fc.record({
          id: fc.constant(id),
          repository: repositoryArbitrary,
          invalid: fc.integer({ min: 0, max: 4 }).map((value) => value === 0),
          excludes: fc.array(refArbitrary, { maxLength: 2 }),
        }),
      ),
    ),
  );
}

/** The own part of one UUID, its verification records for the core or a variant (see the file comment). */
function ownArbitrary(variants: readonly string[]): fc.Arbitrary<ModelElement> {
  const variantArbitrary: fc.Arbitrary<string | undefined> =
    variants.length === 0
      ? fc.constant(undefined)
      : fc.option(fc.constantFrom(...variants), { nil: undefined, freq: 2 });
  // Shape 0: the records of `statusModelElement`; 1: one passed record of the current version, so leaves are often
  // verified; 2: no record, so a parent decides by its children.
  return fc
    .tuple(
      statusModelElement(),
      fc.array(variantArbitrary, { minLength: 6, maxLength: 6 }),
      fc.integer({ min: 0, max: 2 }),
    )
    .map(([own, variantsOfRecords, shape]) => {
      const records: readonly ModelRecord[] =
        shape === 1
          ? [{ kind: "verification", version: CURRENT, date: renderDate(0, "Z"), result: "passed" }]
          : shape === 2
            ? []
            : own.records;
      return {
        ...own,
        records: records.map((record, position) => {
          const variant = variantsOfRecords[position];
          return record.kind === "verification" && variant !== undefined ? { ...record, variant } : record;
        }),
      };
    });
}

function elementArbitrary(
  variants: readonly string[],
  pool: readonly { readonly id: string; readonly own: ModelElement }[],
  index: number,
): fc.Arbitrary<ModelWorkspaceElement> {
  return fc
    .record({
      // Mostly a UUID of its own by position, so derivation items find their targets; sometimes any, for twins.
      uuid: fc.oneof(
        {
          weight: 4,
          arbitrary: fc.constantFrom(...pool.slice(index % pool.length, (index % pool.length) + 1)),
        },
        { weight: 1, arbitrary: fc.constantFrom(...pool) },
      ),
      repository: fc.oneof(
        { weight: 3, arbitrary: fc.constant(REPOSITORIES[0]) },
        { weight: 1, arbitrary: repositoryArbitrary },
      ),
      need: fc.integer({ min: 0, max: 7 }).map((value) => value === 0),
      invalid: fc.integer({ min: 0, max: 6 }).map((value) => value === 0),
      emergent: fc.integer({ min: 0, max: 2 }).map((value) => value === 0),
      validity: fc.oneof(
        { weight: 2, arbitrary: fc.constant([] as string[]) },
        { weight: 1, arbitrary: fc.subarray([...variants]) },
      ),
      // Mostly a parent of a lower position, so chains of depth 2 and 3 form; sometimes any, for cycles.
      derivesFrom: fc.array(
        fc.oneof({ weight: 3, arbitrary: lowerRefArbitrary(index) }, { weight: 1, arbitrary: refArbitrary }),
        { maxLength: 2 },
      ),
      replaces: fc.array(refArbitrary, { maxLength: 1 }),
    })
    .map(({ uuid, repository, need, invalid, emergent, validity, derivesFrom, replaces }) => ({
      key: `x${String(index)}`,
      id: uuid.id,
      repository,
      type: need ? ("need" as const) : ("requirement" as const),
      invalid,
      emergent: emergent && !need,
      validity: need ? [] : validity,
      derivesFrom,
      replaces,
      // R4: the files of one UUID share its records, and with them its criteria and versions.
      own: uuid.own,
    }));
}

/** A workspace of up to `MAX_ELEMENTS` elements, with sort keys for the order a test asks about them. */
export function statusModelWorkspace(): fc.Arbitrary<ModelWorkspace> {
  return fc
    .record({
      repositories: fc.tuple(
        ...REPOSITORIES.map((name) =>
          fc.record({ name: fc.constant(name), variantIndependent: fc.boolean() }),
        ),
      ),
      variants: variantsArbitrary(),
      count: fc.integer({ min: 1, max: MAX_ELEMENTS }),
      order: fc.array(fc.integer({ min: 0, max: 99 }), {
        minLength: MAX_ELEMENTS * (VARIANT_IDS.length + 1),
        maxLength: MAX_ELEMENTS * (VARIANT_IDS.length + 1),
      }),
    })
    .chain(({ repositories, variants, count, order }) => {
      const ids = variants.map((variant) => variant.id);
      return fc
        .tuple(...ELEMENT_IDS.map((id) => ownArbitrary(ids).map((own) => ({ id, own }))))
        .chain((pool) =>
          fc.tuple(...Array.from({ length: count }, (_, index) => elementArbitrary(ids, pool, index))),
        )
        .map((elements) => ({ repositories, variants, elements, order }));
    });
}
