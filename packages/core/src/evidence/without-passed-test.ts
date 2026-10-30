// The requirements without a passed test execution (SR-120, #431): „Das Tool muss alle Requirements, die
// keine bestandene Testausführung haben, mit wenigen Tastendrücken zeigen.“ A derived list, not a status:
// it never changes the element's `status` and reads it only for the invalid flag (D-030). The assumptions
// are those of spec question #532 (the review of the plan answered them from the spec and the glossary):
//
// 1. A passed test execution of an element in a view is an evidence record with `kind: verification`,
//    `method: test` and `result: passed` that holds in the view (`holdsIn`: in the core a record without
//    variant, in a variant a record for it; SR-047). Of any version, and also when a later run failed
//    (AK2: „mindestens einer bestandenen Testausführung“). Inspection, analysis and demonstration are no
//    test execution, and validation records never count (D-007). A skipped JUnit test case gives no
//    record (ADR-0012), so it is none.
// 2. Listed are the elements whose type has the meaning `requirement`, whose status the metamodel does not
//    mark invalid (D-044) and that the view holds (`includes`: the view rule, SR-043, so also one of a
//    type without the validity property with a stray validity, AK10): the elements `evidence.degree` counts
//    (`countedIn`). An indirectly verified parent without own test execution is listed (AK2: „ohne
//    Testausführung … steht darin“), and so is a requirement verified by inspection only.
// 3. While the metamodel is not valid the status source has no records, so every requirement is listed,
//    as `evidence.status` gives every requirement `open` then.
//
// „Ohne Nachweis“ (SR-069 AK3, `hasVerificationRecord`) is another set: it leaves out a requirement with
// only failed or only inspection records. Cost: one pass over the elements and the records of each; no
// file is read and no current version computed (any version counts).
import type { ElementRecord } from "../model/index.js";
import type { View } from "../variants/index.js";
import { countedIn } from "./degree.js";
import type { EvidenceRecord } from "./record.js";
import type { StatusSource } from "./status.js";
import { holdsIn } from "./status.js";

/** Whether `record` is a passed test execution in `view` (rule 1). */
export const isPassedTest = (record: EvidenceRecord, view: View): boolean =>
  record.kind === "verification" &&
  record.method === "test" &&
  record.result === "passed" &&
  holdsIn(record, view);

/**
 * The requirements of `elements` without a passed test execution in `view` (rules 1 and 2) that
 * `includes` holds (the view's rule, `viewRuleOf`), in the order given. Pure and synchronous.
 */
export const withoutPassedTest = (
  source: Pick<StatusSource, "requirements" | "invalid" | "validity" | "recordsOf">,
  elements: readonly ElementRecord[],
  view: View,
  includes: (element: ElementRecord) => boolean,
): ElementRecord[] =>
  countedIn(source, elements).filter(
    (element) =>
      includes(element) && !source.recordsOf(element.id).some((record) => isPassedTest(record, view)),
  );
