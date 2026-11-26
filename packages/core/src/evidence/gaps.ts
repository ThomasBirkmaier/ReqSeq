// The gaps of verification a full workspace check reports (SR-230 AK1, AK2, AK5), at the workspace file
// (rules 1 to 3) or the metamodel file (rule 4), and only when the check is not restricted (SR-092;
// `workspace.check` leaves them out there):
//
// 1. `evidence.no-location` (warning, AK1): the workspace file names no evidence location (`evidence`
//    absent or empty) while the store holds at least one requirement (a type with the meaning
//    `requirement`, own or inherited, any status), so no test result can count. A location whose folder
//    does not exist or whose repository is not on this machine is a location (`evidence.folder-missing`
//    and `workspace.repository-missing` report those).
// 2. `evidence.open-requirements` (info, AK2): with at least one evidence location, one finding with the
//    number of requirements whose status the metamodel does not mark invalid (D-044), whose verification
//    method is test and whose verification status in the core is `open`; none when there are none. The
//    finding gives only the number: the call that lists exactly them is the next step of the check (rule 3,
//    SR-226), which `workspace.check` names only while it shows the finding. The verification method is
//    test when the property with the meaning `verification-method` holds the choice key `test` or no value
//    (absent, `null` or `[]`, as the filter takes "no value"); without such a property every requirement
//    counts. The status is the one of the shared evaluator (`verificationState`), prepared as
//    `evidence.degree` prepares it, so the count, the filter condition `verification` and `evidence.degree`
//    agree (SR-080 AK2).
// 3. The step is `element.list` with a `where` of the filter (`filter.schema.json`) in `selection`: not
//    invalid, verification `open` (only requirements have one; the core, as a selection without view takes
//    it) and, with the property, its value `test` or none. It lists the same elements in every access. Above
//    the default page of `element.list` (200) the step gives `limit` with the number, so one page holds
//    them all, up to the largest page (5,000); `total` gives the number beyond that. Like the steps of the
//    baseline commands it names no workspace: it runs in the one checked.
//
// 4. `evidence.no-criteria-property` (warning, AK5): one per type with the meaning `requirement`, own or
//    inherited, none of whose own or inherited properties is the property with the meaning
//    `acceptance-criteria`, while at least one element of exactly that type has a status the metamodel
//    does not mark invalid (elements of a type that extends it do not count for it). Evidence records of its
//    requirements count for the whole requirement, not per criterion (SR-031 AK7). At the metamodel file
//    that defines the type, on its line, beside rules 1 to 3. Whether the property holds a list of texts
//    does not matter: a type that has it gets no warning, also when the metamodel warns about its kind.
//
// While the metamodel is not valid none is reported: requirements are not known then, and every state
// that checks against the metamodel is empty (`workspace.check`). Cost (SR-020 AK1, N-036): one pass over
// the elements, one evaluation per counted requirement (memoised), at most one batch of current versions.
import type { Problem } from "../catalog.js";
import { fileProblem } from "../files/index.js";
import type { NextStep } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { propertyWithMeaning, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { invalidStatuses } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE } from "../workspace/index.js";
import { countedIn } from "./degree.js";
import { verificationState } from "./verification.js";

const CORE: View = Object.freeze({ kind: "core" });

/** The default and the largest page of `element.list` (`limit`, schemas/commands/element.list.json). */
const DEFAULT_PAGE = 200;
const LARGEST_PAGE = 5000;

/** The code of the info of rule 2. */
const OPEN_REQUIREMENTS = "evidence.open-requirements";

/** The choice key of the verification method test (SR-230 AK2). */
export const TEST_METHOD = "test";

/** Whether `value` is no value or holds the key `test` (rule 2). */
const isTestMethod = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.includes(TEST_METHOD);
  }
  return value === TEST_METHOD;
};

/** The `where` of `element.list` that lists exactly the counted requirements (rule 3). */
export const openRequirementsWhere = (methodKey: string | undefined): Record<string, unknown> => ({
  all: [
    { not: { invalid: true } },
    { verification: ["open"] },
    ...(methodKey === undefined
      ? []
      : [
          {
            any: [
              { property: methodKey, op: "eq", value: TEST_METHOD },
              { property: methodKey, op: "missing" },
            ],
          },
        ]),
  ],
});

/** What a full check reports as gaps of verification: the problems, and the step of rule 3 with the info of rule 2. */
export interface VerificationGaps {
  readonly problems: readonly Problem[];
  readonly next?: NextStep;
}

const NONE: VerificationGaps = { problems: [] };

/** Rule 3: the step that lists the `open` counted requirements, one page that holds them all up to the largest. */
export const openRequirementsStep = (methodKey: string | undefined, open: number): NextStep => ({
  command: "element.list",
  input: {
    selection: { where: openRequirementsWhere(methodKey) },
    ...(open > DEFAULT_PAGE ? { limit: Math.min(open, LARGEST_PAGE) } : {}),
  },
  open: [],
});

/** Rule 1: the warning when the workspace file names no evidence location and the store holds a requirement. */
const noLocationProblems = (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  store: ElementStore,
): VerificationGaps => {
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  return store.elements.some((element) => requirements.has(element.type))
    ? {
        problems: [
          {
            code: "evidence.no-location",
            severity: "warning",
            file: WORKSPACE_FILE,
            message: `The workspace file names no evidence location, so no test result counts: add an entry under evidence, such as evidence: [{ repository: ${layout.main}, path: evidence }]`,
          },
        ],
      }
    : NONE;
};

/** Rule 2: the one info about the requirements with method test whose verification status is open in the core, and its step. */
const openGaps = async (
  workspace: Workspace,
  metamodel: Metamodel,
  store: ElementStore,
): Promise<VerificationGaps> => {
  const methodKey = propertyWithMeaning(metamodel, "verification-method")?.key;
  const status = await workspace.get(verificationState);
  const counted = countedIn(status.source, store.elements).filter(
    (element: ElementRecord) => methodKey === undefined || isTestMethod(element.data[methodKey]),
  );
  await status.prepare(counted, { own: true });
  let open = 0;
  for (const element of counted) {
    if (status.evaluate(element, CORE)?.status === "open") {
      open += 1;
    }
  }
  if (open === 0) {
    return NONE;
  }
  const method = methodKey === undefined ? "" : " with the verification method test";
  return {
    problems: [
      {
        code: OPEN_REQUIREMENTS,
        severity: "info",
        file: WORKSPACE_FILE,
        message: `${String(open)} requirement(s)${method} have the verification status open in the core`,
      },
    ],
    next: openRequirementsStep(methodKey, open),
  };
};

/** The remedy of rule 4: add the property that has the meaning, or give a property the meaning first. */
const criteriaRemedy = (criteriaKey: string | undefined): string =>
  criteriaKey === undefined
    ? "give the property of its acceptance criteria that meaning, kind text and many, and add it to the type"
    : `add property ${criteriaKey}, which has that meaning, to the type`;

/** Rule 4: a warning per requirement type without the property of the acceptance criteria that has elements. */
const noCriteriaPropertyProblems = (metamodel: Metamodel, store: ElementStore): Problem[] => {
  const criteriaKey = propertyWithMeaning(metamodel, "acceptance-criteria")?.key;
  const without = typesWithMeaning(metamodel, "requirement").filter(
    (type) => criteriaKey === undefined || !type.properties.includes(criteriaKey),
  );
  if (without.length === 0) {
    return [];
  }
  const invalid = invalidStatuses(metamodel);
  const used = new Set<string>();
  for (const element of store.elements) {
    if (!invalid.has(String(element.data["status"]))) {
      used.add(element.type);
    }
  }
  const shown = new Set(without.filter((type) => used.has(type.key)).map((type) => type.key));
  // In the order of the types; a valid metamodel has a place for each of them.
  return [...metamodel.typePlaces]
    .filter(([key]) => shown.has(key))
    .map(([key, place]) => ({
      ...fileProblem(
        "evidence.no-criteria-property",
        place.file,
        `Type ${key} has no property with the meaning acceptance-criteria, so the evidence records of its requirements count for the whole requirement and not per acceptance criterion; the type needs a property with that meaning: ${criteriaRemedy(criteriaKey)}`,
        place.line,
      ),
      severity: "warning",
      repository: metamodel.repository,
    }));
};

/**
 * The gaps of verification of a full workspace check (see the file comment): the warning of rule 1, or
 * the info of rule 2 with its step, or none, and the warnings of rule 4; none in a restricted check and
 * while the metamodel is not valid.
 */
export const verificationGaps = async (
  workspace: Workspace,
  context: {
    readonly layout: WorkspaceLayout;
    readonly metamodel: Metamodel;
    readonly store: ElementStore;
    /** The check is restricted to changed elements (SR-092): no gap is reported. */
    readonly restricted: boolean;
  },
): Promise<VerificationGaps> => {
  const { layout, metamodel, store, restricted } = context;
  if (restricted || !metamodel.valid) {
    return NONE;
  }
  const gaps =
    (layout.file.evidence ?? []).length === 0
      ? noLocationProblems(layout, metamodel, store)
      : await openGaps(workspace, metamodel, store);
  const criteria = noCriteriaPropertyProblems(metamodel, store);
  return criteria.length === 0 ? gaps : { ...gaps, problems: [...gaps.problems, ...criteria] };
};
