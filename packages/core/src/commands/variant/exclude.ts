// variant.exclude (SR-042, D-020, D-059): excludes core requirements for a variant, or with `undo`
// takes exclusions back. The exclusion is a relation with the meaning `exclusion` from the variant,
// so it lives only in the variant's file (ADR-0004) and the core requirement's file stays as it is
// (AK2). The command uses the pieces of relation.add and relation.remove (model/relation-write.ts):
// each entry is a flow mapping with the target's version, and its title within one repository; the
// variant's file is written once for all refs (`writeSourceEdits`), after every check.
//
// - The variant must be an element whose type has the meaning `variant` (`not-a-variant`).
// - Adding: refs are taken once per element they name. Every one must be a core requirement
//   (`isCoreRequirement`); otherwise nothing is written and the refusal names the refs (`not-core`,
//   AK4). One the variant excludes already, under any kind with the meaning `exclusion`, is kept.
//   Each other gets the first kind with the meaning `exclusion`, in metamodel order, that the
//   metamodel allows from the variant's type to the ref's type (none: `relation.not-allowed`).
// - `undo` removes the entries each ref names (`removalMatch`, as relation.remove matches them)
//   under every kind with the meaning `exclusion`, also an entry that names no core requirement
//   (AK7's hand-written ones). A ref that names no entry gives one `info` problem
//   `relation.not-found`, as relation.remove does; the other refs are undone (AK6). Removing an
//   entry is a relation edit: no element and no file is deleted (D-045).
import type { CommandInput, CommandOutput, Problem } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { FrontmatterEdit } from "../../files/index.js";
import type { Metamodel } from "../../metamodel/index.js";
import { relationKindsWithMeaning, relationOptions, requireMeaning } from "../../metamodel/index.js";
import type { ElementRecord, RelationState } from "../../model/index.js";
import {
  assertElementWritable,
  currentTarget,
  elementLabel,
  hasId,
  itemsUnder,
  notFoundProblem,
  relationStateOf,
  removalEdits,
  removalMatch,
  resolveRef,
  writeSourceEdits,
} from "../../model/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { isCoreRequirement, variantTypes } from "../../variants/index.js";

type Input = CommandInput<"variant.exclude">;
type Output = CommandOutput<"variant.exclude">;

/** The state of the relation writes and the variant, checked (see the file comment). */
const stateOf = async (workspace: Workspace, input: Input) => {
  const state = await relationStateOf(workspace);
  const { metamodel, store, shortIds } = state;
  requireMeaning(metamodel, "variant", "variant.exclude");
  requireMeaning(metamodel, "exclusion", "variant.exclude");
  const variant = resolveRef(store, shortIds, input.variant);
  if (!variantTypes(metamodel).has(variant.type)) {
    throw new CommandError(
      "input.invalid",
      `${input.variant} is no variant: variant.exclude takes an element whose type has the meaning variant`,
      { ref: input.variant, reason: "not-a-variant" },
    );
  }
  const type = assertElementWritable(metamodel, variant);
  return { state, variant, type, kinds: relationKindsWithMeaning(metamodel, "exclusion") };
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

/** Writes `edits` into the variant's file, once; nothing when there are none. */
const write = async (
  workspace: Workspace,
  state: RelationState,
  variant: ElementRecord,
  edits: readonly FrontmatterEdit[],
  keyOrder: readonly string[],
): Promise<readonly string[]> =>
  edits.length === 0 ? [] : (await writeSourceEdits(workspace, state, variant, edits, keyOrder)).files;

const exclude = async (workspace: Workspace, input: Input): Promise<Output> => {
  const { state, variant, type, kinds } = await stateOf(workspace, input);
  const { layout, metamodel, store, shortIds } = state;
  // Once per element, by repository and UUID, with the ref that named it first.
  const targets = new Map<string, { readonly ref: string; readonly target: ElementRecord }>();
  for (const ref of input.refs) {
    const target = resolveRef(store, shortIds, ref);
    const key = `${target.repository}\0${target.id}`;
    if (!targets.has(key)) {
      targets.set(key, { ref, target });
    }
  }
  const notCore = [...targets.values()].filter(({ target }) => !isCoreRequirement({ metamodel }, target));
  if (notCore.length > 0) {
    const named = notCore.map(({ target }) => elementLabel({ metamodel, shortIds }, target)).join(", ");
    throw new CommandError(
      "input.invalid",
      `Only core requirements can be excluded; no core requirement (it has a validity, or its type has no validity property): ${named}. Nothing written`,
      { reason: "not-core", refs: notCore.map(({ ref }) => ref) },
    );
  }
  const excluded = (target: ElementRecord): boolean =>
    kinds.some((kind) =>
      itemsUnder(variant, kind.key).some(
        (item) =>
          hasId(item) &&
          item.id === target.id &&
          (item["repository"] ?? variant.repository) === target.repository,
      ),
    );
  const edits: FrontmatterEdit[] = [];
  for (const { target } of targets.values()) {
    if (!excluded(target)) {
      const key = exclusionKind(metamodel, variant, target);
      const value = await currentTarget({ layout, metamodel, store }, variant.repository, target);
      edits.push({ kind: "append-item", key, value: { ...value } });
    }
  }
  return { files: [...(await write(workspace, state, variant, edits, type.properties))], problems: [] };
};

const undo = async (workspace: Workspace, input: Input): Promise<Output> => {
  const { state, variant, type, kinds } = await stateOf(workspace, input);
  // Per kind the items to remove; a ref that names an item another ref named finds it too.
  const taken = new Map(kinds.map((kind) => [kind, { count: 0, indexes: new Set<number>() }]));
  const problems: Problem[] = [];
  for (const ref of [...new Set(input.refs)]) {
    const misses: Problem[] = [];
    let found = false;
    for (const [kind, entry] of taken) {
      const match = removalMatch(state, variant, kind, ref, undefined);
      match.indexes.forEach((index) => entry.indexes.add(index));
      entry.count = match.items.length;
      found ||= match.indexes.length > 0;
      misses.push(notFoundProblem(state, variant, kind, ref, match.target.id));
    }
    // Found under no kind: the problem of the first kind.
    problems.push(...misses.slice(0, found ? 0 : 1));
  }
  const edits = [...taken].flatMap(([kind, { count, indexes }]) =>
    indexes.size === 0
      ? []
      : removalEdits(
          kind.key,
          [...indexes].sort((a, b) => a - b),
          count,
        ),
  );
  return { files: [...(await write(workspace, state, variant, edits, type.properties))], problems };
};

export default defineCommand({
  name: "variant.exclude",
  run: async (ctx, input): Promise<Output> =>
    input.undo ? undo(ctx.workspace, input) : exclude(ctx.workspace, input),
});
