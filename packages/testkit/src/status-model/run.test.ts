// The runner of the status model properties (#1394).
import { describe, expect, it } from "vitest";
import { DEFAULT_RUNS, DEFAULT_SEED, forAllElements, forAllWorkspaces, propertyParameters } from "./index.js";

describe("status model runner", () => {
  it("takes runs and seed from the environment, with fixed defaults", () => {
    expect(propertyParameters({})).toEqual({ numRuns: DEFAULT_RUNS, seed: DEFAULT_SEED });
    expect(propertyParameters({ STATUS_MODEL_RUNS: "50", STATUS_MODEL_SEED: "-7" })).toEqual({
      numRuns: 50,
      seed: -7,
    });
    expect(propertyParameters({ STATUS_MODEL_SEED: "4294967297" }).seed).toBe(1);
    expect(propertyParameters({ STATUS_MODEL_SEED: "2147483648" }).seed).toBe(-2147483648);
    expect(propertyParameters({ STATUS_MODEL_RUNS: "0", STATUS_MODEL_SEED: " " })).toEqual({
      numRuns: 1,
      seed: DEFAULT_SEED,
    });
    expect(propertyParameters({ STATUS_MODEL_RUNS: "many", STATUS_MODEL_SEED: "1.5" })).toEqual({
      numRuns: DEFAULT_RUNS,
      seed: DEFAULT_SEED,
    });
  });

  it("passes when the check holds and names the seed when it fails", () => {
    let runs = 0;
    forAllElements(
      () => {
        runs += 1;
      },
      { numRuns: 5, seed: 3 },
    );
    expect(runs).toBe(5);
    expect(() => {
      forAllElements(
        (element) => {
          expect(element.records).toHaveLength(0);
        },
        { numRuns: 50, seed: 3 },
      );
    }).toThrow(/replay with STATUS_MODEL_SEED=3 STATUS_MODEL_RUNS=50\n.*Counterexample/s);
  });

  it("runs an async check over generated workspaces and names the seed when it fails", async () => {
    let runs = 0;
    await forAllWorkspaces(
      (workspace) => {
        expect(workspace.elements.length).toBeGreaterThan(0);
        runs += 1;
        return Promise.resolve();
      },
      { numRuns: 5, seed: 3 },
    );
    expect(runs).toBe(5);
    await expect(
      forAllWorkspaces(
        (workspace) => {
          expect(workspace.elements).toHaveLength(1);
          return Promise.resolve();
        },
        { numRuns: 50, seed: 3 },
      ),
    ).rejects.toThrow(/replay with STATUS_MODEL_SEED=3 STATUS_MODEL_RUNS=50\n.*Counterexample/s);
  });
});
