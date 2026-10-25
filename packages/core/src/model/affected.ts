// The elements directly affected by a change of an element (SR-024, D-013): every element whose file
// holds a relation or an inline reference to it, as the incoming relation index gives them
// (`incomingTo`: any relation kind, any relation-valued property such as validity or packages, and
// inline references; ADR-0004). The element itself is never one of them: a relation of the element
// to itself changes with it. `element.update` counts them when a save changes the version (AK2);
// `trace.affected` starts its walk with them (`trace/affected.ts`, AK1).
//
// Files that share the element's UUID in its repository (SR-088): the index cannot tell which of
// them a link means, so every one of them gets the links, and a twin that points at the UUID is
// affected too (a change may concern it; SR-088 reports the duplicate on its own).
import type { ElementRecord } from "./elements.js";
import type { IncomingIndex, IncomingLink } from "./incoming.js";
import { incomingTo } from "./incoming.js";

/**
 * The relations and inline references of other elements that point at `element` (its repository
 * and UUID), in the order of `incomingTo`: relations first, then references.
 */
export const directLinks = (index: IncomingIndex, element: ElementRecord): IncomingLink[] =>
  incomingTo(index, element.repository, element.id).filter((link) => link.source !== element);

/** The number of elements `directLinks` names, each once (SR-024 AK2). */
export const directlyAffectedCount = (index: IncomingIndex, element: ElementRecord): number =>
  new Set(directLinks(index, element).map((link) => link.source)).size;
