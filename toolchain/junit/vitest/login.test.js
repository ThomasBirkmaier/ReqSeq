// Example tests of the guide (../README.md): each test names the requirement it verifies, and the
// one `reqseq evidence enrich-junit` call of the pipeline does the rest. The requirements are in
// ../workspace. ReqSeq's own trace-check reads every test file of this repository: never write
// `[SR-` + three digits + `/AK` + a number + `]` here, it would be read as a test of ReqSeq.
import { describe, expect, it } from "vitest";

const login = (password) => password === "correct horse";

describe("login", () => {
  // Names SR-a1c0de by its short ID in the test name.
  it("[SR-a1c0de] accepts a valid password", () => {
    expect(login("correct horse")).toBe(true);
  });

  // Names SR-b2c0de by a property: the JUnit reporter writes it as <property name="logreq:element">.
  it("locks the account after three wrong passwords", async ({ annotate }) => {
    await annotate("SR-b2c0de", "logreq:element");
    const attempts = ["a", "b", "c"].map(login);
    expect(attempts).toEqual([false, false, false]);
  });

  // Names SR-c3c0de by its identifier REQ-012 (the property spec-id of the requirement).
  it("[REQ-012] logs out after 15 idle minutes", () => {
    const idleMinutes = 15;
    expect(idleMinutes >= 15).toBe(true);
  });

  // A skipped test is enriched but gives no execution: SR-d4c0de stays open.
  it.skip("[SR-d4c0de] sends a reset link", () => {
    expect(true).toBe(true);
  });

  // Names no requirement: ReqSeq passes over it.
  it("shows the login form", () => {
    expect(login("")).toBe(false);
  });
});
