// How a row names an element and the other end of a relation (SR-231 AK3; SR-006 AK1): its identifier, else its short
// ID, with its title; an end that is not here by what the relation knows of it. The lists and the export's pages use
// it (`html-export/links.ts` re-exports it).
import type { DataExportRelation } from "../generated/types.js";

/** An element as a row names it: its identifier, else its short ID, then its title when it has one. */
export const nameOf = (element: {
  readonly shortId: string;
  readonly identifier?: string;
  readonly title?: string;
}): string => {
  const name = element.identifier ?? element.shortId;
  return element.title === undefined || element.title === "" ? name : `${name} ${element.title}`;
};

/** The other end of `relation` as text: named when it is here, else what the relation knows of it. */
export const relationText = (relation: DataExportRelation): string => {
  // `shortId` is given for an available and an inaccessible end, `repository` for every end but one whose stored
  // repository is no text (the schema of `data.export`).
  const { id, shortId = id, repository = "" } = relation;
  switch (relation.targetState) {
    case "available":
      return nameOf({ ...relation, shortId });
    case "inaccessible":
      return `${shortId}, repository ${repository}, not accessible`;
    case "missing":
      return `${id}, not found`;
    case "ambiguous":
      return `${id}, in several files`;
    case "unknown-repository":
      return `${id}, repository ${repository} not in the workspace`;
  }
};
