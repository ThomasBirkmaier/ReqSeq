// The registry of the cross-access scenarios (#527). Each test file has its own module instance, so
// these registrations do not reach cross-access.test.ts.
import { describe, expect, it } from "vitest";
import { SCENARIOS, TEMPLATE_SETUPS, scenariosOf, templateSetup } from "./scenario.js";

describe("cross-access scenario registry", () => {
  it("refuses two scenarios of the same name, as a merge can duplicate one", () => {
    const one = { name: "one", input: {}, expect: "output" } as const;
    expect(() => {
      scenariosOf("element.get", [one, { ...one, input: { ref: "x" } }]);
    }).toThrow("Scenarios of element.get named twice: one");
    expect(SCENARIOS.has("element.get")).toBe(false);
  });

  it("refuses a command or a template setup registered twice", () => {
    scenariosOf("element.list", [{ name: "one", input: {}, expect: "output" }]);
    expect(() => {
      scenariosOf("element.list", []);
    }).toThrow("Scenarios of element.list registered twice");
    const fixture = { fixture: "SR-004/one-repository" };
    const setup = (): Promise<void> => Promise.resolve();
    templateSetup(fixture, setup);
    expect(() => {
      templateSetup(fixture, setup);
    }).toThrow("Template setup of SR-004/one-repository registered twice");
    expect(TEMPLATE_SETUPS.get(fixture)).toBe(setup);
  });
});
