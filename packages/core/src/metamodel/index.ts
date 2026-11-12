// The `metamodel` block (SR-011..SR-015): reading the metamodel files of the checked-out state,
// resolving the inheritance of types (SR-012), assigning the built-in meanings (SR-013) and
// finding types by key or meaning.
// Core blocks and commands import it relatively; it is not part of the package's public API.
// The file types (`MetamodelFile`, `MetamodelType`, ...) are generated: `../generated/types.js`.
export { assertWritable, metamodelProblems, workspaceAccess } from "./access.js";
export type { WorkspaceAccess } from "./access.js";
export { metamodelOutput } from "./output.js";
export { resolveTypes } from "./inheritance.js";
export type { DefinedKeys, EffectiveType, Located, LocatedType, ResolvedTypes } from "./inheritance.js";
export { limitsOf, maxItemsOf, minimaOf } from "./limits.js";
export type { ItemLimit, Minima, RelationLimit, RelationMinimum } from "./limits.js";
export { METAMODEL_FILE_EXTENSION, UNKNOWN_TYPE_PREFIX, isKeyForm, loadMetamodel } from "./load.js";
export type { Metamodel } from "./load.js";
export {
  allowsType,
  findType,
  hasWorkingStatus,
  keyDefinition,
  markdownKeysOf,
  typeForNewElement,
  typeStatuses,
} from "./lookup.js";
export { findNamed, listNamed } from "./named.js";
export { relationKindFor, relationOptions } from "./relation-options.js";
export type { RelationOption } from "./relation-options.js";
export type { Named, NamedMatch } from "./named.js";
export type { KeyDefinition } from "./lookup.js";
export {
  EMERGENT_CHOICE,
  MEANINGS,
  ORIGIN_MEANINGS,
  acceptanceCriteriaProblem,
  emergentProblem,
  meaningUnassigned,
  meaningUnassignedMessage,
  originMeaning,
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
export {
  SHOWN_DIFFERENCES,
  repositoryMetamodelProblems,
  versionDifferences,
} from "./repository-metamodels.js";
export { STANDARD_MODEL_FILE, STANDARD_MODEL_TEXT } from "./standard-model.js";
export { metamodelState } from "./state.js";
