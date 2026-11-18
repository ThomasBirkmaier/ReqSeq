// A repeated delivery (SR-056): the element of an earlier delivery an object updates
// (`matchedElement`), the case of each (`classify`) and the writes into existing elements
// (`planUpdates`). Part of import.ts, whose file comment says what the plan does; "the file
// comment" here means that one.
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CommandError } from "../catalog.js";
import type { FrontmatterEdit } from "../files/index.js";
import { editElementFile } from "../files/index.js";
import type { ReqifObject } from "../generated/types.js";
import type { VersionForms } from "../model/index.js";
import { NORMAL_FORM, formOf, hasId } from "../model/index.js";
import type { ExistingElement, RelationItem } from "./repeat.js";
import { propertyTargetsDiffer, relationEdits, sameUpToForm, targetsDiffer } from "./repeat.js";
import type { ReqifSpecObject, ReqifSpecType } from "./model.js";
import { itemsOf, updatedFile } from "./import-context.js";
import type {
  ConflictChoices,
  Context,
  Draft,
  ImportPlan,
  PlannedUpdate,
  PlannedUpdateImage,
  RepeatOptions,
} from "./import-context.js";

/**
 * The element of an earlier delivery `object` updates (SR-056), refused when the mapping now gives
 * it another type or it has no current version.
 */
export const matchedElement = (
  context: Context,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  ownType: string,
): ExistingElement | undefined => {
  const existing = context.existing.matched.get(object.identifier);
  if (existing === undefined) {
    return undefined;
  }
  const { record } = existing;
  if (record.type !== ownType) {
    const at = context.coverage.typeEntries.get(t.identifier);
    throw new CommandError(
      "input.invalid",
      `Not imported: ${object.identifier} is ${record.file} of type ${record.type}, which an import does not change to ${ownType}`,
      { fields: [`mapping.types[${String(at)}].type`], identifier: object.identifier, id: record.id },
    );
  }
  if (existing.version === undefined) {
    throw new CommandError(
      "input.invalid",
      `Not imported: ${record.file} (${object.identifier}) has no current version, so a local change cannot be told: ${String(existing.unknown)}`,
      { id: record.id, identifier: object.identifier, file: record.file, reason: "no-version" },
    );
  }
  return existing;
};

/**
 * What the delivery does with an existing element of planned version `planned` (P), by I and C:
 * P and C are compared in the normal form of I (ADR-0005 "Normal form 2"), so an import version
 * written in another form than the tool writes now is still told apart.
 */
const caseOf = (planned: VersionForms, existing: ExistingElement): Draft["case"] => {
  const { imported } = existing;
  const form = (imported === undefined ? undefined : formOf(imported)) ?? NORMAL_FORM;
  const p = planned[form];
  // matchedElement refused an element without current version.
  const current = existing.forms?.[form];
  if (p === imported) {
    return current === imported ? "same" : "local";
  }
  // The same result on both sides is no conflict (#575/2).
  return current !== imported && current !== p ? "conflict" : "update";
};

/**
 * Sorts the drafts of existing elements by P, I and C (see the file comment) and, for an import,
 * takes the choices for the conflicts: `reqif.conflict` names those without one.
 */
export const classify = (
  context: Context,
  drafts: ReadonlyMap<string, Draft>,
  repeat: RepeatOptions,
): {
  readonly changed: ReqifObject[];
  readonly conflicts: ReqifObject[];
  readonly choices: ConflictChoices;
} => {
  const changed: ReqifObject[] = [];
  const conflicts: ReqifObject[] = [];
  for (const draft of drafts.values()) {
    const { existing } = draft;
    if (existing === undefined) {
      continue;
    }
    const object = { identifier: draft.identifier, id: draft.id };
    draft.case = caseOf(draft.planned, existing);
    if (draft.case === "update" || draft.case === "conflict") {
      changed.push(object);
    }
    if (draft.case === "conflict") {
      conflicts.push(object);
    }
  }
  const chosen = repeat.choose?.(conflicts) ?? { choices: new Map<string, "take" | "keep">(), problems: [] };
  if (repeat.choose !== undefined) {
    const missing = conflicts.filter((c) => !chosen.choices.has(c.identifier));
    if (missing.length > 0) {
      throw new CommandError(
        "reqif.conflict",
        `Not imported: ${missing.map((c) => c.identifier).join(", ")} changed locally and in the delivery; name each in take or keep`,
        { conflicts: missing },
      );
    }
  }
  for (const draft of drafts.values()) {
    draft.deliveryWins =
      draft.case === "conflict" ? chosen.choices.get(draft.identifier) === "take" : draft.case !== "local";
  }
  context.problems.push(...chosen.problems);
  return { changed, conflicts, choices: chosen.choices };
};

/**
 * The writes into existing elements and the image copies they need: the delivery for update, take
 * and same (only when the file would differ apart from delivery and import date, with a
 * `reqif.replaces-local` warning naming the keys), the origin alone for keep, nothing for an
 * element changed only locally.
 */
export const planUpdates = (
  context: Context,
  drafts: ReadonlyMap<string, Draft>,
  choices: ConflictChoices,
): Pick<ImportPlan, "updates" | "updateImages"> => {
  const { keys } = context;
  // Relation kinds only: a relation-valued property (`validity`, `packages`) is a property of the draft.
  const properties = new Set(context.metamodel.properties.map((p) => p.key));
  const relationProperties = context.metamodel.properties
    .filter((p) => p.kind === "relation")
    .map((p) => p.key);
  const uncountedTargets = context.metamodel.properties
    .filter((p) => p.kind === "relation" && p.content !== true)
    .map((p) => p.key);
  const kinds = [
    ...new Set(
      [...context.coverage.relations.values()].flatMap((k) =>
        k === undefined || properties.has(k) ? [] : [k],
      ),
    ),
  ];
  const updates: PlannedUpdate[] = [];
  const updateImages: PlannedUpdateImage[] = [];
  // The versions in every normal form of what a relation item to a draft gets (`targetVersion`).
  const byId = new Map<unknown, VersionForms | undefined>(
    [...drafts.values()].map((d) => [d.id, d.deliveryWins ? d.planned : d.existing?.forms]),
  );
  const targetForms = (id: unknown): VersionForms | undefined => byId.get(id);
  for (const draft of drafts.values()) {
    const { existing } = draft;
    if (existing === undefined) {
      continue;
    }
    const { identifier, id } = draft;
    const write = (kind: PlannedUpdate["kind"], bytes: Uint8Array): void => {
      updates.push({ identifier, id, kind, write: { ...existing, bytes } });
    };
    if (draft.case === "conflict" && choices.get(identifier) === "keep") {
      const origin = [keys["import-version"], keys.delivery, keys["import-date"]];
      const edits = origin.map((key): FrontmatterEdit => ({
        kind: "set",
        key,
        // The planner set every origin key to text.
        value: draft.properties.get(key) as string,
      }));
      write(
        "kept",
        editElementFile(existing.current.file, { edits, keyOrder: draft.base.type.properties }).bytes,
      );
      continue;
    }
    if (!draft.deliveryWins) {
      continue;
    }
    const { data } = existing.record;
    // A draft of a file of ReqSeq planned from its channels holds its relations as stored (`ownRelations`).
    const { ownRelations } = draft;
    const relations = [...new Set([...kinds, ...(ownRelations?.keys() ?? [])])].map((kind) => {
      const items =
        ownRelations === undefined
          ? (draft.relations.get(kind) ?? [])
          : (itemsOf(ownRelations.get(kind)).filter(hasId) as RelationItem[]);
      return {
        kind,
        edits: relationEdits(data, kind, items, context.existing.ids, targetForms),
        targets: targetsDiffer(data, kind, items, context.existing.ids),
      };
    });
    const extra = relations.flatMap((r) => r.edits);
    // A relation-valued property that differs only in the normal form of its versions (ADR-0005).
    const sameTargets = relationProperties.filter(
      (key) => draft.properties.has(key) && sameUpToForm(data[key], draft.properties.get(key), targetForms),
    );
    if (
      draft.case === "same" &&
      // The import version too: "same" may hold an I of another normal form than P is written in.
      !updatedFile(context.metamodel, draft, existing, extra, [
        keys.delivery,
        keys["import-date"],
        keys["import-version"],
        ...sameTargets,
      ]).changed
    ) {
      continue;
    }
    // What the file holds otherwise and the version cannot show (#575/4): the title, mapped
    // properties that do not count, and relation targets; a new version of a target alone is silent.
    const replaced = [
      ...(data[draft.base.titleKey] === draft.title ? [] : [draft.base.titleKey]),
      ...draft.uncounted.filter((key) => !isDeepStrictEqual(data[key], draft.properties.get(key))),
      // A relation-valued property that does not count (`packages`), as a file of ReqSeq gives it.
      ...uncountedTargets
        .filter((key) => draft.properties.has(key) && !draft.uncounted.includes(key))
        .filter((key) => propertyTargetsDiffer(data[key], draft.properties.get(key))),
      ...relations.filter((r) => r.targets).map((r) => r.kind),
    ];
    if (replaced.length > 0) {
      context.problems.push({
        code: "reqif.replaces-local",
        severity: "warning",
        message: `${identifier}: the delivery writes ${replaced.join(", ")} into ${existing.record.file}, which holds other values there`,
        repository: existing.record.repository,
        file: existing.record.file,
        elementId: id,
      });
    }
    write("updated", updatedFile(context.metamodel, draft, existing, extra).bytes);
    const folder = path.posix.dirname(existing.record.file);
    for (const { name, file } of draft.images.files) {
      updateImages.push({
        repository: existing.repository,
        file: path.posix.join(folder, draft.stem, name),
        name,
        image: file,
      });
    }
  }
  return { updates, updateImages };
};
