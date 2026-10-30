// variant.exclude (SR-042, D-020, D-059): excludes core requirements for a variant, or with `undo`
// takes exclusions back. The exclusion is a relation with the meaning `exclusion` from the variant,
// so it lives only in the variant's file (ADR-0004) and the core requirement's file stays as it is
// (AK2). The writes go through the path of relation.add and relation.remove (model/relation-write.ts):
// one flow mapping per entry with the target's version, and its title within one repository.
//
// - The variant must be an element whose type has the meaning `variant` (`not-a-variant`).
// - Adding: every ref must be a core requirement (`isCoreRequirement`); otherwise nothing is
//   written and the refusal names the refs (`not-core`, AK4). Each ref gets the first relation kind
//   with the meaning `exclusion`, in metamodel order, that the metamodel allows from the variant's
//   type to the ref's type (none: `relation.not-allowed`). An exclusion that is there is kept.
//   Every check runs before the first write.
// - `undo` removes each ref's entries under every kind with the meaning `exclusion`, also an entry
//   that names no core requirement (AK7's hand-written ones). A ref with no entry gives one `info`
//   problem `relation.not-found`, as relation.remove does; the other refs are undone (AK6). Removing
//   an entry is a relation edit: no element and no file is deleted (D-045).
import type { CommandInput, CommandOutput, Problem } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { Metamodel } from "../../metamodel/index.js";
import {
  metamodelState,
  relationKindsWithMeaning,
  relationOptions,
  requireMeaning,
} from "../../metamodel/index.js";
import type { ElementRecord } from "../../model/index.js";
import {
  addRelation,
  elementLabel,
  elementStoreState,
  isUuid,
  removeRelation,
  resolveRef,
  shortIdState,
} from "../../model/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { isCoreRequirement, variantTypes } from "../../variants/index.js";

type Input = CommandInput<"variant.exclude">;
type Output = CommandOutput<"variant.exclude">;

/** The variant, store, metamodel and short IDs as they are now; the variant checked (see the file comment). */
const stateOf = async (workspace: Workspace, input: Input) => {
  const metamodel = await workspace.get(metamodelState);
  requireMeaning(metamodel, "variant", "variant.exclude");
  requireMeaning(metamodel, "exclusion", "variant.exclude");
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const variant = resolveRef(store, shortIds, input.variant);
  if (!variantTypes(metamodel).has(variant.type)) {
    throw new CommandError(
      "input.invalid",
      `${input.variant} is no variant: variant.exclude takes an element whose type has the meaning variant`,
      { ref: input.variant, reason: "not-a-variant" },
    );
  }
  return { metamodel, store, shortIds, variant };
};

/** The first kind with the meaning `exclusion` allowed from `variant` to `target`, in metamodel order. */
const exclusionKind = (metamodel: Metamodel, variant: ElementRecord, target: ElementRecord): string => {
  const option = relationOptions(metamodel, variant.type).find(
    (o) => o.kind.meaning === "exclusion" && o.targetTypes.includes(target.type),
  );
  if (option === undefined) {
    throw new CommandError(
      "relation.not-allowed",
      `The metamodel allows no relation with the meaning exclusion from ${variant.type} to ${target.type}`,
      { sourceType: variant.type, targetType: target.type },
    );
  }
  return option.kind.key;
};

const exclude = async (workspace: Workspace, input: Input, refs: readonly string[]): Promise<Output> => {
  const { metamodel, store, shortIds, variant } = await stateOf(workspace, input);
  const targets = refs.map((ref) => ({ ref, target: resolveRef(store, shortIds, ref) }));
  const notCore = targets.filter(({ target }) => !isCoreRequirement({ metamodel }, target));
  if (notCore.length > 0) {
    const named = notCore.map(({ target }) => elementLabel({ metamodel, shortIds }, target)).join(", ");
    throw new CommandError(
      "input.invalid",
      `Only core requirements can be excluded; no core requirement (it has a validity, or its type has no validity property): ${named}. Nothing written`,
      { reason: "not-core", refs: notCore.map(({ ref }) => ref) },
    );
  }
  const writes = targets.map(({ ref, target }) => ({ ref, kind: exclusionKind(metamodel, variant, target) }));
  const files = new Set<string>();
  const problems: Problem[] = [];
  for (const { ref, kind } of writes) {
    const added = await addRelation(workspace, { source: input.variant, kind, target: ref });
    added.files.forEach((f) => files.add(f));
    problems.push(...added.problems);
  }
  return { files: [...files], problems };
};

const undo = async (workspace: Workspace, input: Input, refs: readonly string[]): Promise<Output> => {
  const { metamodel, store, shortIds } = await stateOf(workspace, input);
  // A short ID that names nothing fails before the first write; a UUID may name a target that is gone.
  refs.filter((ref) => !isUuid(ref.toLowerCase())).forEach((ref) => resolveRef(store, shortIds, ref));
  const kinds = relationKindsWithMeaning(metamodel, "exclusion");
  const files = new Set<string>();
  const problems: Problem[] = [];
  for (const ref of refs) {
    const notFound: Problem[] = [];
    for (const kind of kinds) {
      const removed = await removeRelation(workspace, { source: input.variant, kind: kind.key, target: ref });
      removed.files.forEach((f) => files.add(f));
      notFound.push(...removed.problems);
    }
    // Not found under every kind: the first kind's problem.
    if (notFound.length === kinds.length) {
      problems.push(...notFound.slice(0, 1));
    }
  }
  return { files: [...files], problems };
};

export default defineCommand({
  name: "variant.exclude",
  run: async (ctx, input): Promise<Output> => {
    const refs = [...new Set(input.refs)];
    return input.undo ? undo(ctx.workspace, input, refs) : exclude(ctx.workspace, input, refs);
  },
});
