// The `files` block (ADR-0007): reading and writing element and YAML files. The only module that
// writes to disk. Core blocks import it relatively; it is not part of the package's public API.
export { findConflictMarker } from "./conflict-markers.js";
export { createFolder } from "./folder.js";
export { splitFrontmatter } from "./frontmatter.js";
export type { FrontmatterSplit, LineEnding } from "./frontmatter.js";
export { parseFileBytes, parseYamlFileBytes } from "./parse.js";
export type { ParsedContent, ParsedYaml, ParseOutcome, YamlParseOutcome } from "./parse.js";
export { readElementFile, readElementFiles, readYamlFile } from "./read.js";
export type {
  FileReadResult,
  ParsedFile,
  ReadFilesOptions,
  ReadFilesResult,
  YamlFile,
  YamlReadResult,
} from "./read.js";
export type { FileSnapshot } from "./snapshot.js";
export { removePrivateFile, writePrivateFile } from "./private.js";
export { isTempFile, TEMP_FILE_PATTERN, writeFileAtomic } from "./write.js";
export type { FileKind, WriteOptions } from "./write.js";
export { editElementFile } from "./edit.js";
export type { EditableFile, FileEditRequest, FileEditResult, FrontmatterEdit } from "./edit.js";
export type { FlowMappingValue, ItemValue, PropertyValue, ScalarValue } from "./yaml-text.js";
