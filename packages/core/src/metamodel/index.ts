// The `metamodel` block (SR-011..SR-015): reading the metamodel files of the checked-out state,
// resolving the inheritance of types (SR-012), assigning the built-in meanings (SR-013) and
// finding types by key or meaning.
// Core blocks and commands import it relatively; it is not part of the package's public API.
// The file types (`MetamodelFile`, `MetamodelType`, ...) are generated: `../generated/types.js`.
export { assertWritable, metamodelProblems, workspaceAccess } from "./access.js";
export type { WorkspaceAccess } from "./access.js";
export { resolveTypes } from "./inheritance.js";
export type { EffectiveType, Located, LocatedType, ResolvedTypes } from "./inheritance.js";
export { METAMODEL_FILE_EXTENSION, loadMetamodel } from "./load.js";
export type { Metamodel } from "./load.js";
export { findType, typeForNewElement } from "./lookup.js";
export {
  MEANINGS,
  propertyWithMeaning,
  relationKindsWithMeaning,
  requireMeaning,
  typesWithMeaning,
} from "./meanings.js";
export type {
  Meaning,
  MeaningAssignment,
  MeaningList,
  PropertyMeaning,
  RelationMeaning,
  TypeMeaning,
} from "./meanings.js";
export { metamodelState } from "./state.js";
