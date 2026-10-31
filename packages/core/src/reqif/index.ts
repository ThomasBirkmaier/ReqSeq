// The `reqif` block (SR-052..SR-059, ADR-0013): ReqIF import and export with a saved mapping.
// Core blocks and commands import it relatively; it is not part of the package's public API.
export {
  MAPPING_FILE_EXTENSION,
  MAPPING_KEYS,
  checkMapping,
  mappingFileName,
  mappingTarget,
  readMappingFile,
  samePath,
} from "./mapping.js";
export type { AnyMapping, MappingFile, MappingTarget } from "./mapping.js";
export { REQIF_LIMITS, parseReqif } from "./parse.js";
export { planImport } from "./import.js";
export type { ImportOrigin, ImportPlan } from "./import.js";
export { importDate, originKeys } from "./origin.js";
export type { OriginKeys } from "./origin.js";
