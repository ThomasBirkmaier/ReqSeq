// Relation targets (ADR-0004, D-058): what a relation in a source file points at. A target names
// its element by UUID and, across repositories, the workspace name of the repository it lies in.
// Every check that follows a relation (SR-086, SR-089, SR-006) looks the target up here.
import type { RelationTarget } from "../generated/types.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { ElementMatch } from "./elements.js";
import type { ElementStore } from "./store.js";

/** Whether a value has the format of a relation target (`common.schema.json#/$defs/relationTarget`). */
export const isRelationTarget = (value: unknown): value is RelationTarget =>
  fileSchemaValidator("common.schema.json#/$defs/relationTarget")(value);

/**
 * The element a relation target names: the records of its UUID that lie in the repository it
 * names, or in the source's own repository when it names none (D-058). `unknown` when there is no
 * such record there (the target is missing, SR-089, or its repository is missing, SR-006);
 * `ambiguous` when several files there share the UUID (SR-088), in store order. Unlike `resolveId`,
 * which asks whether a UUID names one element in the whole workspace, a record of the UUID in
 * another repository does not count.
 */
export const resolveTarget = (
  store: ElementStore,
  sourceRepository: string,
  target: Pick<RelationTarget, "id"> & Partial<RelationTarget>,
): ElementMatch => {
  const repository = target.repository ?? sourceRepository;
  const elements = (store.byId.get(target.id) ?? []).filter((r) => r.repository === repository);
  const [first] = elements;
  if (first === undefined) {
    return { kind: "unknown" };
  }
  return elements.length === 1 ? { kind: "found", element: first } : { kind: "ambiguous", elements };
};
