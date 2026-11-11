// Generator of small abstract workspaces for the status model (#1395): two repositories (each variant-independent or
// not), up to three variants (some with an invalid status, with exclusions), and up to seven elements from a small
// UUID pool, so twins (two files of one UUID in one repository) occur, with validities, derivation and replacement
// items that name the repository or not, cycles, emergent and invalid elements, needs, and records for the core or a
// variant. Each element's own part comes from `statusModelElement` (#1394). Only verification records name a variant:
// a validation record with a variant is refused by the reader (SR-038 AK4), which is level 2 (#1396). Pure, so a seed
// replays a case and shrinking works.
import fc from "fast-check";
import { statusModelElement } from "./generator.js";
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

function elementArbitrary(variants: readonly string[], index: number): fc.Arbitrary<ModelWorkspaceElement> {
  const variantArbitrary: fc.Arbitrary<string | undefined> =
    variants.length === 0
      ? fc.constant(undefined)
      : fc.option(fc.constantFrom(...variants), { nil: undefined, freq: 2 });
  return fc
    .record({
      id: fc.constantFrom(...ELEMENT_IDS),
      repository: fc.oneof(
        { weight: 3, arbitrary: fc.constant(REPOSITORIES[0]) },
        { weight: 1, arbitrary: repositoryArbitrary },
      ),
      need: fc.integer({ min: 0, max: 7 }).map((value) => value === 0),
      invalid: fc.integer({ min: 0, max: 6 }).map((value) => value === 0),
      emergent: fc.integer({ min: 0, max: 6 }).map((value) => value === 0),
      validity: fc.oneof(
        { weight: 2, arbitrary: fc.constant([] as string[]) },
        { weight: 1, arbitrary: fc.subarray([...variants]) },
      ),
      derivesFrom: fc.array(refArbitrary, { maxLength: 2 }),
      replaces: fc.array(refArbitrary, { maxLength: 1 }),
      own: statusModelElement(),
      variantsOfRecords: fc.array(variantArbitrary, {
        minLength: 6,
        maxLength: 6,
      }),
    })
    .map(
      ({
        id,
        repository,
        need,
        invalid,
        emergent,
        validity,
        derivesFrom,
        replaces,
        own,
        variantsOfRecords,
      }) => ({
        key: `x${String(index)}`,
        id,
        repository,
        type: need ? ("need" as const) : ("requirement" as const),
        invalid,
        emergent: emergent && !need,
        validity: need ? [] : validity,
        derivesFrom,
        replaces,
        own: {
          ...own,
          records: own.records.map((record, position) => {
            const variant = variantsOfRecords[position];
            return record.kind === "verification" && variant !== undefined ? { ...record, variant } : record;
          }),
        },
      }),
    );
}

/** A workspace of up to `MAX_ELEMENTS` elements. */
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
    })
    .chain(({ repositories, variants, count }) => {
      const ids = variants.map((variant) => variant.id);
      return fc
        .tuple(...Array.from({ length: count }, (_, index) => elementArbitrary(ids, index)))
        .map((elements) => ({ repositories, variants, elements }));
    });
}
