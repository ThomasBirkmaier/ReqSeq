import { describe, expect, it } from "vitest";
import { idOfName, idTitle, shownId, shownIdTitle } from "./id-title.js";

describe("shownId", () => {
  it("[SR-084/AK4] is the short ID with the identifier in brackets behind it, the short ID alone without one", () => {
    expect(shownId("SR-3c90b0", "SR-036")).toBe("SR-3c90b0 (SR-036)");
    expect(shownId("SR-3c90b0")).toBe("SR-3c90b0");
    expect(shownId("SR-3c90b0", " ")).toBe("SR-3c90b0");
  });
  it("names the shown ID and the title, the title left out when it is the identifier's text (#545)", () => {
    expect(shownIdTitle("SR-3c90b0", "SR-036", "Title")).toBe("SR-3c90b0 (SR-036) Title");
    expect(shownIdTitle("PKG-1a2b3c", "Später", "Später")).toBe("PKG-1a2b3c (Später)");
    expect(shownIdTitle("N-1a2b3c", undefined, "")).toBe("N-1a2b3c");
  });
});

describe("idOfName", () => {
  it("takes the shown ID from the start of a buffer name", () => {
    expect(idOfName("SR-3c90b0 (SR-036) Show wind")).toBe("SR-3c90b0 (SR-036)");
    expect(idOfName("PKG-1a2b3c (Später)")).toBe("PKG-1a2b3c (Später)");
    expect(idOfName("SR-3c90b0 Show wind")).toBe("SR-3c90b0");
  });
});

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
