// The verification of the nodes of an element's graph (SR-136, trace.graph): „Das Tool muss im Graphen
// des aktuellen Elements bei jedem Requirement seinen Nachweisstatus und den Anteil seiner nachgewiesenen
// Akzeptanzkriterien und bei jedem Need den Nachweisgrad der direkt von ihm abgeleiteten Requirements
// zeigen.“ No rule of its own beyond the count of a ring: it reads the shared `verificationState`, so a
// node says what element.get, evidence.status and evidence.degree say in the same view (SR-080 AK2).
//
// 1. View: the graph's view, the core without one (SR-037 AK4). A requirement without a status there
//    (it applies only in a variant) gets none and counts in no degree (assumption, spec question #1111).
// 2. Requirement (type with the meaning `requirement`): its verification entry in the view (`entryOf`),
//    and the count of its ring (`shownCriteria`, AK2, AK4, AK5).
// 3. Need (type with the meaning `need`): the degree (`degreeOf`, SR-037) of its derivation children
//    that count, as the status counts children (`StateStatus.children`: none while the metamodel is not
//    valid or no relation kind derives), each once, in the whole store whatever the graph shows (AK3);
//    `share` is left out when none counts (AK6).
// Cost: one `prepare` of the requirement nodes and the needs' children (one batch of versions at most),
// one evaluation each, memoised per view.
//
// A row of a list (SR-137, element.list and element.search with `withVerification`) shows the same as
// the element's node (`rowsVerification`): AK3 asks for the very ring of the graph. Its view is the one
// evidence.degree counts the same selection in, so the rows of a package page count as its degree line
// (AK2).
import type { ElementRecord } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";
import type { VerificationDegree } from "./degree.js";
import { countedIn, degreeOf, viewIdOf } from "./degree.js";
import type { VerificationResult } from "./indirect.js";
import { criterionNameAt } from "./criteria.js";
import type { CriteriaCount, StatusSource, VerificationEntries } from "./status.js";
import { entryOf, verificationState } from "./verification.js";

/** What a node of the graph shows of its verification (SR-136); empty for a node with nothing to show. */
export interface NodeVerification {
  readonly verification?: [VerificationEntries[number]];
  readonly criteria?: CriteriaCount;
  readonly degree?: VerificationDegree;
}

/**
 * The count of a requirement's progress ring (SR-136 AK2, AK4, AK5): the criteria its own records in the
 * view count; without such a record (no `criteria`) and with `n` acceptance criteria, none of `n`
 * verified, since no record verifies one (SR-031 AK1, AK5); none for `indirect` (AK4) or without
 * acceptance criteria (AK5).
 */
export const shownCriteria = (
  source: Pick<StatusSource, "criteriaOf">,
  element: ElementRecord,
  result: VerificationResult,
): CriteriaCount | undefined => {
  if (result.criteria !== undefined) {
    return result.criteria;
  }
  const { count: total, items } = source.criteriaOf(element);
  return result.status === "indirect" || total === 0
    ? undefined
    : {
        verified: 0,
        total,
        notVerified: Array.from({ length: total }, (_, i) => criterionNameAt(items, i + 1)),
      };
};

const NOTHING: NodeVerification = Object.freeze({});

const CORE: View = Object.freeze({ kind: "core" });

/** The verification of each node of `elements` in `view`, the core without one (see the file comment). */
export const graphVerification = async (
  workspace: Workspace,
  elements: readonly ElementRecord[],
  view: View = CORE,
): Promise<(element: ElementRecord) => NodeVerification> => {
  const status = await workspace.get(verificationState);
  const { source, children } = status;
  const derived = new Map<ElementRecord, ElementRecord[]>();
  for (const element of elements) {
    if (source.needs.has(element.type)) {
      derived.set(element, countedIn(source, [...new Set(children?.childrenOf(element) ?? [])]));
    }
  }
  const requirements = elements.filter((element) => source.requirements.has(element.type));
  await status.prepare([...requirements, ...[...derived.values()].flat()], { own: true });
  const id = viewIdOf(view);
  return (element) => {
    const result = source.requirements.has(element.type) ? status.evaluate(element, view) : undefined;
    const counted = derived.get(element);
    if (result === undefined && counted === undefined) {
      return NOTHING;
    }
    const criteria = result === undefined ? undefined : shownCriteria(source, element, result);
    return {
      ...(result === undefined ? {} : { verification: [entryOf(id, result)] }),
      ...(criteria === undefined ? {} : { criteria }),
      ...(counted === undefined ? {} : { degree: degreeOf(status, counted, view) }),
    };
  };
};

/**
 * What each row of a list shows of its element's verification (SR-137): `graphVerification` of its
 * record in the view of the list's selection (`views[0]`, the selection's, else its saved filter's, as
 * evidence.degree takes it; the core without one), one entry per row in the order of `records`.
 */
export const rowsVerification = async (
  workspace: Workspace,
  records: readonly ElementRecord[],
  views: readonly View[],
): Promise<NodeVerification[]> => {
  const of = await graphVerification(workspace, [...new Set(records)], views[0] ?? CORE);
  return records.map(of);
};
