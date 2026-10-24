// File names of element files (D-056, ADR-0004 "File name and location", SR-001). The only place
// that forms one: every other module takes file names from here.
import { ELEMENT_FILE_EXTENSION } from "./discover.js";

/** Hex digits of the UUID in a file name (D-056); the displayed short ID is separate (SR-084). */
export const FILE_NAME_DIGITS = 12;

/** What a file name is made of: the prefix of the element's type and its UUID. */
export interface FileNameParts {
  /** Prefix of the type in the metamodel, e.g. `SR` (D-017). */
  readonly prefix: string;
  /** The UUID (D-017). */
  readonly id: string;
}

/**
 * `SR-825b7146fb54.md`: the prefix of the type, a dash, the last 12 hex digits of the UUID and
 * `.md`. Given once, when the element is created; LogReq never renames the file afterwards, also not
 * when the title or the type changes (SR-001 AK2) or the displayed short ID grows (SR-084 AK3).
 */
export const fileNameFor = (element: FileNameParts): string =>
  `${element.prefix}-${element.id.replaceAll("-", "").slice(-FILE_NAME_DIGITS)}${ELEMENT_FILE_EXTENSION}`;
