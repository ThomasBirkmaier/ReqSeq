// What a fake bridge answers for the line under the title of a package page (SR-112 AK3, `askPackageSummary`)
// when a test gives no answer of its own: no counted requirement, so no line. For the app's tests that open
// a package page for another reason.
const NO_COUNTS = { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 };

export const NO_SUMMARY: Readonly<Record<string, () => unknown>> = {
  "evidence.coverage": () => ({ levels: [] }),
  "evidence.degree": () => ({ degree: { total: 0, counts: NO_COUNTS }, view: "core" }),
};
