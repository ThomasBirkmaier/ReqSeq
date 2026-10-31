import { describe, expect, it } from "vitest";
import { idTitle } from "./id-title.js";

describe("idTitle", () => {
  it("is the identifier and the title", () => {
    expect(idTitle("VAR-002", "Linux")).toBe("VAR-002 Linux");
  });
  it("is the identifier once when the title is missing, empty or the same text (#545)", () => {
    expect(idTitle("Später", "Später")).toBe("Später");
    expect(idTitle("N-1", "")).toBe("N-1");
    expect(idTitle("N-1")).toBe("N-1");
  });
});
