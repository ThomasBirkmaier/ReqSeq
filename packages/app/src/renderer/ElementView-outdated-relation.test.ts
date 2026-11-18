// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (ThomasBirkmaier/ReqSeq-archive#460, ThomasBirkmaier/ReqSeq-archive#573).
import "../../../../scripts/test-support/dom-selection.mjs";
import type { DataExportElement } from "@reqseq/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { asCall, fakeCall, query, texts } from "./components.test-helper.js";
import { fresh, mount, read } from "./ElementView.test-helper.js";

describe("ElementView", () => {
  describe("an outdated relation (ThomasBirkmaier/ReqSeq-archive#665, ThomasBirkmaier/ReqSeq-archive#702)", () => {
    const hint = {
      code: "relation.outdated",
      severity: "warning",
      message: "derives-from of SR-000001 points to an older version of N-000001",
      targetId: "n1",
      storedVersion: "n1:aa",
      currentVersion: "n1:bb",
      hintId: "relation.outdated/spec/a.md/uuid-1/derives-from/n1?version=n1:aa",
      key: "derives-from",
      place: { in: "relation" },
    };
    const dated = {
      ...hint,
      message: `${hint.message}: stored version from 2026-03-04T10:00:00Z, current version from 2026-05-06T08:00:00Z`,
      storedDate: "2026-03-04T10:00:00Z",
      currentDate: "2026-05-06T08:00:00Z",
    };

    it("[SR-110/AK-j1xs] marks the row from the hint of its item, then with the date of the version it stores", async () => {
      const call = fakeCall({
        "element.get": (input) => ({
          element: read({
            problems: [input["hintDates"] === true ? dated : hint],
          } as unknown as Partial<DataExportElement>),
        }),
      });
      await mount(asCall(call));
      await act(async () => {
        await Promise.resolve();
      });
      // The element is read without dates first (SR-082 AK3), then once more for the dates of its hints.
      const reads = call.mock.calls.filter(([name]) => name === "element.get").map(([, input]) => input);
      expect(reads).toEqual([
        { ref: "uuid-1", repository: "spec" },
        { ref: "uuid-1", repository: "spec", hintDates: true },
      ]);
      expect(texts(".outdated")).toEqual([" link outdated · version of 2026-03-04"]);
      expect(query(".relation .outdated").title).toBe(dated.message);
    });

    it("keeps the word alone while the dates are not there, and asks no dates for an element without outdated hints", async () => {
      const call = fakeCall({
        "element.get": (input) =>
          input["hintDates"] === true
            ? new Error("Git is slow")
            : { element: read({ problems: [hint] } as unknown as Partial<DataExportElement>) },
      });
      await mount(asCall(call));
      expect(texts(".outdated")).toEqual([" link outdated"]);
      expect(query(".relation .outdated").title).toBe(hint.message);
      await fresh();
      const plain = fakeCall({ "element.get": () => ({ element: read() }) });
      await mount(asCall(plain));
      expect(plain.mock.calls.filter(([name]) => name === "element.get")).toHaveLength(1);
      expect(texts(".outdated")).toEqual([]);
    });
  });
});
