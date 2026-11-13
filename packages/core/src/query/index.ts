// The `query` block (architecture README section 5): the filter conditions (SR-069), saved filters
// (SR-070), the selection of a command (SR-101), sorting and the derivation tree of a list (SR-075),
// the evidence provider the filter asks (stage 4 fills it) and the full-text search index (SR-068,
// ADR-0008). Core blocks and commands import it relatively; it is not part of the package's public API.
export { canonicalCondition, canonicalView } from "./canonical.js";
export { compileWhere } from "./condition.js";
export type { CompiledCondition } from "./condition.js";
export type { CompileContext, Predicate, QueryContext, QueryNotes } from "./context.js";
export { evidenceStatusState } from "./evidence.js";
export { facetsOf } from "./facets.js";
export type { EvidenceStatuses } from "./evidence.js";
export {
  FILTERS,
  FILTER_FILE_EXTENSION,
  faultyFilter,
  filterSlug,
  findSavedFilter,
  inSavedFilter,
  newFilterFile,
  readSavedFilters,
  savedFilterFor,
  savedSort,
} from "./saved.js";
export type { FoundFilter, SavedFilter, SavedFilters } from "./saved.js";
export {
  faultySaved,
  findSaved,
  inSavedFile,
  inSavedFileAsync,
  keyEdits,
  readSavedFolder,
  writeSaved,
} from "./saved-files.js";
export type { FoundSaved, SavedFile, SavedFolder, SavedKind } from "./saved-files.js";
export { PERSPECTIVES, readPerspectives } from "./perspectives.js";
export type { SavedPerspective, SavedPerspectives } from "./perspectives.js";
export { orderedGroups, orderedSelection } from "./ordered.js";
export type { Grouping, GroupHead } from "./group.js";
export { checkGroupKey, groupingOf } from "./group.js";
export { resolveSelection } from "./selection.js";
export type { Selected } from "./selection.js";
export { sortElements } from "./sort.js";
export type { SortContext, SortedElements, TreePlace } from "./sort.js";
export {
  SEARCH_FIELDS,
  SearchBuildCancelled,
  buildSearchIndex,
  carrySearchIndex,
  describeHit,
  documentOf,
  matchingKeys,
  rankedHits,
  recordKey,
  searchElements,
} from "./search-index.js";
export type {
  BuiltSearchIndex,
  RankedHit,
  SearchDocument,
  SearchElementsOptions,
  SearchField,
  SearchHit,
  SearchIndex,
  SearchResults,
} from "./search-index.js";
export { SEARCH_CACHE_FILE, parseSearchIndex, searchDigest, serializeSearchIndex } from "./search-cache.js";
// `searchIndexState` is not exported: a command that awaited it directly would not mark the build as
// wanted, and the build would pause for that very command (`search-state.ts`); `searchIndex` does.
export { SEARCH_CARRY_LIMIT, searchIndex, warmSearchIndex } from "./search-state.js";
