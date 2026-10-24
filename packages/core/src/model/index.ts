// The `model` block (ADR-0008, SR-003): the element store of a workspace. Core blocks and commands
// import it relatively; it is not part of the package's public API.
export { ELEMENT_FILE_EXTENSION, listMarkdownFiles } from "./discover.js";
export type { DiscoveredFiles } from "./discover.js";
export { classifyFile } from "./elements.js";
export type { Classified, ElementRecord } from "./elements.js";
export { compileGlob, ignoreMatcher } from "./ignore.js";
export { elementStoreState, loadElements } from "./store.js";
export type { ElementStore, RepositoryFile } from "./store.js";
export { SHORT_ID_MIN_LENGTH, UNKNOWN_TYPE_PREFIX, buildShortIds, shortIdState } from "./short-id.js";
export type { ShortIdMatch, ShortIds } from "./short-id.js";
