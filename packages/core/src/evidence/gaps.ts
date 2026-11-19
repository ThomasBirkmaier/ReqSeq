// The gaps of verification a full workspace check reports (SR-230 AK1, AK2), at the workspace file and
// only when the check is not restricted (SR-092; `workspace.check` leaves them out there):
//
// 1. `evidence.no-location` (warning, AK1): the workspace file names no evidence location (`evidence`
//    absent or empty) while the store holds at least one requirement (a type with the meaning
//    `requirement`, own or inherited, any status), so no test result can count. A location whose folder
//    does not exist or whose repository is not on this machine is a location (`evidence.folder-missing`
//    and `workspace.repository-missing` report those).
// 2. `evidence.open-requirements` (info, AK2): with at least one evidence location, one finding with the
//    number of requirements whose status the metamodel does not mark invalid (D-044), whose verification
//    method is test and whose verification status in the core is `open`, and the call that lists exactly
//    them; none when there are none. The verification method is test when the property with the meaning
//    `verification-method` holds the choice key `test` or no value (absent, `null` or `[]`, as the filter
//    takes "no value"); without such a property every requirement counts. The status is the one of the
//    shared evaluator (`verificationState`), prepared as `evidence.degree` prepares it, so the count, the
//    filter condition `verification` and `evidence.degree` agree (SR-080 AK2).
// 3. The call is `element.list` with a `where` of the filter (`filter.schema.json`): not invalid,
//    verification `open` (only requirements have one; the core, as a selection without view takes it)
//    and, with the property, its value `test` or none. It lists the same elements in every access. Above
//    the default page of `element.list` (200) the call names `--limit` with the number, so one page holds
//    them all, up to the largest page (5,000); `total` gives the number beyond that.
//
// While the metamodel is not valid neither is reported: requirements are not known then, and every state
// that checks against the metamodel is empty (`workspace.check`). Cost (SR-020 AK1, N-036): one pass over
// the elements, one evaluation per counted requirement (memoised), at most one batch of current versions.
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { propertyWithMeaning, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
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

/** Rule 1: the warning when the workspace file names no evidence location and the store holds a requirement. */
const noLocationProblems = (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  store: ElementStore,
): Problem[] => {
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  return store.elements.some((element) => requirements.has(element.type))
    ? [
        {
          code: "evidence.no-location",
          severity: "warning",
          file: WORKSPACE_FILE,
          message: `The workspace file names no evidence location, so no test result counts: add an entry under evidence, such as evidence: [{ repository: ${layout.main}, path: evidence }]`,
        },
      ]
    : [];
};

/** Rule 2: the one info about the requirements with method test whose verification status is open in the core. */
const openProblems = async (
  workspace: Workspace,
  metamodel: Metamodel,
  store: ElementStore,
): Promise<Problem[]> => {
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
    return [];
  }
  const method = methodKey === undefined ? "" : " with the verification method test";
  const where = JSON.stringify(openRequirementsWhere(methodKey));
  const limit = open > DEFAULT_PAGE ? ` --limit ${String(Math.min(open, LARGEST_PAGE))}` : "";
  return [
    {
      code: "evidence.open-requirements",
      severity: "info",
      file: WORKSPACE_FILE,
      message: `${String(open)} requirement(s)${method} have the verification status open in the core; reqseq element list --where '${where}'${limit} lists them`,
    },
  ];
};

/**
 * The gaps of verification of a full workspace check (see the file comment): the warning of rule 1 or
 * the info of rule 2, or none; none in a restricted check and while the metamodel is not valid.
 */
export const verificationGapProblems = async (
  workspace: Workspace,
  context: {
    readonly layout: WorkspaceLayout;
    readonly metamodel: Metamodel;
    readonly store: ElementStore;
    /** The check is restricted to changed elements (SR-092): no gap is reported. */
    readonly restricted: boolean;
  },
): Promise<Problem[]> => {
  const { layout, metamodel, store, restricted } = context;
  if (restricted || !metamodel.valid) {
    return [];
  }
  return (layout.file.evidence ?? []).length === 0
    ? noLocationProblems(layout, metamodel, store)
    : openProblems(workspace, metamodel, store);
};
